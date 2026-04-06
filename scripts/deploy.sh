#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="wendy"
PORT="8086"
SMOKE_TIMEOUT=30
KEEP_IMAGES=3

# ── Helpers ──────────────────────────────────────────────────────────────────

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info()  { printf '\033[1;34m→ %s\033[0m\n' "$*"; }

die() { red "ERROR: $*" >&2; exit 1; }

prune_all() {
  info "Pruning all unused Docker resources"
  docker container prune -f >/dev/null 2>&1 || true
  docker image prune -a -f >/dev/null 2>&1 || true
  docker volume prune -f >/dev/null 2>&1 || true
  docker builder prune -f >/dev/null 2>&1 || true
}

# ── Parse args ───────────────────────────────────────────────────────────────

VERSION=""
REDEPLOY=false

show_help() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Build, smoke-test, and deploy Wendy dashboard."
  echo ""
  echo "Options:"
  echo "  --redeploy    Fast-track redeploy of current image (skip build + smoke)"
  echo "  --help        Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                  Build and deploy current HEAD"
  echo "  $0 --redeploy       Restart with existing image"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) show_help ;;
    --redeploy) REDEPLOY=true; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

SHORT_SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
GIT_TAG="${BRANCH}-${SHORT_SHA}"
CONTAINER="${IMAGE}-${GIT_TAG}"

DEPLOY_START=$SECONDS

# ── Prevent concurrent deploys ───────────────────────────────────────────────

LOCK_FILE="/tmp/wendy-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  die "Another deploy is already running (lock: $LOCK_FILE)"
fi

# ── Load env vars ────────────────────────────────────────────────────────────

ENV_ARGS=()
WENDY_ROLE="standalone"
if [[ -f .env ]]; then
  info "Loading env vars from .env"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// /}" || "$line" == \#* ]] && continue
    [[ "$line" != *"="* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}" ; value="${value#\"}"
    value="${value%\'}" ; value="${value#\'}"
    ENV_ARGS+=(-e "$key=$value")
    [[ "$key" == "WENDY_ROLE" ]] && WENDY_ROLE="$value"
  done < .env
fi

IS_SOURCE=false
[[ "$WENDY_ROLE" == "source" ]] && IS_SOURCE=true

# ── Redeploy check ──────────────────────────────────────────────────────────

if [[ "$REDEPLOY" == "true" ]]; then
  if ! docker image inspect "$IMAGE:$GIT_TAG" >/dev/null 2>&1; then
    die "Image $IMAGE:$GIT_TAG not found. Cannot --redeploy without an existing image."
  fi
  info "Fast-track redeploy — skipping build and smoke test"
fi

info "Deploying $IMAGE:$GIT_TAG"

# ── Build ────────────────────────────────────────────────────────────────────

if [[ "$REDEPLOY" == "true" ]]; then
  info "Skipping Docker build (--redeploy)"
else
  info "Building Docker image"
  docker build \
    --build-arg "GIT_HASH=$SHORT_SHA" \
    -t "$IMAGE:$GIT_TAG" \
    .
  green "Build succeeded"
fi

# ── Smoke test ───────────────────────────────────────────────────────────────

# Ensure data directory exists
mkdir -p data

if [[ "$REDEPLOY" == "true" ]]; then
  info "Skipping smoke test (--redeploy)"
elif [[ "$IS_SOURCE" == "true" ]]; then
  info "Skipping smoke test (source mode — no web server)"
else
  info "Running smoke test"
  SMOKE_NAME="${IMAGE}-smoke-$$"
  SMOKE_PORT=8099

  docker run -d \
    --name "$SMOKE_NAME" \
    --network host \
    -v "$(pwd)/data:/app/data" \
    "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
    -e "WENDY_PORT=${SMOKE_PORT}" \
    "$IMAGE:$GIT_TAG" >/dev/null

  smoke_cleanup() {
    docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true
  }
  trap smoke_cleanup EXIT

  passed=false
  for i in $(seq 1 "$SMOKE_TIMEOUT"); do
    http_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/api/health" 2>/dev/null) || http_code="000"
    if [[ "$http_code" == "200" ]]; then
      passed=true
      break
    fi
    if (( i % 5 == 0 )); then
      container_status=$(docker inspect -f '{{.State.Status}}' "$SMOKE_NAME" 2>/dev/null || echo "unknown")
      printf '  [%2d/%ds] status=%s http=%s\n' "$i" "$SMOKE_TIMEOUT" "$container_status" "$http_code"
      if [[ "$container_status" == "exited" ]]; then
        red "Container exited prematurely!"
        break
      fi
    fi
    sleep 1
  done

  if [[ "$passed" != "true" ]]; then
    red "Smoke test failed — /api/health did not return 200 within ${SMOKE_TIMEOUT}s"
    red "Container logs (last 50 lines):"
    docker logs "$SMOKE_NAME" --tail 50 2>&1 || true
    smoke_cleanup
    trap - EXIT
    exit 1
  fi

  green "Smoke test passed"
  smoke_cleanup
  trap - EXIT
fi

# ── Deploy: stop old, start new ─────────────────────────────────────────────

# Stop ALL wendy containers (catches manually started ones too)
# Keep containers around (don't rm) so rollback can restart them
OLD_NAME=""
for cid in $(docker ps -q -f "name=wendy"); do
  name=$(docker inspect --format '{{.Name}}' "$cid" | sed 's|^/||')
  info "Stopping $name"
  OLD_NAME="$name"
  docker stop --time=10 "$cid" >/dev/null
done

# Remove any stopped container with the same name
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker rm "$CONTAINER" >/dev/null
fi

info "Starting $CONTAINER"
docker run -d \
  --name "$CONTAINER" \
  --network host \
  -v "$(pwd)/data:/app/data" \
  "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
  --restart unless-stopped \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  "$IMAGE:$GIT_TAG" >/dev/null

# ── Live health check ───────────────────────────────────────────────────────

if [[ "$IS_SOURCE" == "true" ]]; then
  # Source mode has no web server — just verify container is running
  sleep 3
  container_status=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown")
  if [[ "$container_status" != "running" ]]; then
    red "Container not running (status: $container_status)"
    docker logs "$CONTAINER" --tail 30 2>&1 || true
    exit 1
  fi
  green "Container running (source mode)"
else
  info "Waiting for health check"
  passed=false
  for i in $(seq 1 15); do
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      passed=true
      break
    fi
    sleep 1
  done

  if [[ "$passed" != "true" ]]; then
    red "Health check failed — automatic rollback"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

    if [[ -n "$OLD_NAME" ]]; then
      info "Restarting previous container: $OLD_NAME"
      docker start "$OLD_NAME" >/dev/null 2>&1 || true
      red "Rolled back to $OLD_NAME"
    else
      red "No previous container to rollback to"
    fi

    red "Deployment FAILED"
    docker logs "$CONTAINER" --tail 30 2>&1 || true
    exit 1
  fi

  green "Health check passed"
fi

# ── Remove old container now that the new one is healthy ───────────────────

if [[ -n "$OLD_NAME" ]]; then
  docker rm "$OLD_NAME" >/dev/null 2>&1 || true
fi

# ── Prune old images ────────────────────────────────────────────────────────

if [[ "$KEEP_IMAGES" -gt 0 ]]; then
  old_images=$(docker images "$IMAGE" --format '{{.Tag}}' \
    | grep -v '<none>' \
    | sort -V \
    | head -n -"$KEEP_IMAGES" || true)

  for old_tag in $old_images; do
    info "Removing old image: $IMAGE:$old_tag"
    docker rmi "$IMAGE:$old_tag" >/dev/null 2>&1 || true
  done
fi

prune_all

# ── Summary ──────────────────────────────────────────────────────────────────

ELAPSED=$(( SECONDS - DEPLOY_START ))
echo ""
green "Deployment complete in ${ELAPSED}s"
echo "  Image:     $IMAGE:$GIT_TAG"
echo "  Container: $CONTAINER"
echo "  Dashboard: http://$(hostname -I | awk '{print $1}'):${PORT}"

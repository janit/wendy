FROM denoland/deno:2.7.9 AS build

WORKDIR /app

# Cache deps — only allow esbuild scripts (skip serialport native build)
COPY deno.json deno.lock* ./
RUN deno install --allow-scripts=npm:esbuild,npm:esbuild@0.25.7,npm:esbuild@0.27.4

# Copy source and build client assets
COPY . .
RUN deno task build

# ── Production ──────────────────────────────────────────────────────────────
FROM denoland/deno:2.7.9

WORKDIR /app

# Copy built output + source needed at runtime
COPY --from=build /app/_fresh _fresh/
COPY --from=build /app/deno.json /app/deno.lock* ./
COPY --from=build /app/serve.ts .
COPY --from=build /app/lib lib/
COPY --from=build /app/static static/
COPY --from=build /app/node_modules node_modules/

# Version from build arg
ARG GIT_HASH=dev
ENV WENDY_VERSION=$GIT_HASH

# curl for Chia RPC (mTLS with self-signed certs)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Data directory for SQLite (mount as volume)
RUN mkdir -p /app/data
ENV WENDY_DB_PATH=/app/data/wendy.db

EXPOSE 8086

CMD ["deno", "run", "-A", "serve.ts"]

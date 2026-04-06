// Apply saved theme immediately to prevent flash
const saved = localStorage.getItem("wendy-theme");
if (saved) {
  document.documentElement.setAttribute("data-theme", saved);
} else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
  document.documentElement.setAttribute("data-theme", "light");
}

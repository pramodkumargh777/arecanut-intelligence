(function () {
  var preference;
  try {
    preference = localStorage.getItem("areca-pulse-theme");
  } catch (error) {
    console.warn("Theme preference could not be read.", error);
  }
  var theme = preference === "light" || preference === "dark"
    ? preference
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  // Scripts run here, so the app will draw the page: the plain copy written into the page for search engines and
  // checkers (vite.config.ts) is hidden, and readers see the screen exactly as the app draws it.
  document.documentElement.dataset.js = "on";
})();

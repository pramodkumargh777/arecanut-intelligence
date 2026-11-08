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
})();

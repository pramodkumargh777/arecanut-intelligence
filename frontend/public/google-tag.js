// Google Analytics through the site's Google tag. The build adds this script, with the tag ID in data-id, only when
// VITE_GOOGLE_TAG_ID is set (vite.config.ts), so local builds and tests send nothing. It is a file rather than the
// inline snippet Google suggests, so the Content-Security-Policy can keep refusing inline scripts.
(function () {
  var id = document.currentScript && document.currentScript.getAttribute("data-id");
  if (!id) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  var tag = document.createElement("script");
  tag.async = true;
  tag.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(id);
  document.head.appendChild(tag);
})();

(function () {
  "use strict";

  const storageKey = "sbuThemePreference";
  let preference = "system";

  try {
    const savedPreference = localStorage.getItem(storageKey);
    if (savedPreference === "light" || savedPreference === "dark" || savedPreference === "system") {
      preference = savedPreference;
    }
  } catch {
  }

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = preference === "system"
    ? (prefersDark ? "dark" : "light")
    : preference;
}());

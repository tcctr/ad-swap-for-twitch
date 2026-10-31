const api = typeof browser !== "undefined" ? browser : chrome;
const defaults = TAS_DEFAULTS;

// The same page serves as the toolbar menu and the add-on's settings page.
const isPopup = api.extension.getViews({ type: "popup" }).includes(window);
if (!isPopup) document.body.classList.add("page");

TAS_MIGRATE(api.storage.sync).catch(() => {}).then(() => api.storage.sync.get(defaults)).then((s) => {
  for (const key of Object.keys(defaults)) {
    const box = document.getElementById(key);
    box.checked = s[key];
    box.addEventListener("change", () => api.storage.sync.set({ [key]: box.checked }));
  }
});

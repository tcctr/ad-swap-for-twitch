// Default settings, shared by the page scripts and the settings menu.
// Only the ad swap is on out of the box; the page tweaks are opt-in.
globalThis.TAS_DEFAULTS = {
  enabled: true, enlarge: true, breakScreen: true,
  hideSidebar: false, hideFollowedChannels: false, hideLiveChannels: false,
  hideSidebarAlsoWatch: false, hideShowMore: false, hideSidebarArrow: false,
  hideAlsoWatch: false, hideBrowse: false, hideTopIcons: false,
  logoToFollowing: false, startOnFollowing: false,
  debug: false,
};

// Up to 2.0.1, "Viewers Also Watch" also hid the sidebar's copy, which now has its own
// setting: carry it over once so nothing reappears after the update.
globalThis.TAS_MIGRATE = (storage) => storage.get(null).then((s) => {
  if (s.hideAlsoWatch && !("hideSidebarAlsoWatch" in s)) return storage.set({ hideSidebarAlsoWatch: true });
});

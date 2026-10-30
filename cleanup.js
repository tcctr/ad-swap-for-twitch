// Optional page tweaks: hide the left sidebar (or its Live Channels section, or all of it
// but Followed Channels),
// "Viewers Also Watch", the Browse
// button and top-bar icons, and send the home page and the Twitch logo to Following.
(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const settings = { ...TAS_DEFAULTS };
  const FOLLOWING = "/directory/following";
  const LOGO = 'a[data-a-target="home-link"], a[aria-label="Twitch Home"], nav a[href="/"]';

  // Hiding is done with classes on <html>, so turning an option off restores the page instantly.
  const style = document.createElement("style");
  style.textContent = `
    html.tas-hide-sidebar [data-a-target="side-nav-bar"],
    html.tas-hide-sidebar [data-a-target="side-nav-bar-collapsed"],
    html.tas-hide-sidebar #side-nav,
    html.tas-hide-sidebar .side-nav { display: none !important; }
    html.tas-hide-also-watch [data-tas-also-watch] { display: none !important; }
    html.tas-followed-only [data-tas-side-section] { display: none !important; }
    html.tas-hide-live [data-tas-live-section] { display: none !important; }
    html.tas-hide-browse a[data-a-target="browse-link"],
    html.tas-hide-browse nav a[href="/directory"] { display: none !important; }
    html.tas-hide-top-icons [data-tas-top-icon] { display: none !important; }
  `;

  // At document_start the page may not exist yet; attach as soon as it does.
  function whenRootReady(fn) {
    if (document.documentElement) return fn();
    new MutationObserver((_, obs) => {
      if (document.documentElement) { obs.disconnect(); fn(); }
    }).observe(document, { childList: true });
  }
  whenRootReady(() => (document.head || document.documentElement).appendChild(style));

  // Sidebar sections: tag the Live/Recommended Channels section, and everything but
  // Followed Channels, so either option can hide them.
  const SIDEBAR = '[data-a-target="side-nav-bar"], #side-nav, .side-nav';
  const SIDE_SECTION = '.side-nav-section, [role="group"]';

  function sectionName(section) {
    const heading = section.querySelector("h2, h3, h4, h5, p");
    return section.getAttribute("aria-label") || (heading ? heading.textContent : "");
  }

  function markSidebarSections() {
    const nav = document.querySelector(SIDEBAR);
    if (!nav) return;
    const all = [...nav.querySelectorAll(SIDE_SECTION)];
    const sections = all.filter((s) => !all.some((o) => o !== s && o.contains(s))); // outermost only
    if (!sections.length) return;
    // Followed Channels comes first when logged in, so that's the fallback in other languages.
    const keep = sections.find((s) => /followed/i.test(sectionName(s))) || sections[0];
    for (const s of sections) {
      const name = sectionName(s).trim();
      tag(s, "data-tas-side-section", sections.length > 1 && s !== keep, name);
      tag(s, "data-tas-live-section", /live channels|recommended channels/i.test(name), name);
    }
  }

  function tag(el, attr, on, name) {
    if (on === el.hasAttribute(attr)) return;
    el.toggleAttribute(attr, on);
    if (on && settings.debug) console.log("[Ad Swap] sidebar section", attr, name.slice(0, 40));
  }

  // Twitch has no stable selector for this section, so find it by its heading text.
  const ALSO_WATCH = /viewers also watch|also watch(ing)? this/i;
  const SECTION = 'section, [role="group"], .side-nav-section, [class*="shelf"], [class*="Shelf"]';

  function markAlsoWatch() {
    const found = document.evaluate(
      "//body//*[not(self::script) and not(self::style)][text()[contains(translate(., 'ALSOWATCH', 'alsowatch'), 'also watch')]]",
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < found.snapshotLength; i++) {
      const el = found.snapshotItem(i);
      if (!ALSO_WATCH.test(el.textContent) || el.closest("[data-tas-also-watch]")) continue;
      const section = el.closest(SECTION);
      // Never hide anything holding the player or the chat.
      if (!section || section.querySelector("video, .chat-shell, [data-a-target=\"chat-scroller\"]")) continue;
      section.setAttribute("data-tas-also-watch", "");
    }
  }

  // Top bar: hide every icon button except notifications, the profile menu,
  // the logo and search. Matched loosely because Twitch's markup changes.
  const TOP_NAV = 'nav[data-a-target="top-nav-container"], nav.top-nav, #root nav';
  const KEEP = [
    '[data-a-target*="notification" i]', '[aria-label*="notification" i]',
    '[data-a-target="user-menu-toggle"]', '[aria-label*="user menu" i]', '[aria-label*="profile" i]',
    LOGO, `a[href="${FOLLOWING}"]`, 'a[data-a-target="following-link"]',
    '[role="search"]', 'form', 'input',
  ].join(", ");
  const POPUP = '[role="dialog"], [role="menu"], [role="listbox"], [class*="balloon" i], [class*="dropdown" i]';

  function onlyHolds(wrapper, inner) {
    if (wrapper.querySelector(KEEP)) return false;
    return [...wrapper.querySelectorAll("button, a, input")].every((c) => inner.contains(c));
  }

  function markTopIcons() {
    const nav = document.querySelector(TOP_NAV);
    if (!nav) return;
    for (const el of nav.querySelectorAll("button, a")) {
      if (el.closest("[data-tas-top-icon]") || el.closest(POPUP)) continue;
      if (!el.querySelector("svg, img, figure")) continue; // only icon buttons
      if (el.closest(KEEP) || el.querySelector(KEEP)) continue;
      // Hide the wrapper too, along with anything decorative in it (like a red count
      // badge), as long as it holds no other button, link or kept item.
      let target = el;
      while (target.parentElement && target.parentElement !== nav && onlyHolds(target.parentElement, target)) {
        target = target.parentElement;
      }
      target.setAttribute("data-tas-top-icon", "");
      if (settings.debug) {
        console.log("[Ad Swap] hid top-bar icon:",
          el.getAttribute("aria-label") || el.dataset.aTarget || el.textContent.trim() || el.outerHTML.slice(0, 80));
      }
    }
  }

  function apply() {
    const root = document.documentElement;
    if (!root) return whenRootReady(apply);
    root.classList.toggle("tas-hide-sidebar", !!settings.hideSidebar);
    root.classList.toggle("tas-hide-also-watch", !!settings.hideAlsoWatch);
    root.classList.toggle("tas-followed-only", !!settings.sidebarFollowedOnly);
    root.classList.toggle("tas-hide-live", !!settings.hideLiveChannels);
    root.classList.toggle("tas-hide-browse", !!settings.hideBrowse);
    root.classList.toggle("tas-hide-top-icons", !!settings.hideTopIcons);
  }

  // The Following page only works when logged in, so the redirects only apply then.
  function loggedIn() {
    if (/(?:^|;\s*)(?:login|auth-token)=/.test(document.cookie)) return true;
    return !!document.querySelector('[data-a-target="user-menu-toggle"]');
  }

  // Go to Following without a full reload when Twitch's own link is on the page.
  function goToFollowing() {
    const link = document.querySelector(`a[data-a-target="following-link"], a[href="${FOLLOWING}"]`);
    if (link) link.click();
    else location.assign(FOLLOWING);
  }

  // Send the home page to Following, on first load and when Twitch navigates there in-page.
  let lastRedirect = 0;
  function checkHome() {
    if (settings.startOnFollowing && location.pathname === "/" && Date.now() - lastRedirect > 2000 && loggedIn()) {
      lastRedirect = Date.now();
      if (document.querySelector("body")) goToFollowing();
      else location.replace(FOLLOWING);
    }
  }

  // Point the logo at Following, so new-tab and middle clicks also go there.
  function retargetLogo() {
    const toFollowing = settings.logoToFollowing && loggedIn();
    for (const a of document.querySelectorAll(LOGO)) {
      if (toFollowing && a.getAttribute("href") === "/") a.setAttribute("href", FOLLOWING);
      if (!toFollowing && a.getAttribute("href") === FOLLOWING && a.matches('[data-a-target="home-link"], [aria-label="Twitch Home"]')) {
        a.setAttribute("href", "/");
      }
    }
  }

  // Twitch's own click handler would still go home, so take over plain left clicks on the logo.
  document.addEventListener("click", (e) => {
    if (!settings.logoToFollowing || !loggedIn() || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const logo = e.target.closest && e.target.closest(`${LOGO}, a[data-a-target="home-link"][href="${FOLLOWING}"], a[aria-label="Twitch Home"][href="${FOLLOWING}"]`);
    if (!logo) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    goToFollowing();
  }, true);

  let loaded = false; // wait for saved settings before redirecting anything
  api.storage.sync.get(settings).then((s) => { Object.assign(settings, s); loaded = true; apply(); checkHome(); });
  api.storage.onChanged.addListener((changes) => {
    for (const [k, { newValue }] of Object.entries(changes)) if (k in settings) settings[k] = newValue;
    apply();
  });

  apply();
  setInterval(() => {
    if (settings.hideAlsoWatch) markAlsoWatch();
    if (settings.sidebarFollowedOnly || settings.hideLiveChannels) markSidebarSections();
    if (settings.hideTopIcons) markTopIcons();
  }, 1000);
  setInterval(() => { if (loaded) { retargetLogo(); checkHome(); } }, 250);
})();

(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const settings = { ...TAS_DEFAULTS };

  // Elements Twitch shows while an ad is playing (best effort; Twitch changes markup).
  const AD_SELECTORS = [
    '[data-a-target="video-ad-label"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-test-selector="ad-banner-default-text"]',
  ];
  const PBYP_HINT = '[class*="picture-by-picture"], [data-a-target*="picture-by-picture"]';

  let inAd = false;
  let saved = null;            // { volume, muted } of the stream before the ad
  let mainVideo = null;
  let pbypVideo = null;
  const styled = new Map();    // element -> original style attribute (null if none)
  let offset = { x: 0, y: 0 }; // correction for ancestors that shift fixed positioning
  let sawAdLabel = false;      // did Twitch's "Ad" label show during this ad?
  let overSince = 0;           // when the ad first looked over (0 = it doesn't)
  let audioOnMain = false;     // stream sound handed back to the main player
  let lastMain = { el: null, time: 0 };
  let enlargeBlocked = false;  // preview's container looked unsafe to resize
  let retiredPreview = null;   // preview from an ad that already ended, while it keeps playing
  const playlists = new Map(); // stream playlist -> { ad, at }: is its live edge an ad (from background.js)
  let hintStart = 0;           // when a playlist first showed an ad at its live edge
  let hintUntil = 0;           // keep the playlist's ad signal until then
  let lastEndAt = 0;           // when the last ad ended
  let lastSkipAt = 0;          // when background.js last swapped in an ad-free copy of the stream

  const log = (...a) => settings.debug && console.log("[Ad Swap]", ...a);

  // Twitch can leave these in the page, hidden, after the ad; only visible ones count.
  function visible(el) {
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function adShowing() {
    return AD_SELECTORS.some((s) => [...document.querySelectorAll(s)].some(visible));
  }

  // The playlist says an ad is coming or playing. It ends a few seconds after the live edge
  // goes back to the stream, since the player is that far behind. A hint from before the
  // last ad ended is stale (old ad segments), so it can't start a new one.
  let lastTail = "";
  let playlistsSeen = 0;      // playlist reports from background.js (0 = it sees no requests)
  const reports = { ad: 0, skipped: 0, skipFailed: 0, unknown: 0, preview: 0 }; // for Debug logging and tests
  let lastPreviewAt = 0;      // when Twitch last loaded the corner preview's stream
  function onPlaylist({ key, ad, tail, skipped, skipFailed, unknown, preview }) {
    const now = Date.now();
    playlistsSeen++;
    for (const [k, v] of Object.entries({ ad, skipped, skipFailed, unknown, preview })) if (v) reports[k]++;
    if (preview) {
      if (now - lastPreviewAt > 8000) log("Twitch is loading the corner preview's stream");
      lastPreviewAt = now;
      queueTick();
      return;
    }
    // The player just moved between Twitch's copy of the stream and the ad-free one.
    if (!!skipped !== onCopy) { onCopy = !!skipped; watchForStall(); }
    if (tail && tail !== lastTail) log("playlist with an ad marker, live edge is ad:", ad, "\n" + tail);
    lastTail = tail || lastTail;
    if (skipped) {
      if (now - lastSkipAt > 10000) log("ad skipped: playing an ad-free copy of the stream", { via: skipped });
      lastSkipAt = now;
      queueTick();
    }
    if (skipFailed) log("no ad-free copy of the stream, swapping instead");
    if (unknown) log("ad in a playlist whose channel isn't known yet, can't skip it");
    for (const [k, p] of playlists) if (now - p.at > 6000) playlists.delete(k); // gone, e.g. other channel
    const before = [...playlists.values()].some((p) => p.ad);
    playlists.set(key, { ad, at: now });
    if (!ad) return;
    if (!before) hintStart = now;
    const v = mainVideo || findVideos().main;
    const ahead = v && v.buffered.length ? Math.max(0, v.buffered.end(v.buffered.length - 1) - v.currentTime) : 0;
    hintUntil = now + 3000 + Math.min(ahead, 10) * 1000;
    log("ad in the stream's playlist", { ahead: ahead.toFixed(2) });
    queueTick();
  }

  // Did Twitch load the corner preview's stream lately? Only then can a small playing video on
  // its own mean an ad (other small videos, like previews elsewhere on the page, don't). If
  // background.js reports nothing at all (playlists not readable), go by the video alone.
  function previewSignal() {
    return playlistsSeen === 0 || Date.now() - lastPreviewAt < 8000;
  }

  function adHint() {
    return Date.now() < hintUntil && hintStart > lastEndAt;
  }

  function area(v) {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  function playing(v) {
    return v.isConnected && !v.paused && !v.ended && v.readyState >= 2;
  }

  // Returns { main, pbyp } among the page's <video> elements.
  function findVideos() {
    const videos = [...document.querySelectorAll("video")]
      .filter((v) => v === pbypVideo || v.closest(PBYP_HINT) || area(v) > 0);
    // In fullscreen only what's inside the fullscreen element is on screen.
    const fs = document.fullscreenElement;
    const onScreen = (v) => !fs || fs.contains(v);
    // A finished ad's preview may keep playing for a moment; forget it once it stops.
    if (retiredPreview && !playing(retiredPreview)) retiredPreview = null;
    // Keep the chosen preview while it plays (enlarged, it's the biggest video);
    // otherwise look again, so a wrong or stale pick never sticks.
    if (pbypVideo && !(videos.includes(pbypVideo) && playing(pbypVideo))) {
      if (pbypVideo.isConnected) pbypVideo.muted = true; // silent if Twitch resumes it later
      pbypVideo = null;
    }
    // The main player is the biggest video that isn't the preview or one we enlarged.
    const main = videos.filter((v) => v !== pbypVideo && !styled.has(v) && !v.closest(PBYP_HINT))
      .sort((a, b) => area(b) - area(a))[0] ||
      videos.filter((v) => v !== pbypVideo).sort((a, b) => area(b) - area(a))[0] || null;
    // Twitch may start another copy of the preview for fullscreen. Sound and picture must come
    // from the copy on screen, or they drift apart; switch to it if ours is off screen.
    if (pbypVideo && main && !onScreen(pbypVideo)) {
      const shown = videos.find((v) => v !== main && v !== pbypVideo && v !== retiredPreview &&
                                       onScreen(v) && playing(v));
      if (shown) {
        pbypVideo.muted = true;
        restoreStyles(); // the new copy gets enlarged on this check instead
        log("switching to the preview on screen", describe(shown));
        pbypVideo = shown;
      }
    }
    if (!pbypVideo && main) {
      // Prefer a playing video on screen inside a "picture-by-picture" container, else the smallest playing one.
      const playingOnes = videos.filter((v) => v !== main && v !== retiredPreview && playing(v));
      const shown = playingOnes.filter(onScreen);
      const candidates = shown.length ? shown : playingOnes;
      const found = candidates.find((v) => v.closest(PBYP_HINT)) ||
                    candidates.sort((a, b) => area(a) - area(b))[0];
      if (found) {
        pbypVideo = found;
        log("found stream preview", describe(found));
      }
    }
    return { main, pbyp: pbypVideo };
  }

  // Twitch can keep a preview playing in a box it has collapsed to nothing (e.g. 340x0), so it
  // only counts while Twitch gives the video and its box a real size, or once we've enlarged it.
  function shownByTwitch(pbyp) {
    // In fullscreen nothing outside the fullscreen element is drawn, even if we enlarge it.
    const fs = document.fullscreenElement;
    if (fs && !fs.contains(pbyp)) return false;
    if (styled.has(pbyp)) return true;
    const box = pbyp.closest(PBYP_HINT);
    const sized = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    return sized(pbyp) && (!box || sized(box));
  }

  // The preview is only worth showing while it's actually playing and on screen.
  function previewUsable(pbyp) {
    return !!pbyp && playing(pbyp) && pbyp !== retiredPreview && shownByTwitch(pbyp);
  }

  // Is the main player showing moving picture (rather than loading or black)?
  function mainProgressing(main) {
    const t = main.currentTime;
    const ok = lastMain.el === main && t > lastMain.time + 0.05 && !main.paused && main.readyState >= 3;
    lastMain = { el: main, time: t };
    return ok;
  }

  // Keep the ad muted even if Twitch (or the volume slider) unmutes it.
  function onMainVolumeChange() {
    if (!inAd || !mainVideo || audioOnMain) return;
    if (!mainVideo.muted) {
      // User moved the slider during the ad: carry the new volume to the stream.
      saved.volume = mainVideo.volume;
      saved.muted = false;
      mainVideo.muted = true;
    }
  }

  // Inline !important styles survive Twitch re-rendering class names.
  function setStyles(el, props) {
    if (!styled.has(el)) styled.set(el, el.getAttribute("style"));
    for (const [k, v] of Object.entries(props)) {
      if (el.style.getPropertyValue(k) !== v || el.style.getPropertyPriority(k) !== "important") {
        el.style.setProperty(k, v, "important");
      }
    }
  }

  function restoreStyles() {
    for (const [el, orig] of styled) {
      if (orig === null) el.removeAttribute("style");
      else el.setAttribute("style", orig);
    }
    styled.clear();
    offset = { x: 0, y: 0 };
  }

  // Pin each wrapper to the box's top-left so aspect-ratio spacers can't push the video down.
  const FILL_PARENT = {
    position: "absolute", top: "0", left: "0", right: "auto", bottom: "auto",
    width: "100%", height: "100%", "max-width": "none", "max-height": "none",
    margin: "0", padding: "0", transform: "none", display: "block", visibility: "visible",
  };

  // Area the stream should cover: the player itself, so it never runs under the chat.
  function targetRect(main) {
    const player = main.closest('[data-a-target="video-player"]') ||
                   main.closest(".video-player") || main;
    const r = player.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
    return (document.fullscreenElement || main).getBoundingClientRect();
  }

  function describe(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
    return `${el.tagName}${el.dataset.aTarget ? `[${el.dataset.aTarget}]` : ""}${cls ? "." + cls : ""} ` +
           `@${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  // The element wrapping the corner preview, which gets moved over the player.
  function previewBox(main, pbyp) {
    let box = pbyp.closest(PBYP_HINT);
    if (!box || box.contains(main)) {
      // Walk up from the preview video to the ancestor that sits beside the main video.
      box = pbyp;
      while (box.parentElement && !box.parentElement.contains(main)) box = box.parentElement;
    }
    if (styled.has(box)) return box;
    if (enlargeBlocked) return null;

    // Never resize something that holds the chat or is already as big as the player.
    const t = targetRect(main);
    const b = box.getBoundingClientRect();
    const holdsChat = box.querySelector('.chat-shell, [data-a-target="chat-scroller"], .stream-chat');
    if (holdsChat || b.width * b.height > 0.6 * t.width * t.height) {
      enlargeBlocked = true;
      console.warn("[Ad Swap] not enlarging: preview container looks wrong", describe(box));
      return null;
    }
    log("enlarging", { box: describe(box), target: describe(main.closest('[data-a-target="video-player"]') || main),
                       fullscreen: describe(document.fullscreenElement) });
    return box;
  }

  function enlarge(main, pbyp) {
    const box = previewBox(main, pbyp);
    if (!box) return;
    const t = targetRect(main);
    setStyles(box, {
      position: "fixed",
      left: `${t.left + offset.x}px`,
      top: `${t.top + offset.y}px`,
      right: "auto",
      bottom: "auto",
      width: `${t.width}px`,
      height: `${t.height}px`,
      "max-width": "none",
      "max-height": "none",
      margin: "0",
      transform: "none",
      "z-index": "2147483001", // above the break screen, so a playing preview always wins
      background: "#000",
      border: "none",
      "border-radius": "0",
      "pointer-events": "none", // let clicks reach Twitch's controls underneath
      display: "block",
      visibility: "visible",
      opacity: "1",
    });
    for (let el = pbyp.parentElement; el && el !== box; el = el.parentElement) {
      setStyles(el, FILL_PARENT);
    }
    setStyles(pbyp, { ...FILL_PARENT, "object-fit": "contain" });

    // A transformed ancestor makes "fixed" relative to it; measure and correct, right away
    // (checks can be 250 ms apart, too long to show the preview in the wrong place).
    const r = box.getBoundingClientRect();
    const dx = t.left - r.left;
    const dy = t.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      offset.x += dx;
      offset.y += dy;
      setStyles(box, { left: `${t.left + offset.x}px`, top: `${t.top + offset.y}px` });
    }
  }

  // Shown over the player when an ad plays and Twitch gives no stream preview.
  const BREAK_TIPS = [
    "Good moment to drink some water.",
    "Look away from the screen for a bit. Your eyes will thank you.",
    "Stand up and stretch.",
    "Roll your shoulders and take a deep breath.",
    "Look at something far away for 20 seconds.",
  ];
  let breakEl = null;
  let breakOffset = { x: 0, y: 0 };

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text; // avoid needless page changes
  }

  function showBreak(main) {
    if (!breakEl) {
      breakEl = document.createElement("div");
      breakEl.setAttribute("data-ad-swap-break", "");
      const title = document.createElement("div");
      const line = document.createElement("div");
      const tip = document.createElement("div");
      const count = document.createElement("div");
      title.textContent = "Ad break";
      line.textContent = "An ad is playing and there's no stream preview this time.";
      tip.textContent = BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)];
      breakEl.append(title, line, tip, count);
      breakOffset = { x: 0, y: 0 };
    }
    // In fullscreen only the fullscreen element is drawn, so the screen must live inside it.
    const host = document.fullscreenElement || document.body;
    if (breakEl.parentNode !== host) host.appendChild(breakEl);

    const t = targetRect(main);
    const size = Math.max(14, Math.min(28, t.width / 40));
    const [title, line, tip, count] = breakEl.children;
    Object.assign(breakEl.style, {
      position: "fixed", left: `${t.left + breakOffset.x}px`, top: `${t.top + breakOffset.y}px`,
      width: `${t.width}px`, height: `${t.height}px`, zIndex: "2147483000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: `${size * 0.6}px`, padding: "24px", boxSizing: "border-box", textAlign: "center",
      background: "#18181b", color: "#efeff1", font: `${size}px/1.35 system-ui, sans-serif`,
      pointerEvents: "none", // clicks still reach Twitch's controls
    });
    Object.assign(title.style, { fontSize: `${size * 1.6}px`, fontWeight: "700", color: "#bf94ff" });
    Object.assign(tip.style, { fontWeight: "600" });
    Object.assign(count.style, { fontSize: `${size * 0.8}px`, color: "#adadb8" });
    const countdown = document.querySelector('[data-a-target="video-ad-countdown"]');
    setText(count, countdown ? countdown.textContent.trim() : "");

    // A transformed ancestor makes "fixed" relative to it; measure and correct right away.
    const r = breakEl.getBoundingClientRect();
    const dx = t.left - r.left;
    const dy = t.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      breakOffset.x += dx;
      breakOffset.y += dy;
      Object.assign(breakEl.style, { left: `${t.left + breakOffset.x}px`, top: `${t.top + breakOffset.y}px` });
    }
  }

  function hideBreak() {
    if (breakEl) breakEl.remove();
    breakEl = null;
  }

  // Sound: from the preview while it plays, back to the stream as the ad ends.
  function audioToPreview(pbyp) {
    audioOnMain = false;
    // Only the preview being shown makes sound: the ad and any other copy stay muted.
    for (const v of document.querySelectorAll("video")) {
      if (v !== pbyp && !v.muted) v.muted = true;
    }
    if (pbyp.muted !== saved.muted) pbyp.muted = saved.muted;
    if (Math.abs(pbyp.volume - saved.volume) > 0.001) pbyp.volume = saved.volume;
  }

  function audioToMain(pbyp) {
    if (pbyp && pbyp.isConnected && !pbyp.muted) pbyp.muted = true;
    if (!mainVideo) return;
    audioOnMain = true;
    if (mainVideo.muted !== saved.muted) mainVideo.muted = saved.muted;
    if (Math.abs(mainVideo.volume - saved.volume) > 0.001) mainVideo.volume = saved.volume;
  }

  function startAd(main) {
    inAd = true;
    sawAdLabel = false;
    overSince = 0;
    audioOnMain = false;
    enlargeBlocked = false;
    mainVideo = main;
    saved = { volume: main.volume, muted: main.muted };
    main.addEventListener("volumechange", onMainVolumeChange);
    log("ad started, saved", saved, adShowing() ? "(Ad label)" : adHint() ? "(playlist)" : "(preview playing)");
  }

  function endAd() {
    inAd = false;
    lastEndAt = Date.now();
    restoreStyles();
    hideBreak();
    const { main } = findVideos();
    const target = main || mainVideo;
    if (mainVideo) mainVideo.removeEventListener("volumechange", onMainVolumeChange);
    if (target && saved) {
      target.volume = saved.volume;
      target.muted = saved.muted;
    }
    // Don't leave a lingering preview playing sound on top of the stream.
    if (pbypVideo && pbypVideo.isConnected) pbypVideo.muted = true;
    retiredPreview = pbypVideo;
    log("ad ended, restored", saved);
    mainVideo = null;
    pbypVideo = null;
    saved = null;
  }

  let ticks = 0;               // checks run so far (Debug state, for the tests)
  function tick() {
    ticks++;
    if (!settings.enabled) {
      if (inAd) endAd();
      return;
    }
    // While an ad-free copy is playing, Twitch may still show its "Ad" label, but no ad plays:
    // don't cover or mute the stream for it. A preview playing still counts (a real ad).
    const skipping = Date.now() - lastSkipAt < 6000;
    const label = !skipping && adShowing();
    const hint = !skipping && adHint();
    if (label || hint) retiredPreview = null; // a new ad: any playing preview belongs to it
    const { main, pbyp } = findVideos();
    const usable = previewUsable(pbyp);
    const now = Date.now();

    if (!inAd) {
      // The corner preview only plays during ads.
      if ((label || hint || (usable && previewSignal())) && main) startAd(main);
      else return;
    }

    if (label && !sawAdLabel) {
      log("Ad label showing", adHint() ? `${now - hintStart} ms after the playlist hint` : "(no playlist hint)");
    }
    if (label) sawAdLabel = true;
    // Trust the "Ad" label if we saw it; otherwise go by the playlist and the preview stopping.
    const over = sawAdLabel ? !label : !usable && !hint;
    overSince = over ? overSince || now : 0;
    const ending = overSince && now - overSince >= 400;

    if (main && main !== mainVideo) {
      mainVideo.removeEventListener("volumechange", onMainVolumeChange);
      mainVideo = main;
      main.addEventListener("volumechange", onMainVolumeChange);
    }
    // Keep the preview up until the stream is actually moving again, so there's no black gap.
    const progressing = mainVideo ? mainProgressing(mainVideo) : false;
    const showPreview = usable && !(ending && progressing);

    // Finish once the ad has looked over for a second (riding out flicker between ads),
    // but not while the preview still covers a stream that hasn't restarted, up to 4 seconds.
    const overFor = overSince ? now - overSince : 0;
    if (overFor >= 1000 && (!showPreview || overFor >= 4000)) return endAd();

    if (showPreview) audioToPreview(pbyp);
    else if (ending) audioToMain(pbyp);
    else if (mainVideo && !mainVideo.muted && !audioOnMain) mainVideo.muted = true;

    if (showPreview && settings.enlarge && mainVideo) enlarge(mainVideo, pbyp);
    else restoreStyles();

    // No preview to show: cover the ad with a break screen right away. If a preview starts
    // a moment later, it sits above the break screen, so it still wins.
    if (!over && !usable && settings.breakScreen && mainVideo) showBreak(mainVideo);
    else hideBreak();
  }

  api.storage.sync.get(settings).then((s) => Object.assign(settings, s));
  api.storage.onChanged.addListener((changes) => {
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (!settings.enlarge) restoreStyles();
    if (!settings.breakScreen) hideBreak();
  });

  // The channel this page shows, if it's a channel page ("" for home, directory, etc.).
  const NOT_CHANNELS = new Set(["", "directory", "search", "settings", "videos", "u", "subscriptions",
    "inventory", "wallet", "drops", "turbo", "p", "downloads", "jobs", "friends", "messages"]);
  function pageChannel() {
    const parts = location.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
    if (["popout", "moderator", "embed"].includes(parts[0])) return parts[1] || "";
    return NOT_CHANNELS.has(parts[0] || "") ? "" : parts[0];
  }

  // Playlist reports from background.js. When the browser can't say which tab a playlist
  // belongs to (Zen), every Twitch page gets it: skip reports about another channel.
  function fromBackground(msg) {
    if (!msg || msg.type !== "playlist" || !settings.enabled) return;
    const here = pageChannel();
    if (msg.channel && here && msg.channel !== here) return;
    onPlaylist(msg);
  }
  let port = null;
  let portUrl = "";
  function connect() {
    try { port = api.runtime.connect({ name: "tas-page" }); } catch (e) { port = null; return; } // add-on gone
    portUrl = location.href;
    port.postMessage({ type: "where", url: portUrl });
    port.onMessage.addListener(fromBackground);
    port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 1000); });
  }
  connect();
  // Twitch changes pages without reloading: keep background.js up to date on where this page is.
  setInterval(() => {
    if (port && location.href !== portUrl) {
      portUrl = location.href;
      port.postMessage({ type: "where", url: portUrl });
    }
  }, 500);

  // Switching between Twitch's copy of the stream and the ad-free one can leave the player stuck
  // on one frame. For 15 s after each switch, a main video that should be playing but hasn't
  // moved for 2.5 s gets a pause and play (at most twice), as vaft does.
  let onCopy = false;          // background.js is serving the ad-free copy
  let stallWatchUntil = 0;
  let stall = { el: null, time: -1, since: 0 };
  let nudges = 0;
  function watchForStall() {
    stallWatchUntil = Date.now() + 15000;
    stall = { el: null, time: -1, since: 0 };
    nudges = 0;
  }
  function checkStall() {
    const now = Date.now();
    if (now > stallWatchUntil || nudges >= 2) return;
    const v = mainVideo || findVideos().main;
    if (!v || v.paused || v.ended) { stall.since = 0; return; }
    if (stall.el !== v || v.currentTime !== stall.time) { stall = { el: v, time: v.currentTime, since: now }; return; }
    if (now - stall.since < 2500) return;
    nudges++;
    stall.since = now;
    log("player stuck after switching stream copies: pause and play", describe(v));
    v.pause();
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }
  setInterval(checkStall, 500);

  // Test builds only (tests/e2e/zen.mjs sets TAS_TEST): the mock page can feed playlist reports.
  if (globalThis.TAS_TEST) {
    document.addEventListener("tas-test-playlist", (e) => fromBackground(JSON.parse(e.detail)));
  }

  setInterval(tick, 250);
  // Also react to page changes (an ad starting or ending) without waiting for the next check.
  // At most one extra check per 100 ms however busy the page is (chat alone changes it constantly).
  let tickQueued = false;
  let lastQueuedTick = 0;
  const queueTick = () => {
    if (tickQueued) return;
    tickQueued = true;
    setTimeout(() => { tickQueued = false; lastQueuedTick = Date.now(); tick(); },
               Math.max(20, 100 - (Date.now() - lastQueuedTick)));
  };
  const CHAT = '.chat-shell, [data-a-target="chat-scroller"], .stream-chat';
  const inChat = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return !!(el && el.closest(CHAT)); };
  // Twitch can reveal an "Ad" label that's already in the page by changing its class or style,
  // so watch those too, skipping the changes this extension makes itself.
  const ours = (n) => styled.has(n) || (breakEl && breakEl.contains(n));
  new MutationObserver((records) => {
    if (records.some((r) => !inChat(r.target) && (r.type === "childList" || !ours(r.target)))) queueTick();
  }).observe(document, { childList: true, subtree: true, attributes: true,
                         attributeFilter: ["class", "style", "hidden"] });
  // A video starting or switching source is often the first sign of an ad.
  for (const e of ["play", "playing", "loadeddata", "emptied"]) document.addEventListener(e, queueTick, true);
  document.addEventListener("fullscreenchange", () => setTimeout(tick, 50));
  console.debug("[Ad Swap] loaded");

  // With debug on, the current state is also kept on <html data-tas-state>, for the automated tests.
  setInterval(() => {
    const root = document.documentElement;
    if (!root) return;
    if (!settings.debug) { if (root.hasAttribute("data-tas-state")) root.removeAttribute("data-tas-state"); return; }
    const main = mainVideo || findVideos().main;
    root.setAttribute("data-tas-state", JSON.stringify({
      inAd, adLabel: adShowing(), playlistAd: adHint(), playlistsSeen, reports, nudges, onCopy, ticks, previewSignal: previewSignal(), connected: !!port,
      skipping: Date.now() - lastSkipAt < 6000, breakScreen: !!(breakEl && breakEl.isConnected),
      enlarged: styled.size > 0, mainMuted: main ? main.muted : null,
      previewMuted: pbypVideo ? pbypVideo.muted : null, preview: describe(pbypVideo),
      previewRect: pbypVideo ? (({ left, top, width, height }) => ({ left, top, width, height }))(pbypVideo.getBoundingClientRect()) : null,
      playerRect: main ? (({ left, top, width, height }) => ({ left, top, width, height }))(targetRect(main)) : null,
    }));
  }, 250);

  // With debug on, report what the extension sees every 2 seconds.
  setInterval(() => {
    if (!settings.debug) return;
    const fs = document.fullscreenElement;
    const videos = [...document.querySelectorAll("video")].map((v) => {
      const r = v.getBoundingClientRect();
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      return `${Math.round(r.width)}x${Math.round(r.height)} muted=${v.muted} vol=${v.volume.toFixed(2)}` +
             ` inFullscreen=${fs ? fs.contains(v) : "n/a"}` +
             (v === pbypVideo ? " (preview)" : "") +
             ` t=${v.currentTime.toFixed(2)} buffered=${v.buffered.length ? (v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(2) : 0}s` +
             (q ? ` frames=${q.totalVideoFrames} dropped=${q.droppedVideoFrames}` : "");
    });
    log({ inAd, adLabel: adShowing(), sawAdLabel, playlistAd: adHint(), playlistsSeen, fullscreen: describe(fs), videos,
          styled: [...styled.keys()].slice(0, 1).map(describe) });
  }, 2000);
})();

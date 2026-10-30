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
  let wasUsable = false;       // was the preview playing at the last check?
  let previewLostAt = 0;       // when the preview stopped playing, or the ad started
  let lastMain = { el: null, time: 0 };
  let enlargeBlocked = false;  // preview's container looked unsafe to resize
  let retiredPreview = null;   // preview from an ad that already ended

  const log = (...a) => settings.debug && console.log("[Ad Swap]", ...a);

  function adShowing() {
    return AD_SELECTORS.some((s) => document.querySelector(s));
  }

  function area(v) {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  // Returns { main, pbyp } among the page's <video> elements.
  function findVideos() {
    const videos = [...document.querySelectorAll("video")]
      .filter((v) => v === pbypVideo || v.closest(PBYP_HINT) || area(v) > 0);
    if (pbypVideo && !videos.includes(pbypVideo)) pbypVideo = null;
    if (!pbypVideo && videos.length >= 2) {
      // Prefer a video inside a "picture-by-picture" container, else the smallest one.
      pbypVideo = videos.find((v) => v.closest(PBYP_HINT)) ||
                  [...videos].sort((a, b) => area(a) - area(b))[0];
      log("found stream preview", pbypVideo);
    }
    const others = videos.filter((v) => v !== pbypVideo);
    const main = others.sort((a, b) => area(b) - area(a))[0] || null;
    return { main, pbyp: pbypVideo };
  }

  // The preview is only worth showing while it's actually playing.
  function previewUsable(pbyp) {
    return !!pbyp && pbyp.isConnected && !pbyp.paused && !pbyp.ended &&
           pbyp.readyState >= 2 && pbyp !== retiredPreview;
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
      "z-index": "2147483000",
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

    // A transformed ancestor makes "fixed" relative to it; measure and correct.
    const r = box.getBoundingClientRect();
    offset.x += t.left - r.left;
    offset.y += t.top - r.top;
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
      width: `${t.width}px`, height: `${t.height}px`, zIndex: "2147483001",
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

    // A transformed ancestor makes "fixed" relative to it; measure and correct.
    const r = breakEl.getBoundingClientRect();
    breakOffset.x += t.left - r.left;
    breakOffset.y += t.top - r.top;
  }

  function hideBreak() {
    if (breakEl) breakEl.remove();
    breakEl = null;
  }

  // Sound: from the preview while it plays, back to the stream as the ad ends.
  function audioToPreview(pbyp) {
    audioOnMain = false;
    if (mainVideo && !mainVideo.muted) mainVideo.muted = true;
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
    wasUsable = false;
    previewLostAt = Date.now();
    enlargeBlocked = false;
    mainVideo = main;
    saved = { volume: main.volume, muted: main.muted };
    main.addEventListener("volumechange", onMainVolumeChange);
    log("ad started, saved", saved);
  }

  function endAd() {
    inAd = false;
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

  function tick() {
    if (!settings.enabled) {
      if (inAd) endAd();
      return;
    }
    const { main, pbyp } = findVideos();
    const label = adShowing();
    const usable = previewUsable(pbyp);
    const now = Date.now();

    if (!inAd) {
      // The corner preview only plays during ads.
      if ((label || usable) && main) startAd(main);
      else return;
    }

    if (label) sawAdLabel = true;
    // Trust the "Ad" label if we saw it; otherwise go by the preview stopping.
    const over = sawAdLabel ? !label : !usable;
    overSince = over ? overSince || now : 0;
    const ending = overSince && now - overSince >= 400;

    if (main && main !== mainVideo) {
      mainVideo.removeEventListener("volumechange", onMainVolumeChange);
      mainVideo = main;
      main.addEventListener("volumechange", onMainVolumeChange);
    }
    if (wasUsable && !usable) previewLostAt = now;
    wasUsable = usable;

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

    // No preview to show: cover the ad with a break screen (after a moment, in case it's just loading).
    if (!over && !usable && settings.breakScreen && mainVideo && now - previewLostAt >= 1000) showBreak(mainVideo);
    else hideBreak();
  }

  api.storage.sync.get(settings).then((s) => Object.assign(settings, s));
  api.storage.onChanged.addListener((changes) => {
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (!settings.enlarge) restoreStyles();
    if (!settings.breakScreen) hideBreak();
  });

  setInterval(tick, 250);
  // Also react to page changes (an ad starting or ending) without waiting for the next check.
  let tickQueued = false;
  new MutationObserver(() => {
    if (tickQueued) return;
    tickQueued = true;
    setTimeout(() => { tickQueued = false; tick(); }, 50);
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener("fullscreenchange", () => setTimeout(tick, 50));
  console.debug("[Ad Swap] loaded");

  // With debug on, report what the extension sees every 2 seconds.
  setInterval(() => {
    if (!settings.debug) return;
    const fs = document.fullscreenElement;
    const videos = [...document.querySelectorAll("video")].map((v) => {
      const r = v.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)} muted=${v.muted} vol=${v.volume.toFixed(2)}` +
             ` inFullscreen=${fs ? fs.contains(v) : "n/a"}`;
    });
    log({ inAd, adLabel: adShowing(), sawAdLabel, fullscreen: describe(fs), videos,
          styled: [...styled.keys()].slice(0, 1).map(describe) });
  }, 2000);
})();

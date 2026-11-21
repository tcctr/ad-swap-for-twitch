// Twitch stitches ads into the stream's own playlist and marks them there ("stitched"), before
// the player shows them. This script:
// - reads each master playlist to learn which channel and quality each media playlist is;
// - when a media playlist carries an ad and "Skip ads" is on, fetches an ad-free copy of the
//   same stream (a second playback token, as Twitch's embedded and preview players use) and
//   hands that to the player instead, so the ad never plays;
// - otherwise passes the playlist through untouched and tells the page script whether its
//   newest segment is an ad, so the swap or break screen covers it from the first frame.
const api = typeof browser !== "undefined" ? browser : chrome;
const settings = { ...TAS_DEFAULTS };
api.storage.sync.get(settings).then((s) => Object.assign(settings, s));
api.storage.onChanged.addListener((changes) => {
  for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
});

const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // Twitch's public web client ID
// Player types to ask an ad-free copy for, in order (as vaft does; checked ad-free 2026-11-21).
const BACKUP_PLAYER_TYPES = [["embed", "web"], ["popout", "web"], ["autoplay", "android"]];
const BACKUP_TIMEOUT = 2500;   // ms per request: past this, try the next one
const HOLD_LIMIT = 4000;       // ms the player's playlist may be held up while looking for a copy
const NO_COPY_PAUSE = 30000;   // ms to stop looking after no ad-free copy was found

const variants = new Map(); // media playlist (no query) -> { channel, resolution, height }
const backups = new Map();  // "channel|resolution" -> { url, at, playerType } of an ad-free media playlist
const noCopyUntil = new Map(); // "channel|resolution" -> don't look again before this time
const searches = new Map();    // "channel|resolution" -> the search in progress, shared by refreshes

// Headers the page's own requests to Twitch's API carry (device ID, integrity token, login),
// so the ad-free copy is asked for the way the Twitch player would.
const PAGE_HEADERS = ["authorization", "client-integrity", "client-session-id", "client-version", "x-device-id"];
const pageHeaders = {};

const noQuery = (url) => url.split("?")[0];

// Is the newest segment of this media playlist an ad? Old ad segments stay listed for a while
// after an ad ends, so only the live edge counts. Stream segments are titled "live"; ads aren't.
function liveEdgeIsAd(text) {
  if (!text.includes("stitched")) return false;
  const lines = text.split("\n").filter((l) => l.startsWith("#EXTINF"));
  const last = lines[lines.length - 1];
  return !!last && !last.trim().endsWith(",live");
}

// Does this media playlist hold any ad segment at all?
function hasAd(text) {
  return text.includes("stitched") &&
         text.split("\n").some((l) => l.startsWith("#EXTINF") && !l.trim().endsWith(",live"));
}

// Master playlist: "#EXT-X-STREAM-INF:...RESOLUTION=1920x1080..." followed by the media URL.
function parseMaster(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const res = (lines[i].match(/RESOLUTION=(\d+x\d+)/) || [])[1] || "";
    const url = lines[i + 1].trim();
    if (url.startsWith("http")) out.push({ url, resolution: res, height: +(res.split("x")[1] || 0) });
  }
  return out;
}

async function fetchText(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BACKUP_TIMEOUT);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal, credentials: "omit" });
    if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function backupMaster(channel, playerType, platform) {
  const body = {
    operationName: "PlaybackAccessToken_Template",
    query: "query PlaybackAccessToken_Template($login: String!, $playerType: String!, $platform: String!) {" +
           " streamPlaybackAccessToken(channelName: $login, params: {platform: $platform," +
           " playerBackend: \"mediaplayer\", playerType: $playerType}) { value signature __typename } }",
    variables: { login: channel, playerType, platform },
  };
  const json = JSON.parse(await fetchText("https://gql.twitch.tv/gql", {
    method: "POST", headers: { ...pageHeaders, "Client-ID": CLIENT_ID }, body: JSON.stringify(body),
  }));
  const token = json && json.data && json.data.streamPlaybackAccessToken;
  if (!token) throw new Error("no playback token");
  const q = new URLSearchParams({
    sig: token.signature, token: token.value, allow_source: "true", fast_bread: "true",
    p: String(Math.floor(Math.random() * 1e7)), platform: "web", player_backend: "mediaplayer",
    playlist_include_framerate: "true", supported_codecs: "avc1",
  });
  return parseMaster(await fetchText(`https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${q}`));
}

async function findCleanPlaylist(variant, key) {
  const cached = backups.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
    try {
      const text = await fetchText(cached.url);
      if (!hasAd(text)) return { text, via: cached.playerType };
    } catch (e) { /* token expired or stream moved: look again */ }
    backups.delete(key);
  }
  for (const [playerType, platform] of BACKUP_PLAYER_TYPES) {
    try {
      const list = await backupMaster(variant.channel, playerType, platform);
      if (!list.length) continue;
      // Same quality if offered, else the closest height.
      const pick = list.find((v) => v.resolution === variant.resolution) ||
                   list.slice().sort((a, b) => Math.abs(a.height - variant.height) - Math.abs(b.height - variant.height))[0];
      const text = await fetchText(pick.url);
      if (hasAd(text)) continue;
      backups.set(key, { url: pick.url, at: Date.now(), playerType });
      return { text, via: playerType };
    } catch (e) { /* try the next player type */ }
  }
  return null;
}

// Ad-free text for this media playlist, or null to let the original through. The player asks
// for its playlist every couple of seconds: refreshes share one search, and after a search
// finds nothing the original goes straight through for a while instead of being held up again.
async function cleanPlaylist(variant) {
  const key = `${variant.channel}|${variant.resolution}`;
  if (Date.now() < (noCopyUntil.get(key) || 0)) return null;
  if (!searches.has(key)) {
    searches.set(key, findCleanPlaylist(variant, key).then((clean) => {
      if (!clean) noCopyUntil.set(key, Date.now() + NO_COPY_PAUSE);
      return clean;
    }, () => null).finally(() => searches.delete(key)));
  }
  return searches.get(key);
}

// Each Twitch page's script connects here. Zen can report both the page and the player's
// requests without a tab (tabId -1, and tabs.query lists no tabs), so messages go over these
// connections rather than tabs.sendMessage, and are matched to a page by tab when there is one.
const pages = new Set(); // { port, tabId, url }
api.runtime.onConnect.addListener((port) => {
  if (port.name !== "tas-page") return;
  const page = { port, tabId: port.sender && port.sender.tab ? port.sender.tab.id : -1,
                 url: (port.sender && port.sender.url) || "" };
  pages.add(page);
  port.onMessage.addListener((m) => { if (m && m.type === "where") page.url = m.url; });
  port.onDisconnect.addListener(() => pages.delete(page));
});

// Without a tab to go by, every Twitch page gets the report, with its channel, and a page
// showing another channel ignores it (content.js).
function send(details, variant, msg) {
  const full = { type: "playlist", channel: variant ? variant.channel : "", ...msg };
  const all = [...pages];
  const byTab = details.tabId >= 0 ? all.filter((p) => p.tabId === details.tabId) : [];
  for (const p of byTab.length ? byTab : all) {
    try { p.port.postMessage(full); } catch (e) { pages.delete(p); }
  }
}

// Requests this script makes itself (the ad-free copy) must not be filtered again.
const OWN = api.runtime.getURL("");
const isOwn = (details) => [details.originUrl, details.documentUrl].some((u) => u && u.startsWith(OWN));

api.webRequest.onBeforeRequest.addListener((details) => {
  const url = new URL(details.url);
  if (isOwn(details) || !url.pathname.endsWith(".m3u8")) return;
  const master = url.hostname === "usher.ttvnw.net" ? (url.pathname.match(/\/hls\/([^/]+)\.m3u8$/) || [])[1] : null;
  const filter = api.webRequest.filterResponseData(details.requestId);
  const decoder = new TextDecoder();
  const chunks = [];
  let text = "";
  filter.ondata = (e) => {
    chunks.push(e.data);
    text += decoder.decode(e.data, { stream: true });
  };
  filter.onstop = async () => {
    const passThrough = () => { for (const c of chunks) filter.write(c); filter.close(); };
    if (master) {
      passThrough();
      // Which Twitch player asked: the token names it ("site" for the main one).
      let playerType = "";
      try { playerType = JSON.parse(url.searchParams.get("token") || "{}").player_type || ""; } catch (e) { /* unknown */ }
      for (const v of parseMaster(text)) {
        variants.set(noQuery(v.url), { channel: master.toLowerCase(), resolution: v.resolution, height: v.height, playerType });
      }
      // Twitch only starts the corner preview for an ad break: tell the page it's coming.
      if (playerType === "picture-by-picture") send(details, { channel: master.toLowerCase() }, { key: "", preview: true });
      return;
    }
    const key = noQuery(details.url);
    const variant = variants.get(key);
    const debug = settings.debug;
    // For Debug logging: the end of any playlist that mentions an ad, to see how Twitch marks it.
    const tail = debug && text.includes("stitched") ? text.trim().split("\n").slice(-12).join("\n") : "";
    // The corner preview is Twitch's own ad-free copy: never hold it up or report on it.
    // Its refreshes (every couple of seconds while it plays) keep the page's preview signal fresh.
    if (variant && variant.playerType === "picture-by-picture") {
      passThrough();
      send(details, variant, { key, preview: true });
      return;
    }
    if (settings.enabled && settings.skipAds && variant && hasAd(text)) {
      let clean = null;
      // The player waits for this answer, so give up after a few seconds and let the ad through.
      const giveUp = new Promise((r) => setTimeout(() => r(null), HOLD_LIMIT));
      try { clean = await Promise.race([cleanPlaylist(variant), giveUp]); } catch (e) { /* fall through */ }
      if (clean) {
        filter.write(new TextEncoder().encode(clean.text));
        filter.close();
        send(details, variant, { key, ad: false, skipped: clean.via, tail });
        return;
      }
      send(details, variant, { key, ad: liveEdgeIsAd(text), skipFailed: true, tail });
      return passThrough();
    }
    passThrough();
    send(details, variant, { key, ad: liveEdgeIsAd(text), tail, unknown: !variant && text.includes("stitched") });
  };
  filter.onerror = () => {};
}, { urls: ["*://*.hls.ttvnw.net/*", "*://*.playlist.ttvnw.net/*", "*://usher.ttvnw.net/*"] }, ["blocking"]);

api.webRequest.onBeforeSendHeaders.addListener((details) => {
  if (isOwn(details)) return;
  for (const h of details.requestHeaders || []) {
    const name = h.name.toLowerCase();
    if (PAGE_HEADERS.includes(name) && h.value) pageHeaders[name] = h.value;
  }
}, { urls: ["https://gql.twitch.tv/gql*"] }, ["requestHeaders"]);

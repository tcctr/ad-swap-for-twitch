// Runs the real defaults.js + background.js inside a fake WebExtension environment, so tests can
// feed it playlist requests and see what it hands to the player and to the page.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const OWN = "moz-extension://test-uuid/";

function event() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fns, fire: (...a) => fns.map((f) => f(...a)) };
}

// routes: [{ match: RegExp | (url, options) => bool, respond: (url, options) => string | Response }]
// realFetch: requests no route matches go to the real network (tests/live).
export async function loadBackground({ settings = {}, routes = [], realFetch = false } = {}) {
  const store = { ...settings };
  const onBeforeRequest = event();
  const onBeforeSendHeaders = event();
  const onConnect = event();
  const onChanged = event();
  const filters = new Map(); // requestId -> fake StreamFilter
  const fetched = [];

  const browser = {
    storage: {
      sync: { get: async (defs) => ({ ...defs, ...store }), set: async (o) => Object.assign(store, o) },
      onChanged,
    },
    runtime: { getURL: (p) => OWN + p, onConnect },
    webRequest: {
      onBeforeRequest,
      onBeforeSendHeaders,
      filterResponseData(requestId) {
        const f = { written: [], closed: false, write(c) { this.written.push(c); }, close() { this.closed = true; } };
        filters.set(requestId, f);
        return f;
      },
    },
    tabs: { sendMessage: async () => { throw new Error("tabs.sendMessage must not be needed"); } },
  };

  async function fakeFetch(url, options = {}) {
    fetched.push({ url, options });
    const route = routes.find((r) => (typeof r.match === "function" ? r.match(url, options) : r.match.test(url)));
    if (!route) return realFetch ? fetch(url, options) : new Response("not found", { status: 404 });
    const out = await route.respond(url, options);
    return out instanceof Response ? out : new Response(out);
  }

  const context = vm.createContext({
    browser, fetch: fakeFetch, console, URL, URLSearchParams, TextDecoder, TextEncoder,
    AbortController, setTimeout, clearTimeout, Promise, JSON, Math, Date,
  });
  context.globalThis = context;
  for (const file of ["defaults.js", "background.js"]) {
    vm.runInContext(readFileSync(root + file, "utf8"), context, { filename: file });
  }
  await new Promise((r) => setTimeout(r, 0)); // let storage.sync.get settle

  let nextId = 1;
  // One request through the webRequest listener; resolves with what the player receives.
  async function request(url, { tabId = -1, originUrl = "https://www.twitch.tv/", body = "" } = {}) {
    const requestId = String(nextId++);
    onBeforeRequest.fns.forEach((fn) => fn({ requestId, url, tabId, originUrl, documentUrl: originUrl }));
    const f = filters.get(requestId);
    if (!f) return { filtered: false };
    f.ondata({ data: new TextEncoder().encode(body).buffer });
    await f.onstop();
    const text = f.written.map((c) => new TextDecoder().decode(c)).join("");
    return { filtered: true, closed: f.closed, text };
  }

  // A Twitch page connecting, as content.js does.
  function connectPage({ tabId, url = "https://www.twitch.tv/somechannel" } = {}) {
    const received = [];
    const port = {
      name: "tas-page",
      sender: { url, ...(tabId === undefined ? {} : { tab: { id: tabId } }) },
      onMessage: event(), onDisconnect: event(),
      postMessage: (m) => received.push(m),
    };
    onConnect.fire(port);
    return { received, port, say: (m) => port.onMessage.fire(m), disconnect: () => port.onDisconnect.fire() };
  }

  // The page's own request to Twitch's API, with its headers.
  function pageGql(headers, { originUrl = "https://www.twitch.tv/k4sen" } = {}) {
    const requestHeaders = Object.entries(headers).map(([name, value]) => ({ name, value }));
    onBeforeSendHeaders.fns.forEach((fn) => fn({ url: "https://gql.twitch.tv/gql", originUrl, documentUrl: originUrl, requestHeaders }));
  }

  const setSetting = (k, v) => { store[k] = v; onChanged.fire({ [k]: { newValue: v } }); };
  return { request, connectPage, pageGql, fetched, setSetting, OWN };
}

// usher URL the Twitch player asks for, with a token naming the player type.
export function usherUrl(channel, playerType = "site") {
  const token = JSON.stringify({ channel, player_type: playerType });
  return `https://usher.ttvnw.net/api/v2/channel/hls/${channel}.m3u8?sig=x&token=${encodeURIComponent(token)}`;
}

// Media playlist URLs listed in the master fixture, best quality first.
export const mediaUrls = (master) => master.split("\n").filter((l) => l.startsWith("http"));

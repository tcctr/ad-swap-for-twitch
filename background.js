// Twitch stitches ads into the stream's own playlist and marks them there, a few seconds before
// the player shows them (and before the on-page "Ad" label appears). Reading the playlists lets
// the page script cover an ad from its first frame. Playlists are passed through untouched.
const api = typeof browser !== "undefined" ? browser : chrome;

// Is the newest segment of this media playlist an ad? Old ad segments stay listed for a while
// after an ad ends, so only the live edge counts. Stream segments are titled "live"; ads aren't.
function liveEdgeIsAd(text) {
  if (!text.includes("stitched")) return false;
  const lines = text.split("\n").filter((l) => l.startsWith("#EXTINF"));
  const last = lines[lines.length - 1];
  return !!last && !last.trim().endsWith(",live");
}

api.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0 || !new URL(details.url).pathname.endsWith(".m3u8")) return;
  const filter = api.webRequest.filterResponseData(details.requestId);
  const decoder = new TextDecoder();
  let text = "";
  filter.ondata = (e) => {
    text += decoder.decode(e.data, { stream: true });
    filter.write(e.data);
  };
  filter.onstop = () => {
    filter.close();
    // Without query string: the same playlist keeps its key across refreshes.
    const key = details.url.split("?")[0];
    api.tabs.sendMessage(details.tabId, { type: "playlist", key, ad: liveEdgeIsAd(text) })
      .catch(() => {}); // tab without the page script (e.g. still loading)
  };
  filter.onerror = () => {};
}, { urls: ["*://*.hls.ttvnw.net/*"] }, ["blocking"]);

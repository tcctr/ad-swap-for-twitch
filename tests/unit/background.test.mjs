import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground, fixture, usherUrl, mediaUrls } from "./harness.mjs";

const master = fixture("master.m3u8");
const live = fixture("media-live.m3u8");
const adEdge = fixture("media-ad-edge.m3u8");
const adOld = fixture("media-ad-old.m3u8");
const clean = fixture("media-backup-clean.m3u8");
const [source] = mediaUrls(master);
const backupMaster = master.replaceAll("eus22.playlist.ttvnw.net", "backup.playlist.ttvnw.net");

// Twitch's GraphQL + usher + media playlists for the ad-free copy.
function backupRoutes({ backupMedia = clean, tokenFor = () => true } = {}) {
  return [
    { match: /gql\.twitch\.tv/, respond: (_, o) => {
      const { playerType } = JSON.parse(o.body).variables;
      return JSON.stringify({ data: { streamPlaybackAccessToken: tokenFor(playerType)
        ? { value: JSON.stringify({ player_type: playerType }), signature: "s" } : null } });
    } },
    { match: /usher\.ttvnw\.net/, respond: () => backupMaster },
    { match: /backup\.playlist\.ttvnw\.net/, respond: () => backupMedia },
  ];
}

async function withChannel(opts, { playerType = "site" } = {}) {
  const bg = await loadBackground(opts);
  const page = bg.connectPage({ url: "https://www.twitch.tv/k4sen" });
  const m = await bg.request(usherUrl("k4sen", playerType), { body: master });
  assert.equal(m.text, master, "master playlist must reach the player unchanged");
  return { bg, page };
}

test("a playlist request with tabId -1 (Zen) is still read and reported to the page", async () => {
  const { bg, page } = await withChannel({});
  const r = await bg.request(source, { tabId: -1, body: live });
  assert.equal(r.text, live);
  assert.equal(page.received.length, 1);
  assert.deepEqual({ ad: page.received[0].ad, channel: page.received[0].channel }, { ad: false, channel: "k4sen" });
});

test("the extension's own requests are not filtered", async () => {
  const bg = await loadBackground();
  const r = await bg.request(source, { originUrl: bg.OWN + "_generated_background_page.html", body: live });
  assert.equal(r.filtered, false);
});

test("non-playlist requests are not filtered", async () => {
  const bg = await loadBackground();
  const r = await bg.request("https://eus22.playlist.ttvnw.net/v1/segment/abc.ts");
  assert.equal(r.filtered, false);
});

test("reports go to the page in the request's tab when the browser knows it", async () => {
  const bg = await loadBackground();
  const a = bg.connectPage({ tabId: 1, url: "https://www.twitch.tv/k4sen" });
  const b = bg.connectPage({ tabId: 2, url: "https://www.twitch.tv/k4sen" });
  await bg.request(usherUrl("k4sen"), { tabId: 2, body: master });
  await bg.request(source, { tabId: 2, body: live });
  assert.equal(a.received.length, 0);
  assert.equal(b.received.length, 1);
});

test("without a tab, every connected page gets the report, with its channel", async () => {
  const bg = await loadBackground();
  const a = bg.connectPage({ url: "https://www.twitch.tv/k4sen" });
  const b = bg.connectPage({ url: "https://www.twitch.tv/other" });
  await bg.request(usherUrl("k4sen"), { body: master });
  await bg.request(source, { body: live });
  assert.equal(a.received[0].channel, "k4sen");
  assert.equal(b.received[0].channel, "k4sen"); // content.js on /other ignores it
});

test("a closed page stops getting reports", async () => {
  const bg = await loadBackground();
  const a = bg.connectPage();
  a.disconnect();
  await bg.request(source, { body: live });
  assert.equal(a.received.length, 0);
});

test("ad at the live edge, skip off: passed through, reported as an ad", async () => {
  const { bg, page } = await withChannel({ settings: { skipAds: false } });
  const r = await bg.request(source, { body: adEdge });
  assert.equal(r.text, adEdge);
  assert.equal(page.received.at(-1).ad, true);
});

test("ad segments still listed but the live edge is the stream: not an ad", async () => {
  const { bg, page } = await withChannel({ settings: { skipAds: false } });
  await bg.request(source, { body: adOld });
  assert.equal(page.received.at(-1).ad, false);
});

test("skip on: an ad-free copy replaces the playlist and the page hears it was skipped", async () => {
  const { bg, page } = await withChannel({ routes: backupRoutes() });
  const r = await bg.request(source, { body: adEdge });
  assert.equal(r.text, clean);
  assert.equal(page.received.at(-1).ad, false);
  assert.equal(page.received.at(-1).skipped, "embed");
  // Same quality as the playlist it replaces.
  const media = bg.fetched.filter((f) => f.url.includes("backup.playlist")).map((f) => f.url);
  assert.deepEqual(media, [mediaUrls(backupMaster)[0]]);
});

test("skip on: every copy has ads too, so the original goes through as an ad", async () => {
  const { bg, page } = await withChannel({ routes: backupRoutes({ backupMedia: adEdge }) });
  const r = await bg.request(source, { body: adEdge });
  assert.equal(r.text, adEdge);
  assert.equal(page.received.at(-1).ad, true);
  assert.equal(page.received.at(-1).skipFailed, true);
});

test("the backup token request names the channel and tries player types in order", async () => {
  const { bg } = await withChannel({ routes: backupRoutes({ tokenFor: (t) => t === "autoplay" }) });
  await bg.request(source, { body: adEdge });
  const asked = bg.fetched.filter((f) => f.url.includes("gql")).map((f) => JSON.parse(f.options.body).variables);
  assert.deepEqual(asked.map((v) => v.login), ["k4sen", "k4sen", "k4sen"]);
  assert.deepEqual(asked.map((v) => v.playerType), ["embed", "picture-by-picture", "autoplay"]);
});

test("the corner preview's own playlist passes straight through and isn't reported", async () => {
  const { bg, page } = await withChannel({ routes: backupRoutes() }, { playerType: "picture-by-picture" });
  const r = await bg.request(source, { body: adEdge });
  assert.equal(r.text, adEdge);
  assert.equal(page.received.length, 0);
  assert.equal(bg.fetched.length, 0);
});

test("turned off: playlists pass through untouched, even with an ad", async () => {
  const { bg } = await withChannel({ settings: { enabled: false }, routes: backupRoutes() });
  const r = await bg.request(source, { body: adEdge });
  assert.equal(r.text, adEdge);
  assert.equal(bg.fetched.length, 0);
});

// Real logged-out pre-roll ads, recorded by the ad hunt.
for (const name of ["real-preroll-start.m3u8", "real-preroll-later.m3u8"]) {
  test(`real Twitch ad (${name}): reported as an ad, and skipped when an ad-free copy exists`, async () => {
    const real = fixture(name);
    const off = await withChannel({ settings: { skipAds: false } });
    await off.bg.request(source, { body: real });
    assert.equal(off.page.received.at(-1).ad, true);

    const on = await withChannel({ routes: backupRoutes() });
    const r = await on.bg.request(source, { body: real });
    assert.equal(r.text, clean);
    assert.equal(on.page.received.at(-1).skipped, "embed");
  });
}

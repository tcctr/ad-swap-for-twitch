// The ad swap, in Zen, on a mock Twitch page: sound, enlarged preview, break screen, hand-back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useMockPage, near } from "./mockpage.mjs";

const t = useMockPage();
const breakRect = () => t.driver.executeScript(
  "const b = document.querySelector('[data-ad-swap-break]'); return b && b.getBoundingClientRect().toJSON()");
const UNMUTED = { muted: false, volume: 0.5 };

test("no ad: nothing changes", async () => {
  await t.sleep(1500);
  const s = await t.state();
  assert.equal(s.connected, true, "page script connected to background.js");
  assert.equal(s.inAd, false);
  assert.equal(s.breakScreen, false);
  assert.deepEqual(await t.mock("main()"), UNMUTED);
});

test("ad with a preview: ad muted, preview enlarged over the player with the stream's sound", async () => {
  await t.mock("startAd({ preview: true })");
  const s = await t.until((s) => s.inAd && s.enlarged, "preview enlarged");
  assert.equal(s.mainMuted, true);
  const now = await t.until((s) => s.previewMuted === false, "preview unmuted");
  assert.ok(near(now.previewRect, now.playerRect), `preview ${JSON.stringify(now.previewRect)} covers player ${JSON.stringify(now.playerRect)}`);
  assert.equal(now.breakScreen, false);
});

test("ad ends: stream sound and layout come back", async () => {
  await t.mock("startAd({ preview: true })");
  await t.until((s) => s.enlarged, "preview enlarged");
  await t.mock("endAd()");
  const s = await t.until((s) => !s.inAd, "ad over", 8000);
  assert.equal(s.enlarged, false);
  assert.equal(s.breakScreen, false);
  assert.deepEqual(await t.mock("main()"), UNMUTED);
});

test("ad without a preview: break screen covers the player, ad muted, then goes away", async () => {
  await t.mock("startAd({ preview: false })");
  const s = await t.until((s) => s.breakScreen, "break screen");
  assert.equal(s.mainMuted, true);
  assert.ok(near(await breakRect(), s.playerRect), "break screen covers the player");
  await t.mock("endAd()");
  await t.until((s) => !s.inAd, "ad over", 8000);
  assert.equal(await breakRect(), null);
  assert.deepEqual(await t.mock("main()"), UNMUTED);
});

test("preview arriving after the ad label: break screen first, then the enlarged preview", async () => {
  await t.mock("startAd({ preview: false })");
  await t.until((s) => s.breakScreen, "break screen");
  await t.mock("showPreview()");
  const s = await t.until((s) => s.enlarged && !s.breakScreen, "preview replaces break screen");
  assert.ok(near(s.previewRect, s.playerRect));
});

// From here on background.js is reporting playlists, as it does on real Twitch.
const KEY = "https://eus22.playlist.ttvnw.net/v1/playlist/test.m3u8";
const feed = (msg) => t.mock(`feed(${JSON.stringify(JSON.stringify({ type: "playlist", key: KEY, channel: "k4sen", ...msg }))})`);

test("a small video playing elsewhere with no ad doesn't start a swap", async () => {
  await feed({ ad: false });
  await t.mock("addStrayVideo()");
  await t.sleep(2000);
  const s = await t.state();
  assert.equal(s.inAd, false);
  assert.deepEqual(await t.mock("main()"), UNMUTED);
});

test("a preview in the player without Twitch loading the preview stream doesn't start a swap", async () => {
  await feed({ ad: false });
  await t.mock("showPreview()");
  await t.sleep(2000);
  assert.equal((await t.state()).inAd, false);
  assert.deepEqual(await t.mock("main()"), UNMUTED);
});

test("Twitch loads the preview stream and the preview plays: swap, even before the Ad label", async () => {
  await feed({ ad: false });
  await feed({ key: "", preview: true });
  await t.mock("showPreview()");
  const s = await t.until((s) => s.inAd && s.enlarged, "swap from the preview signal");
  assert.equal(s.adLabel, false);
  assert.equal(s.mainMuted, true);
});

test("busy chat doesn't make the extension check the page more often", async (c) => {
  const before = (await t.state()).ticks;
  await t.mock("spamChat(3000)");
  await t.sleep(3000);
  const rate = ((await t.state()).ticks - before) / 3;
  c.diagnostic(`${rate.toFixed(1)} checks/s`);
  assert.ok(rate <= 6, `${rate.toFixed(1)} checks per second during chat (the 250 ms timer alone is 4)`);
});

test("busy page outside chat: at most about 10 extra checks per second", async (c) => {
  const before = (await t.state()).ticks;
  await t.mock("spamPage(3000)");
  await t.sleep(3000);
  const rate = ((await t.state()).ticks - before) / 3;
  c.diagnostic(`${rate.toFixed(1)} checks/s`);
  assert.ok(rate <= 15, `${rate.toFixed(1)} checks per second`);
});

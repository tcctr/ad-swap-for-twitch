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

test("a small video playing elsewhere with no ad doesn't start a swap", { todo: "Phase 3: needs the preview playlist signal" }, async () => {
  await t.mock("addStrayVideo()");
  await t.sleep(2000);
  const s = await t.state();
  assert.equal(s.inAd, false);
  assert.deepEqual(await t.mock("main()"), UNMUTED);
});

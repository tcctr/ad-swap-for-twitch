// The ad swap, in Zen, on a mock Twitch page: sound, enlarged preview, break screen, hand-back.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { buildTestExtension, startZen, state, waitFor } from "./zen.mjs";

const page = readFileSync(new URL("./mock/twitch.html", import.meta.url));
let server, base, driver;

before(async () => {
  server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  driver = await startZen({ extension: buildTestExtension({ localhost: true }) });
});

after(async () => {
  if (driver) await driver.quit();
  server && server.close();
});

beforeEach(async () => {
  await driver.get(`${base}/k4sen`);
  await waitFor(() => state(driver), { what: "extension state on the page" });
  await waitFor(async () => (await state(driver)).playerRect, { what: "main video found" });
});

const mock = (call) => driver.executeScript(`return window.mock.${call}`);
const breakRect = () => driver.executeScript(
  "const b = document.querySelector('[data-ad-swap-break]'); return b && b.getBoundingClientRect().toJSON()");
const near = (a, b, px = 2) => ["left", "top", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= px);

test("no ad: nothing changes", async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const s = await state(driver);
  assert.equal(s.connected, true, "page script connected to background.js");
  assert.equal(s.inAd, false);
  assert.equal(s.breakScreen, false);
  assert.deepEqual(await mock("main()"), { muted: false, volume: 0.5 });
});

test("ad with a preview: ad muted, preview enlarged over the player with the stream's sound", async () => {
  await mock("startAd({ preview: true })");
  const s = await waitFor(async () => { const s = await state(driver); return s.inAd && s.enlarged && s; },
                          { what: "preview enlarged" });
  assert.equal(s.mainMuted, true);
  await waitFor(async () => (await state(driver)).previewMuted === false, { what: "preview unmuted" });
  const now = await state(driver);
  assert.ok(near(now.previewRect, now.playerRect), `preview ${JSON.stringify(now.previewRect)} covers player ${JSON.stringify(now.playerRect)}`);
  assert.equal(now.breakScreen, false);
});

test("ad ends: stream sound and layout come back", async () => {
  await mock("startAd({ preview: true })");
  await waitFor(async () => (await state(driver)).enlarged, { what: "preview enlarged" });
  await mock("endAd()");
  await waitFor(async () => !(await state(driver)).inAd, { what: "ad over", timeout: 8000 });
  const s = await state(driver);
  assert.equal(s.enlarged, false);
  assert.equal(s.breakScreen, false);
  assert.deepEqual(await mock("main()"), { muted: false, volume: 0.5 });
});

test("ad without a preview: break screen covers the player, ad muted, then goes away", async () => {
  await mock("startAd({ preview: false })");
  const s = await waitFor(async () => { const s = await state(driver); return s.breakScreen && s; }, { what: "break screen" });
  assert.equal(s.mainMuted, true);
  assert.ok(near(await breakRect(), s.playerRect), "break screen covers the player");
  await mock("endAd()");
  await waitFor(async () => !(await state(driver)).inAd, { what: "ad over", timeout: 8000 });
  assert.equal(await breakRect(), null);
  assert.deepEqual(await mock("main()"), { muted: false, volume: 0.5 });
});

test("preview arriving after the ad label: break screen first, then the enlarged preview", async () => {
  await mock("startAd({ preview: false })");
  await waitFor(async () => (await state(driver)).breakScreen, { what: "break screen" });
  await mock("showPreview()");
  const s = await waitFor(async () => { const s = await state(driver); return s.enlarged && !s.breakScreen && s; },
                          { what: "preview replaces break screen" });
  assert.ok(near(s.previewRect, s.playerRect));
});

test("a small video playing elsewhere with no ad doesn't start a swap", { todo: "Phase 3: needs the preview playlist signal" }, async () => {
  await mock("addStrayVideo()");
  await new Promise((r) => setTimeout(r, 2000));
  const s = await state(driver);
  assert.equal(s.inAd, false);
  assert.deepEqual(await mock("main()"), { muted: false, volume: 0.5 });
});

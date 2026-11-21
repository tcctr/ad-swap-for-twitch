// The extension on real twitch.tv in headless, muted Zen, logged out.
// Checks that it loads and that background.js sees the stream's playlists (the 2.2.6–2.3.4 bug).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildTestExtension, startZen, state, waitFor } from "../e2e/zen.mjs";
import { topChannels, passContentGate } from "./twitch.mjs";

let driver, channel;

before(async () => {
  [channel] = await topChannels(1);
  driver = await startZen({ extension: buildTestExtension() });
});
after(async () => { if (driver) await driver.quit(); });

test("on a live channel the stream plays and background.js reports its playlists", async (t) => {
  t.diagnostic(`channel: ${channel}`);
  await driver.get(`https://www.twitch.tv/${channel}`);
  const s = await waitFor(async () => { const s = await state(driver); return s && s.playlistsSeen > 0 && s; },
                          { timeout: 30000, what: "playlistsSeen > 0" });
  assert.equal(s.connected, true);
  await waitFor(async () => {
    await passContentGate(driver);
    return driver.executeScript("return [...document.querySelectorAll('video')].some(v => !v.paused && v.currentTime > 1)");
  },
    { timeout: 30000, what: "a video playing" });
  t.diagnostic(`state: ${JSON.stringify({ inAd: s.inAd, playlistsSeen: s.playlistsSeen, adLabel: s.adLabel })}`);
});

// What content.js does with background.js's playlist reports, in Zen on the mock page. The reports
// are fed through the test build's hook, in the same shape background.js sends them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useMockPage } from "./mockpage.mjs";

const t = useMockPage();
const KEY = "https://eus22.playlist.ttvnw.net/v1/playlist/test.m3u8";
const report = (msg) => t.mock(`feed(${JSON.stringify(JSON.stringify({ type: "playlist", key: KEY, channel: "k4sen", ...msg }))})`);
// Like the player: a report every 2 s, `times` times, without blocking the test.
const reportEvery = (msg, times) => t.mock(`feedEvery(${JSON.stringify(JSON.stringify({ type: "playlist", key: KEY, channel: "k4sen", ...msg }))}, ${times})`);

test("an ad in the playlist brings up the break screen before Twitch's Ad label, and ends with it", async () => {
  await report({ ad: true });
  const s = await t.until((s) => s.breakScreen, "break screen from the playlist alone");
  assert.equal(s.adLabel, false);
  assert.equal(s.mainMuted, true);
  await report({ ad: false });
  await t.until((s) => !s.inAd, "ad over once the playlist is clean", 10000);
  assert.deepEqual(await t.mock("main()"), { muted: false, volume: 0.5 });
});

test("a report about another channel is ignored", async () => {
  await t.mock(`feed(${JSON.stringify(JSON.stringify({ type: "playlist", key: KEY, channel: "someoneelse", ad: true }))})`);
  await t.sleep(1000);
  assert.equal((await t.state()).inAd, false);
});

test("while the ad-free copy plays, Twitch's leftover Ad label doesn't cover the stream", async () => {
  await reportEvery({ ad: false, skipped: "embed" }, 4);
  await t.until((s) => s.skipping, "skip reported");
  await t.mock("startAd({ preview: false })");
  await t.sleep(1500);
  const s = await t.state();
  assert.equal(s.inAd, false);
  assert.equal(s.breakScreen, false);
});

test("player stuck right after switching to the ad-free copy: one pause and play", async () => {
  await t.mock("stallMain()");
  await report({ ad: false, skipped: "embed" });
  await t.until((s) => s.nudges === 1, "nudge", 6000);
  assert.ok((await t.mock("pauses()")) >= 1, "the main video was paused and played");
  await t.sleep(6000);
  assert.ok((await t.state()).nudges <= 2, "at most two nudges");
});

test("player stuck with no copy switch: left alone", async () => {
  await t.mock("stallMain()");
  await t.sleep(4000);
  assert.equal((await t.state()).nudges, 0);
  assert.equal(await t.mock("pauses()"), 0);
});

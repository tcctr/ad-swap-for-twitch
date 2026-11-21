// "Skip ads" against the real Twitch API: the real background.js gets a real pre-roll playlist
// and must come back with an ad-free copy of the same stream from Twitch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground, usherUrl } from "../unit/harness.mjs";
import { topChannels, playbackToken, masterPlaylist } from "./twitch.mjs";

// A channel whose main-player stream starts with an ad right now (logged-out pre-roll).
async function channelWithAd() {
  for (const channel of await topChannels(10)) {
    const master = await masterPlaylist(channel, await playbackToken(channel, "site"));
    const media = master.split("\n").find((l) => l.startsWith("http"));
    const text = await (await fetch(media)).text();
    if (text.includes("stitched")) return { channel, master, media, text };
  }
  return null;
}

test("a real pre-roll is replaced by Twitch's ad-free copy of the stream", async (t) => {
  const found = await channelWithAd();
  if (!found) return t.skip("no channel had a pre-roll right now");
  t.diagnostic(`channel: ${found.channel}`);
  const bg = await loadBackground({ realFetch: true });
  const page = bg.connectPage({ url: `https://www.twitch.tv/${found.channel}` });
  await bg.request(usherUrl(found.channel), { body: found.master });
  const r = await bg.request(found.media, { body: found.text });
  const last = page.received.at(-1);
  t.diagnostic(`report: ${JSON.stringify({ ad: last.ad, skipped: last.skipped, skipFailed: last.skipFailed })}`);
  assert.ok(last.skipped, "skipped via an ad-free copy");
  assert.ok(!r.text.includes("stitched"), "no ad in what the player gets");
  assert.match(r.text, /#EXTINF:[\d.]+,live/, "it is the live stream");
});

// Looks for real Twitch ads, logged out, to learn what they look like and test against them.
//   node tests/live/ad-hunt.mjs [channels=8] [--zen]
// 1. For the top live channels, asks for the stream as each Twitch player type and polls its
//    media playlist: prints which player types carry ads, and saves any playlist with an ad
//    (sanitized) to tests/fixtures/recorded/ for the unit tests.
// 2. With --zen, also opens each channel in headless, muted Zen with the extension and records
//    what it did when an ad came (state + screenshot in tests/live/out/).
import { mkdirSync, writeFileSync } from "node:fs";
import { sanitize } from "../tools/sanitize.mjs";
import { topChannels, playbackToken, masterPlaylist, passContentGate } from "./twitch.mjs";

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) || 8);
const useZen = args.includes("--zen");
const recorded = new URL("../fixtures/recorded/", import.meta.url);
const out = new URL("./out/", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const PLAYER_TYPES = [["site", "web"], ["embed", "web"], ["popout", "web"], ["autoplay", "android"],
                      ["picture-by-picture", "web"]];

async function pollPlayerType(channel, playerType, platform) {
  const token = await playbackToken(channel, playerType, platform);
  if (!token) return "no token";
  const master = await masterPlaylist(channel, token);
  const media = master.split("\n").find((l) => l.startsWith("http"));
  if (!media) return "no stream";
  let seen = "clean";
  for (let i = 0; i < 4; i++) {
    const text = await (await fetch(media)).text();
    if (text.includes("stitched")) {
      seen = "AD";
      mkdirSync(recorded, { recursive: true });
      writeFileSync(new URL(`${stamp()}-${channel}-${playerType}.m3u8`, recorded), sanitize(text));
    }
    await sleep(2000);
  }
  return seen;
}

async function viaPlaylists(channels) {
  const rows = [];
  for (const channel of channels) {
    const row = { channel };
    await Promise.all(PLAYER_TYPES.map(async ([pt, platform]) => {
      try { row[pt] = await pollPlayerType(channel, pt, platform); } catch (e) { row[pt] = `error: ${e.message}`; }
    }));
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  console.table(rows);
}

async function viaZen(channels) {
  const { buildTestExtension, startZen, state } = await import("../e2e/zen.mjs");
  mkdirSync(out, { recursive: true });
  for (const channel of channels) {
    const driver = await startZen({ extension: buildTestExtension() }); // fresh profile: pre-rolls are likelier
    try {
      await driver.get(`https://www.twitch.tv/${channel}`);
      let sawAd = false;
      const log = [];
      for (let i = 0; i < 80; i++) { // ~40 s
        await passContentGate(driver);
        const s = await state(driver);
        if (s && (s.inAd || s.adLabel || s.playlistAd || s.skipping || Object.values(s.reports).some(Boolean))) {
          log.push({ t: i / 2, ...s });
          if (!sawAd) {
            sawAd = true;
            await sleep(1500);
            writeFileSync(new URL(`${stamp()}-${channel}.png`, out), await driver.takeScreenshot(), "base64");
          }
        }
        await sleep(500);
      }
      if (log.length) writeFileSync(new URL(`${stamp()}-${channel}.json`, out), JSON.stringify(log, null, 1));
      const last = await state(driver);
      console.log(`${channel}: reports ${JSON.stringify(last && last.reports)}, playlists ${last && last.playlistsSeen}; ${sawAd ? `ad handled, see tests/live/out (${log.length} states)` : "no ad in 40 s"}`);
    } finally {
      await driver.quit();
    }
  }
}

const channels = await topChannels(count);
await viaPlaylists(channels);
if (useZen) await viaZen(channels);

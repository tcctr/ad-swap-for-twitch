# Test fixtures

- `master.m3u8`, `media-live.m3u8`: real Twitch playlists (2026-11-21), run through
  `tests/tools/sanitize.mjs` (no IP, country, session IDs or signed tokens).
- `media-ad-edge.m3u8` (ad at the live edge), `media-ad-old.m3u8` (ad already over, still listed),
  `media-backup-clean.m3u8`: **synthetic**, written in the format Twitch uses for stitched ads
  (`CLASS="twitch-stitched-ad"`, ad segments not titled `live`). Replace them with real ones from
  `recorded/` once `npm run ad-hunt` has caught an ad.
- `real-preroll-start.m3u8`, `real-preroll-later.m3u8`: real logged-out pre-roll ads (2026-11-21, `site`
  player type), recorded by the ad hunt and sanitized (RADS token, ad session and beacon IDs removed).
- `recorded/` (not committed): raw output of `npm run ad-hunt`, already sanitized. Copy good ones up here.

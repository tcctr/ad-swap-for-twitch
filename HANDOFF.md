# Ad Swap for Twitch: project notes

Firefox/Zen extension (Manifest V2), published on addons.mozilla.org as "Ad Swap for Twitch".
No build step: these files are the source and get zipped as-is for upload.

## Files
- `manifest.json`: version, permissions (storage only), Gecko ID `twitch-ad-swap-7f3c2a@extensions`.
  Minimum Firefox 140 (142 on Android) because of `data_collection_permissions`.
- `defaults.js`: default settings shared by everything. Only the ad features are on by default.
- `content.js`: the ad swap. Detects ads (Twitch's "Ad" label, or the corner preview playing),
  mutes the ad, plays the corner preview's sound, enlarges the preview over the player
  (position: fixed to the player's rect, with offset correction for transformed ancestors),
  shows a break screen when there is no preview, and hands back to the stream at the end
  without a black gap (keeps the preview up until the main video is moving again, max 4 s).
- `cleanup.js`: optional page tweaks (sidebar options, "Viewers Also Watch", Browse button,
  top-bar icons, Following redirects for logged-in users).
- `popup.html` / `popup.js`: the settings menu, also used as the add-on's options page.
  Settings are saved with `storage.sync`.
- `LISTING.md`: text for the addons.mozilla.org listing and version notes.

## Releasing an update
1. Bump `version` in `manifest.json`.
2. Zip only the extension files:
   `zip -r ad-swap-for-twitch-X.Y.Z.zip manifest.json defaults.js content.js cleanup.js popup.html popup.js icon.svg icons`
3. Check it: `npx web-ext lint --source-dir ad-swap-for-twitch-X.Y.Z.zip`
4. Upload on addons.mozilla.org: Ad Swap for Twitch, Upload New Version. Answer "No" to source code.

## Testing locally
`npx web-ext run` in this folder starts Firefox with the extension loaded, or use
about:debugging in Zen, then Load Temporary Add-on, and pick `manifest.json`.

## Known gaps
- Twitch's page markup was matched from best guesses and confirmed by hand-testing in Zen;
  if something stops working, Twitch probably changed its markup. Turn on Debug logging.
- Fullscreen during a real ad was never confirmed.
- "Viewers Also Watch" and "Live Channels" are found by their English names.

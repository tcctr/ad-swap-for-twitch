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
  top-bar icons, Following redirects for logged-in users). Each left-sidebar part has its own
  "Hide" setting. Sections are tagged `data-tas-side="followed|live|also-watch"` by the kind of
  channel card they hold (`data-test-selector="followed-channel|recommended-channel|similarity-channel"`),
  which works in any language. The collapsed sidebar's cards have no such attribute, so there
  it uses section labels seen in the expanded sidebar, the channel's name (for "Viewers Also
  Watch"), then the English names. The "Show More" buttons and collapse arrow are hidden by
  their `data-a-target`. The page-wide "Viewers Also Watch" option skips the sidebar.
- `defaults.js` also holds `TAS_MIGRATE`: users of 2.0.1 who had "Viewers Also Watch" on get
  the new sidebar option switched on once.
- `popup.html` / `popup.js`: the settings menu, also used as the add-on's options page.
  Settings are saved with `storage.sync`.
- `LISTING.md`: text for the addons.mozilla.org listing and version notes.

## Releasing an update
1. Bump `version` in `manifest.json`.
2. Zip only the extension files:
   `zip -r ad-swap-for-twitch-X.Y.Z.zip manifest.json defaults.js content.js cleanup.js popup.html popup.js icon.svg icons`
3. Check it: `npx web-ext lint --source-dir ad-swap-for-twitch-X.Y.Z.zip`
4. Add the version notes to `LISTING.md`, and save them as AMO metadata JSON outside the repo:
   `{"version": {"release_notes": {"en-US": "..."}}}`
5. Upload with the AMO API. The keys are in `../amo-credentials.sh` (the folder above this repo,
   never committed):
   `source ../amo-credentials.sh && npx web-ext sign --channel=listed --amo-metadata <json> --ignore-files HANDOFF.md LISTING.md README.md LICENSE '*.zip' screenshot-menu.png`
   The signed copy lands in `web-ext-artifacts/`. Check AMO for existing versions first: a version
   number can't be reused. Fallback: Upload New Version on the Developer Hub, answer "No" to
   source code.
6. Update the status notes below.

## Testing locally
`npx web-ext run` in this folder starts Firefox with the extension loaded, or use
about:debugging in Zen, then Load Temporary Add-on, and pick `manifest.json`.

## Known gaps
- Twitch's page markup was matched from best guesses and confirmed by hand-testing in Zen;
  if something stops working, Twitch probably changed its markup. Turn on Debug logging.
- "Viewers Also Watch" outside the sidebar is found by its English name, and so are
  Followed/Live Channels in the collapsed sidebar if the expanded one wasn't seen first.
- The Followed Channels marker (`followed-channel`) was never seen: all checks so far were
  logged out. Check it logged in, with Debug logging on (it logs each section it tags).

## Status (2026-11-07)
- Live on addons.mozilla.org: 2.2.0 (uploaded 2026-10-31, the sidebar commit 6c4b645, without
  the ad fix below). 2.1.0 was never uploaded. 2.2.1, the ad fix, was submitted 2026-11-01
  and is awaiting review.
- Uploads: see "Releasing an update" above.
- 2.2.0 includes:
  - the break screen;
  - the smoother end of ads;
  - faster ad detection;
  - one "Hide" option per left-sidebar part (whole sidebar, Followed Channels, Live Channels,
    Viewers Also Watch, "Show More" buttons, collapse arrow). This replaced "Show only
    Followed Channels".
- The sidebar options were tested on real twitch.tv, logged out, by injecting `defaults.js` and
  `cleanup.js` into headless Chromium:
  - each option on its own and combined;
  - expanded and collapsed sidebar;
  - English and German.
  Not yet checked: logged in (Followed Channels), and inside Firefox/Zen itself.
- Fixed in 2.2.1 (2026-11-01) after hand-testing on real Twitch: the break screen showed even when there
  was a preview and stayed after the ad. Causes: hidden "Ad" labels left in the page counted as
  an ad; a preview element reused by the next ad stayed blocked; the first small video was locked
  in as the preview even if it wasn't playing. Now only visible labels count, the preview is
  re-picked from playing videos, and the enlarged preview sits above the break screen.
  Checked on a stand-in player only (Twitch serves no ads to headless browsers); confirm on real
  ad breaks.
- 2.2.2 (submitted to AMO 2026-11-02, accepted 2026-11-02, so live with the fullscreen bug) tried to stop the swap starting without an ad (seen on a
  subscribed channel) by only counting a preview inside the player or a "picture-by-picture"
  container. It did not fix that and broke the swap in fullscreen, so the `content.js` change was
  reverted on 2026-11-03 and released as 2.2.3 (same `content.js` as 2.2.1). The no-ad swap is
  still open. 2.2.3 was uploaded with `web-ext sign` on 2026-11-03 and
  approved and signed straight away.
- 2.2.4 (uploaded with `web-ext sign` on 2026-11-07, approved and signed straight away):
  the break screen shows as soon as an ad is detected (the 1 s wait for a preview is gone;
  a late preview still sits above it). Debug logging adds time, buffer and dropped frames per
  video, to look into the stream sound running ahead of the picture with an enlarged preview
  (reported by the user, cause unknown). Not yet tested on real ad breaks.
- Store icon: `icons/icon-128.png` (128×128, transparent) is ready but still has to be
  uploaded on the Developer Hub product page. `screenshot-menu.png` shows the 2.2.0 menu.

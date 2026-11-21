# Ad Swap for Twitch: project notes

Firefox/Zen extension (Manifest V2), published on addons.mozilla.org as "Ad Swap for Twitch".
No build step: these files are the source and get zipped as-is for upload.

## Files
- `manifest.json`: version, permissions (storage, plus webRequest/webRequestBlocking on
  `*.hls.ttvnw.net`, `*.playlist.ttvnw.net`, `usher.ttvnw.net` and `*.twitch.tv` (the page
  itself must be covered too, or Firefox hides its requests) to read the stream playlists), Gecko ID `twitch-ad-swap-7f3c2a@extensions`.
  Minimum Firefox 140 (142 on Android) because of `data_collection_permissions`.
- `defaults.js`: default settings shared by everything. Only the ad features are on by default.
- `content.js`: the ad swap. Detects ads (Twitch's "Ad" label, or the corner preview playing),
  mutes the ad, plays the corner preview's sound, enlarges the preview over the player
  (position: fixed to the player's rect, with offset correction for transformed ancestors),
  shows a break screen when there is no preview, and hands back to the stream at the end
  without a black gap (keeps the preview up until the main video is moving again, max 4 s).
- `background.js`: reads each Twitch media playlist (`*.playlist.ttvnw.net/*.m3u8`, e.g. `eus21.playlist.ttvnw.net`; `*.hls.ttvnw.net` kept too) as it passes,
  unchanged, and tells the tab whether its newest segment is an ad (playlist mentions
  `stitched` and the last `#EXTINF` isn't titled `live`). This arrives before the ad is on
  screen; `content.js` treats it as an ad start, so the break screen covers the first frame.
  A playlist signal from before the last ad ended is ignored (old ad segments stay listed).
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
   `zip -r ad-swap-for-twitch-X.Y.Z.zip manifest.json background.js defaults.js content.js cleanup.js popup.html popup.js icon.svg icons`
3. Check it: `npm test` must pass (see Testing), then `npx web-ext lint --source-dir ad-swap-for-twitch-X.Y.Z.zip`
4. Add the version notes to `LISTING.md`, and save them as AMO metadata JSON outside the repo:
   `{"version": {"release_notes": {"en-US": "..."}}}`
5. Upload with the AMO API. The keys are in `../amo-credentials.sh` (the folder above this repo,
   never committed):
   `source ../amo-credentials.sh && npx web-ext sign --channel=listed --amo-metadata <json> --ignore-files HANDOFF.md LISTING.md README.md LICENSE CLAUDE.md '*.zip' screenshot-menu.png tests package.json package-lock.json node_modules web-ext-artifacts`
   The signed copy lands in `web-ext-artifacts/`. Check AMO for existing versions first: a version
   number can't be reused. Fallback: Upload New Version on the Developer Hub, answer "No" to
   source code.
6. Update the status notes below.

## Testing
Automated, in Zen itself (`/Applications/Zen.app`, or set `ZEN_BINARY`), headless and muted: no window
opens and no sound plays (a Zen icon may show in the Dock while it runs). Run `npm install` once.
- `npm test`: unit tests + Zen mock-page tests. Must pass before any release.
  - `tests/unit/`: the real `background.js` in a fake WebExtension API (`harness.mjs`), fed real
    and synthetic playlists from `tests/fixtures/` (see its README).
  - `tests/e2e/`: Zen with a test copy of the extension (Debug on, page scripts also on 127.0.0.1)
    on `tests/e2e/mock/twitch.html`, a stand-in Twitch player whose ad label and corner preview the
    tests switch on and off. Checks sound, enlarged preview, break screen and hand-back.
- `npm run test:live`: Zen on a real top channel (logged out): extension connected and
  `playlistsSeen > 0`.
- `npm run ad-hunt [n] [--zen]`: asks Twitch for the top n channels' streams as each player type,
  prints which carry ads, and saves sanitized ad playlists to `tests/fixtures/recorded/` (not
  committed). `--zen` also watches each channel in Zen. Twitch served no ads to automated Zen
  (2026-11-21), so real ad breaks still need a human session with Debug logging.
- Tests read the extension's state from `<html data-tas-state>`, which `content.js` writes only
  while Debug logging is on.
- Selenium's driver lookup misreads Zen's version (1.x) as Firefox 1; `tests/e2e/zen.mjs`
  fetches geckodriver directly and starts Zen with `-no-remote -new-instance`.
- By hand: about:debugging in Zen, then Load Temporary Add-on, and pick `manifest.json`.

## Known gaps
- Twitch's page markup was matched from best guesses and confirmed by hand-testing in Zen;
  if something stops working, Twitch probably changed its markup. Turn on Debug logging.
- "Viewers Also Watch" outside the sidebar is found by its English name, and so are
  Followed/Live Channels in the collapsed sidebar if the expanded one wasn't seen first.
- The Followed Channels marker (`followed-channel`) was never seen: all checks so far were
  logged out. Check it logged in, with Debug logging on (it logs each section it tags).

## 2.3.5 (uploaded listed with `web-ext sign` on 2026-11-21, approved and signed straight away)
Signed xpi in `web-ext-artifacts/`, AMO metadata in `../amo-metadata-2.3.5.json`. Lint clean,
`npm test` and `npm run test:live` pass. No new permissions. The ad swap itself (mute, enlarged
preview) still hasn't been seen on a real ad break: Twitch serves no ads to automated Zen.
Changes since 2.3.4:
- Fix: in Zen every webRequest has `tabId -1` and `tabs.query` lists no tabs (seen in automated
  Zen 1.24.1b, headless and visible). `background.js` skipped all `tabId < 0` requests as its own,
  so playlist reading and "Skip ads" never ran there (Debug showed `playlistsSeen: 0`). Now its own
  requests are recognised by their `moz-extension://` origin, and reports go over a
  `runtime.connect` port opened by `content.js` (matched by tab when known; otherwise sent to every
  Twitch page with the channel, and a page showing another channel ignores it). Confirmed on real
  Twitch in Zen: `playlistsSeen` > 0.
- Debug logging also writes `<html data-tas-state>` (for the tests) and counts playlist reports.
- Ad hunt (2026-11-21, logged out): pre-rolls on 4 of 8 top channels for the `site` player type;
  `embed`, `popout`, `autoplay` (platform android) and `picture-by-picture` were all ad-free.
- "Skip ads" (Phase 2): player types are now vaft's (`embed`, `popout`, `autoplay` on platform
  `android`); the token request reuses the headers the page sends to gql.twitch.tv (integrity,
  device ID, login, client version and session); playlist refreshes during an ad share one search,
  and after a search finds no ad-free copy the original goes straight through for 30 s instead of
  being held up to 4 s on every refresh. `npm run test:live` includes `tests/live/skip.test.mjs`:
  the real background.js got a real pre-roll and came back with Twitch's ad-free copy (`embed`,
  2026-11-21).
- `content.js`: for 15 s after the player moves between Twitch's copy and the ad-free one, a main
  video that is playing but hasn't moved for 2.5 s gets a pause and play (at most twice). Checked on
  the mock page only; whether the real player needs it is unknown.
- Not done on purpose: replacing ad segments with a blank video when there is no ad-free copy
  (vaft does this). The real player's reaction can't be tested automatically (Twitch serves no ads
  to automated Zen) and a wrong guess would break playback; the break screen still covers that case.
- Test-only hook: when `globalThis.TAS_TEST` is set (only the test build sets it) the page can
  feed playlist reports with a `tas-test-playlist` event.
- Phase 3: `background.js` tells the page when Twitch loads the corner preview's stream (a master
  playlist whose token says `picture-by-picture`, and that stream's refreshes). A small playing
  video only starts a swap on its own within 8 s of that signal, so other small videos no longer
  start one (the open "swap without an ad" bug). The "Ad" label and the playlist hint still start
  an ad as before. If background.js reports nothing at all (`playlistsSeen` 0, playlists not
  readable), the old video-only rule applies. Not yet seen on a real ad: check the Debug log for
  "Twitch is loading the corner preview's stream" before "ad started ... (preview playing)".
- Page checks are throttled to one per 100 ms on top of the 250 ms timer, and changes inside chat
  are ignored: busy chat went from ~51 to 4 checks a second, other busy page changes to ~14
  (mock-page tests). The enlarged preview and break screen now correct their position for
  transformed ancestors in the same pass instead of on the next check.
- Phase 4 (page tweaks, real twitch.tv logged out, `tests/live/tweaks.test.mjs`): the whole
  sidebar, Live Channels, Viewers Also Watch, Show More, the arrow (expanded and collapsed sidebar),
  Browse and the top-bar icons all work; everything off leaves the page alone. Two bugs found and
  fixed: (1) logged out, "Open Following instead of the home page" redirected anyway, because
  logged-out pages also have `user-menu-toggle`; login is now read from Twitch's login cookies only
  (`login`, `auth-token`, `twilight-user`; unverified logged in, as no test login is used);
  (2) "Top-bar icons" hid the Search button (the only way into search on narrow windows) and
  Browse; both are kept now. Twitch markup seen 2026-11-21: sidebar sections are
  `[role="group"]` with aria-labels "Live Channels" / "<channel> Viewers Also Watch" (chat
  messages are `[role="group"]` too), cards `recommended-channel` / `similarity-channel`; the
  sidebar collapses below ~1500 px window width. "Viewers Also Watch" outside the sidebar wasn't
  on any page checked (channel, home, directory), so `hideAlsoWatch` stays untested.
- Still untested (need a login): Followed Channels, the Following page options and redirects.

## Status (2026-11-11)
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
- 2.2.5 (uploaded with `web-ext sign` on 2026-11-11, approved and signed straight away):
  in fullscreen the sound comes from the preview copy on screen and every other video is muted;
  ads are detected sooner (class/style changes and video events also trigger a check); a preview
  only counts if Twitch shows it with a real size and, in fullscreen, inside the fullscreen
  element. That fixes an ad playing uncovered in fullscreen with no preview: a debug log showed
  Twitch keeping a collapsed `picture-by-picture-player` (340x0) playing, which suppressed the
  break screen. May also fix the swap starting on subscribed channels (not confirmed).
  Not yet tested on real ad breaks. The preview running ~4 s ahead of the stream is the gap
  between Twitch's two feeds; the extension never moves playback time.
- 2.2.6 (uploaded with `web-ext sign` on 2026-11-13, approved and signed straight away): with no preview the ad still showed for about a
  second before the break screen, because the on-page "Ad" label appears after the ad does.
  New `background.js` reads the stream playlists, where Twitch marks stitched ads before the
  player shows them, so the ad is muted and covered from its first frame. Side effect: the
  break screen can come up a couple of seconds before the ad itself. Adds the webRequest
  permissions (users get asked on update). Not yet tested on real ad breaks: confirm in Zen
  with Debug logging ("ad in the stream's playlist", then "ad started ... (playlist)").
- 2.2.7 (uploaded with `web-ext sign` on 2026-11-14, approved and signed straight away): 2.2.6's playlist check never ran, because
  Twitch serves media playlists from `*.playlist.ttvnw.net` (seen: `eus21.playlist.ttvnw.net`),
  not `*.hls.ttvnw.net`; with a preview the swap was still instant because the preview itself
  triggers it. Adds that host (new permission prompt on update). Debug logging now prints the
  end of any playlist with an ad marker and how long after the playlist hint the "Ad" label
  appeared. Not yet tested on real ad breaks.
- 2.3.0 (signed unlisted on 2026-11-14 as a test build for the user, not on the listing):
  "Skip ads when Twitch allows it" (`skipAds`, on by default). `background.js` reads the master
  playlist from `usher.ttvnw.net` to map each media playlist to its channel and quality; when a
  media playlist has ad segments it asks `gql.twitch.tv` for another playback token (player types
  embed, picture-by-picture, autoplay), loads that copy's media playlist of the same quality, and
  hands it to the player if it has no ads. Otherwise (or after 4 s) the original goes through and
  the swap/break screen covers the ad. New permissions: `usher.ttvnw.net`, `gql.twitch.tv`.
  Not yet tested on real ads. Before a listed release, rewrite the AMO description: it says the
  add-on "doesn't block or skip anything" and "talks to no servers", both untrue from 2.3.0.
  The next listed version must be 2.3.1 or later (2.3.0 is used).
- 2.3.1 (same code as 2.3.0, uploaded listed with `web-ext sign` 2026-11-14, approved and signed straight away at the user's request, before testing on
  real ads). LISTING.md summary and description were rewritten for skipping ads.
- 2.3.2 (uploaded listed with `web-ext sign` on 2026-11-16, approved and signed straight away): the real reason 2.2.6–2.3.1's playlist reading never ran: Firefox only
  lets webRequest see a request if the add-on has host permission for the requested URL *and*
  the page that made it, and the manifest had no `twitch.tv` host permission (content script
  matches don't count). Added `*://*.twitch.tv/*` (replaces `gql.twitch.tv`). The Debug status
  line now has `playlistsSeen`: if it stays 0 on a playing stream, background.js still sees nothing.
  Also new: Following-page options (`hideFollowingRecommended`, `hideFollowingContinue`,
  `hideFollowingVideos`, `hideFollowingUpcoming`, `hideFollowingCategories`) in `cleanup.js`. Sections are found by English heading text; the
  hidden block is the biggest ancestor holding only that heading (tagged `data-tas-following`).
  Written without seeing Twitch's Following markup: with Debug logging on, every heading found
  is logged as `Following section: "..." kind|(kept)`. Untested.
  `hideFollowingTabs` hides the Live/Videos/Categories/Channels tabs by their links
  (`/directory/following/live|videos|categories|games|channels`), tagged `data-tas-following-tab`.
- 2.3.3 (uploaded listed with `web-ext sign` on 2026-11-16, approved and signed straight away): 2.3.2's Following options hid only the section titles,
  because the cards inside have headings too and the climb stopped at the first block holding
  two. Now only headings styled like the title (same tag and class) or named like a section
  count as other sections, the climb stops below the tab bar, and it is redone every pass.
  Checked on a mock page with jsdom, not yet on real Twitch.
- 2.3.4 (uploaded listed with `web-ext sign` on 2026-11-16, approved and signed straight away): user saw the break screen instead of the preview on
  ads with a preview, once 2.3.2 made playlist reading work. Likely causes, both fixed without a
  log to confirm: (1) the preview player's own playlist went through "Skip ads" and was held up
  to 4 s; master playlists now record the token's `player_type` and `picture-by-picture`
  playlists are passed straight through and not reported; (2) Twitch's "Ad" label can show
  while the main player is on the ad-free copy; for 6 s after each "skipped" report the label
  and playlist hint are ignored (a playing preview still counts).
- Store icon: `icons/icon-128.png` (128×128, transparent) is ready but still has to be
  uploaded on the Developer Hub product page. `screenshot-menu.png` shows the 2.2.0 menu.

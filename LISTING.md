# Ad Swap for Twitch: addons.mozilla.org listing

Copy each field into the matching box on the submission form.

## Name
Ad Swap for Twitch

## Summary (max 250 characters)
Keep watching during Twitch ads. Ad Swap skips the ad when Twitch has an ad-free copy of the stream, and otherwise mutes it and enlarges the small live preview over it, or covers it with a break screen.

## Description
When an ad break starts on Twitch, Ad Swap for Twitch keeps the stream in front of you:

• Skips the ad when Twitch offers an ad-free copy of the stream (the kind its embedded players use), so the stream just keeps playing. Can be switched off in the menu
• Otherwise, when Twitch keeps the live stream playing in a small, muted box in the corner, Ad Swap makes that the main thing you watch:
• Mutes the ad and plays the stream's sound at your usual volume
• Enlarges the stream to cover the whole player, including in fullscreen
• Puts everything back the moment the ad break ends, without a black gap
• No preview this time? Shows a calm break screen with the ad countdown instead of the ad

With "Skip ads" on, skipped ads don't play, so channels don't get credit for them. Switch it off to let ads play with only the swap and break screen.

Optional page tweaks (all off by default, switch them on in the extension's menu):
• Hide the whole left sidebar, or each part of it on its own: Followed Channels, Live Channels (Recommended Channels), Viewers Also Watch, the "Show More" buttons and the collapse arrow
• Hide "Viewers Also Watch" elsewhere on the page (when Twitch is in English)
• Hide the Browse button
• Hide top-bar icons, keeping notifications and your profile
• Make the Twitch logo open your Following page
• Open your Following page instead of the Twitch home page
• On the Following page, hide recommendations, "Continue Watching", "Latest Videos", "Upcoming Streams" and "Live Categories" (when Twitch is in English)
• Hide the Following page's Live, Videos, Categories and Channels tabs, keeping Overview

Good to know:
• The stream can only be swapped in when Twitch shows its small preview. Twitch doesn't show it for every ad, for example usually not for the ads before a stream starts.
• The preview is lower quality than the main stream.
• Twitch changes its site often. If something stops working, please mention it in a review on this page.

Ad Swap collects no data. To skip an ad it only talks to Twitch itself (gql.twitch.tv and usher.ttvnw.net), to load the ad-free copy of the stream you're watching. Settings are stored in your browser and synced through Firefox Sync if you use it.

This extension is not affiliated with or endorsed by Twitch.

## Version notes for 2.3.2
Fixes ad skipping and early ad detection, which never ran: Firefox also needs permission for twitch.tv itself before an add-on can read the video playlists the page loads. When there's no stream preview, the ad should now be skipped or covered before it shows.

New options for the Following page: hide recommended channels and categories, "Continue Watching", "Latest Videos", "Upcoming Streams" and "Live Categories" (when Twitch is in English), and its Live, Videos, Categories and Channels tabs.

## Version notes for 2.3.1
New: skip ads. When an ad comes up, Ad Swap asks Twitch for an ad-free copy of the same stream and plays that instead, so the ad never shows. If Twitch has ads on every copy, the stream preview or break screen takes over as before. On by default; switch off "Skip ads when Twitch allows it" in the menu to let ads play. Needs permission to talk to Twitch's playlist and token servers (gql.twitch.tv, usher.ttvnw.net).

## Version notes for 2.2.7
Fixes 2.2.6's early ad detection, which never kicked in: Twitch serves its stream playlists from a different address than expected. When there's no stream preview, the ad is now covered and muted before it shows, instead of a second later. This adds that address to the permission for reading Twitch's video playlists (only read, never changed or sent anywhere).

## Version notes for 2.2.6
When there's no stream preview, the ad no longer flashes on screen before the break screen. Ad Swap now spots the ad in the stream itself, before Twitch shows it, so it's covered and muted from the very first frame. This needs a new permission to read Twitch's video playlists; they are only read, never changed or sent anywhere.

## Version notes for 2.2.5
Fixes the stream preview's sound and picture drifting apart during ads in fullscreen. The sound now always comes from the preview that's on screen, and every other video stays muted. Ads are also spotted sooner, so when there's no stream preview the ad is muted and covered without first playing for a moment. A stream preview that Twitch keeps hidden, or that isn't visible in fullscreen, no longer counts, so the break screen covers the ad instead of letting it show.

## Version notes for 2.2.4
The break screen now covers the ad as soon as it starts when there's no stream preview, instead of after a short delay. Debug logging now also reports playback details for each video.

## Version notes for 2.2.3
Fixes the stream preview not taking over the screen during ads in fullscreen, which broke in 2.2.2. This undoes the 2.2.2 change.

## Version notes for 2.2.2
Fixes the stream preview swap kicking in when no ad was playing, for example on channels you're subscribed to. Only Twitch's own preview inside the player now counts, so other videos on the page no longer trigger it.

## Version notes for 2.2.1
Fixes the break screen covering the stream during ads: when Twitch showed its small stream preview, the break screen could appear instead and stay on after the ad ended. The preview is used again whenever Twitch shows one, the break screen only appears when there is none, and the stream comes back when the ad ends.

## Version notes for 2.2.0 (published 2026-10-31; everything since 2.0.1)
• New break screen: when an ad plays and Twitch shows no stream preview, a calm break screen with the ad countdown covers the ad. You can switch it off in the menu.
• Smoother end of ads: the stream stays up until the main video is playing again, so there's no black gap, and its sound comes back sooner.
• Faster switching when an ad starts: ads are detected sooner, so the stream takes over more quickly.
• Left sidebar: hide each part on its own (Followed Channels, Live Channels, Viewers Also Watch, the "Show More" buttons, the collapse arrow), or the whole sidebar. Sections are recognised in any language in the expanded sidebar. If you had "Viewers Also Watch" switched on, the new sidebar option is switched on for you.

## Category
Photos, Music & Videos

## Tags
twitch, ads, streaming, picture-in-picture, video

## License
MIT License

## Privacy policy
Not needed: the extension collects no data (declared in the manifest).

## Notes to reviewer
No build step and no minified or generated code: the uploaded files are the source. The extension only runs on twitch.tv and m.twitch.tv. It watches the Twitch player for ad breaks, mutes the ad video, unmutes Twitch's own small live preview and restyles it to cover the player, then restores everything when the ad ends. When there is no preview, it covers the ad with a static "break" overlay built with DOM methods (no innerHTML from page data). The optional tweaks tag page elements with data attributes and hide them with a CSS rule keyed on a class on <html>; they also redirect the home page and logo to /directory/following for logged-in users. A one-time settings migration copies one stored option to a new key in storage.sync. No network requests, no remote code, no data collection, and only the "storage" permission.

Bug-fix release; only content.js changed since 2.2.0. Twitch's ad label now only counts while it is visible (a hidden copy left in the page kept the extension in "ad" mode); the stream preview is picked from videos that are actually playing and re-checked when it stops, instead of locking in the first small video; and the enlarged preview is layered above the break screen.

To test: open any live channel on twitch.tv and wait for an ad break. The sidebar options can be checked on any channel page from the toolbar menu; they apply instantly.

## Screenshots to take (1280×800 works well)
1. During an ad break: the enlarged stream covering the player.
2. The same moment without the extension, showing the small preview in the corner (for comparison).
3. The settings menu (`screenshot-menu.png` in this folder).
4. A channel page with the page tweaks switched on (for example Live Channels and the Browse button hidden).

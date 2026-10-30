# Ad Swap for Twitch: addons.mozilla.org listing

Copy each field into the matching box on the submission form.

## Name
Ad Swap for Twitch

## Summary (max 250 characters)
Keep watching during Twitch ads. When Twitch shows the small live-stream preview during an ad break, Ad Swap mutes the ad, plays the stream's sound and enlarges the stream over the ad.

## Description
When an ad break starts on Twitch, Twitch often keeps the live stream playing in a small, muted box in the corner of the player. Ad Swap for Twitch makes that the main thing you watch:

• Mutes the ad and plays the stream's sound at your usual volume
• Enlarges the stream to cover the whole player, including in fullscreen
• Puts everything back the moment the ad break ends, without a black gap
• No preview this time? Shows a calm break screen with the ad countdown instead of the ad

Ads still play, and channels still get credit for them. Ad Swap doesn't block or skip anything; it just lets you keep following the stream while they run.

Optional page tweaks (all off by default, switch them on in the extension's menu):
• Hide the left sidebar, just its "Live Channels" section, or everything but your Followed Channels
• Hide "Viewers Also Watch" (when Twitch is in English)
• Hide the Browse button
• Hide top-bar icons, keeping notifications and your profile
• Make the Twitch logo open your Following page
• Open your Following page instead of the Twitch home page

Good to know:
• The stream can only be swapped in when Twitch shows its small preview. Twitch doesn't show it for every ad, for example usually not for the ads before a stream starts.
• The preview is lower quality than the main stream.
• Twitch changes its site often. If something stops working, please leave a note in the support section.

Ad Swap collects no data and talks to no servers. Settings are stored in your browser and synced through Firefox Sync if you use it.

This extension is not affiliated with or endorsed by Twitch.

## Version notes for 2.1.0
New: when an ad plays without a stream preview, a break screen covers the ad (can be switched off). New option to keep the sidebar but show only Followed Channels. Smoother hand-back when the ad ends: no black gap, and the stream's sound returns sooner.

## Version notes for 2.2.0
The left sidebar options are now separate: hide the whole sidebar, hide only the "Live Channels" section, or show only "Followed Channels".

## Category
Photos, Music & Videos

## Tags
twitch, ads, streaming, picture-in-picture, video

## License
MIT License

## Privacy policy
Not needed: the extension collects no data (declared in the manifest).

## Notes to reviewer
No build step: the uploaded files are the source. The extension only runs on twitch.tv. It watches the Twitch player for ad breaks, mutes the ad video, unmutes Twitch's own small live preview and restyles it to cover the player, then restores everything when the ad ends. The optional tweaks hide page elements with CSS and redirect the home page and logo to /directory/following for logged-in users. No network requests, no remote code, and only the "storage" permission.

## Screenshots to take (1280×800 works well)
1. During an ad break: the enlarged stream covering the player.
2. The same moment without the extension, showing the small preview in the corner (for comparison).
3. The settings menu (`screenshot-menu.png` in this folder).
4. A channel page with the page tweaks switched on.

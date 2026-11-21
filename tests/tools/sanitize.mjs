// Strips personal and session data from Twitch playlists before they are saved as test fixtures:
// the viewer's IP and country, session and serving IDs, and the signed tokens in every URL.
// Usage: node tests/tools/sanitize.mjs <in.m3u8> <out.m3u8>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const short = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

export function sanitize(text) {
  return text
    // Master playlist header: keep the line, drop every attribute (IP, country, IDs, cluster URLs).
    .replace(/^#EXT-X-TWITCH-INFO:.*$/m, '#EXT-X-TWITCH-INFO:NODE="sanitized"')
    // Signed tokens in playlist, segment and trigger URLs: same input -> same stand-in.
    .replace(/(https?:\/\/[^/\s"]+\/(?:v1\/)?(?:playlist|segment|trigger)\/)([A-Za-z0-9_\-]{20,})/g,
             (_, base, tok) => `${base}${short(tok)}`)
    .replace(/(X-TV-TWITCH-SESSIONID|VIDEO-SESSION-ID|SERVING-ID|BROADCAST-ID)="[^"]*"/g, '$1="0"')
    // Ad tags: signed tokens (RADS-TOKEN is a JWT about the viewer) and per-view IDs.
    .replace(/(X-TV-TWITCH-[A-Z-]*(?:TOKEN|SESSION-ID|BEACON-ID|DEVICE-ID|USER-ID|TRACKING-ID))="[^"]*"/g, '$1="0"')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "jwt-sanitized")
    .replace(/USER-IP="[^"]*"/g, 'USER-IP="0.0.0.0"')
    .replace(/USER-COUNTRY="[^"]*"/g, 'USER-COUNTRY="XX"')
    .replace(/(sig|token)=[^&\s"]+/g, "$1=sanitized")
    // Query strings on URLs (e.g. ?dna=...) carry per-viewer data too.
    .replace(/(https?:\/\/[^\s"?]+)\?[^\s"]*/g, "$1");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  writeFileSync(output, sanitize(readFileSync(input, "utf8")));
}

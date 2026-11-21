// Starts Zen (or another Firefox build) headless and muted, with a test copy of the extension.
// ZEN_BINARY overrides the browser path. Nothing is shown on screen and no sound plays.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const ZEN = process.env.ZEN_BINARY || "/Applications/Zen.app/Contents/MacOS/zen";
const EXTENSION_FILES = ["manifest.json", "background.js", "defaults.js", "content.js", "cleanup.js",
                         "popup.html", "popup.js", "icon.svg", "icons"];

// Selenium's own lookup misreads Zen's version (1.x) as "Firefox 1", so fetch geckodriver directly.
let geckodriver;
function geckodriverPath() {
  if (geckodriver) return geckodriver;
  const platform = { darwin: "macos", linux: "linux", win32: "windows" }[process.platform];
  const manager = join(root, "node_modules/selenium-webdriver/bin", platform, "selenium-manager");
  const out = JSON.parse(execFileSync(manager, ["--driver", "geckodriver", "--skip-browser-in-path", "--output", "json"]));
  geckodriver = out.result.driver_path;
  return geckodriver;
}

// A copy of the extension with Debug logging on (so it publishes <html data-tas-state>) and,
// for the mock page, its page scripts also running on 127.0.0.1.
export function buildTestExtension({ settings = {}, localhost = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tas-ext-"));
  for (const f of EXTENSION_FILES) cpSync(join(root, f), join(dir, f), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (localhost) manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const defaults = readFileSync(join(dir, "defaults.js"), "utf8");
  const overrides = { debug: true, ...settings };
  writeFileSync(join(dir, "defaults.js"),
    defaults + `\nObject.assign(globalThis.TAS_DEFAULTS, ${JSON.stringify(overrides)});\n`);
  return dir;
}

export async function startZen({ extension } = {}) {
  const options = new firefox.Options()
    .setBinary(ZEN)
    .addArguments("-headless", "-no-remote", "-new-instance")
    .setPreference("zen.welcome-screen.seen", true)
    .setPreference("media.autoplay.default", 0)       // allow autoplay with sound, like a real visit
    .setPreference("media.autoplay.blocking_policy", 0)
    .setPreference("media.volume_scale", "0.0")        // ...but never make a sound on this Mac
    .setPreference("browser.shell.checkDefaultBrowser", false);
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(geckodriverPath()))
    .build();
  await driver.manage().window().setRect({ width: 1400, height: 900 });
  if (extension) await driver.installAddon(extension, true);
  return driver;
}

// The extension's published state, or null before it has written any.
export async function state(driver) {
  const raw = await driver.executeScript("return document.documentElement.getAttribute('data-tas-state')");
  return raw ? JSON.parse(raw) : null;
}

// Polls fn until it returns something truthy, or fails with the last value seen.
export async function waitFor(fn, { timeout = 10000, every = 150, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
}

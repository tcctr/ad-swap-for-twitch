// The page tweaks on real twitch.tv, logged out, in headless, muted Zen. Options are switched
// through the test build's hook; each test starts from everything off.
// Not covered (need a login): Followed Channels, the Following page options and redirects.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildTestExtension, startZen, waitFor } from "../e2e/zen.mjs";
import { topChannels, passContentGate } from "./twitch.mjs";

const ALL_OFF = {
  hideSidebar: false, hideFollowedChannels: false, hideLiveChannels: false, hideSidebarAlsoWatch: false,
  hideShowMore: false, hideSidebarArrow: false, hideAlsoWatch: false, hideBrowse: false,
  hideTopIcons: false, logoToFollowing: false, startOnFollowing: false,
};
let driver, channel;

before(async () => {
  [channel] = await topChannels(1);
  driver = await startZen({ extension: buildTestExtension() });
});
after(async () => { if (driver) await driver.quit(); });

async function open(path, width = 1920) {
  await driver.manage().window().setRect({ width, height: 1080 });
  await driver.get(`https://www.twitch.tv/${path}`);
  await waitFor(() => driver.executeScript("return !!document.querySelector('[data-a-target^=\"side-nav-bar\"]')"),
                { timeout: 30000, what: "sidebar" });
  await passContentGate(driver);
}
const set = (s) => driver.executeScript(
  `document.dispatchEvent(new CustomEvent("tas-test-settings", { detail: ${JSON.stringify(JSON.stringify(s))} }))`);
// Is the first element matching the selector (optionally: whose aria-label contains `label`) shown?
const shown = (selector, label = "") => driver.executeScript(`
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((e) => !${JSON.stringify(label)} || (e.getAttribute("aria-label") || "").includes(${JSON.stringify(label)}));
  return el ? el.getClientRects().length > 0 : null;`);
const until = (fn, what) => waitFor(fn, { timeout: 5000, what });

const SIDEBAR = '[data-a-target="side-nav-bar"]';
const SECTION = `${SIDEBAR} .side-nav-section, ${SIDEBAR} [role="group"]`;
const COLLAPSED_SECTION = '[data-a-target="side-nav-bar-collapsed"] .side-nav-section, [data-a-target="side-nav-bar-collapsed"] [role="group"]';

beforeEach(async () => { await open(channel); await set(ALL_OFF); });

test("expanded sidebar has the parts the options look for", async (t) => {
  t.diagnostic(`channel: ${channel}`);
  assert.equal(await shown(SIDEBAR), true);
  await until(async () => (await shown(SECTION, "Live Channels")) === true, "Live Channels section");
  await until(async () => (await shown(SECTION, "Viewers Also Watch")) === true, "Viewers Also Watch section");
  assert.equal(await shown('[data-a-target="side-nav-arrow"]'), true);
  assert.equal(await shown('a[data-a-target="browse-link"]'), true);
});

test("Hide the whole sidebar, and back", async () => {
  await set({ hideSidebar: true });
  await until(async () => (await shown(SIDEBAR)) === false, "sidebar hidden");
  await set({ hideSidebar: false });
  await until(async () => (await shown(SIDEBAR)) === true, "sidebar back");
});

test("Hide Live Channels keeps Viewers Also Watch", async () => {
  await set({ hideLiveChannels: true });
  await until(async () => (await shown(SECTION, "Live Channels")) === false, "Live Channels hidden");
  assert.equal(await shown(SECTION, "Viewers Also Watch"), true);
});

test("Hide Viewers Also Watch keeps Live Channels", async () => {
  await set({ hideSidebarAlsoWatch: true });
  await until(async () => (await shown(SECTION, "Viewers Also Watch")) === false, "Viewers Also Watch hidden");
  assert.equal(await shown(SECTION, "Live Channels"), true);
});

test("Hide Show More buttons and the collapse arrow", async () => {
  const showMore = `${SIDEBAR} [data-a-target^="side-nav-show-"]`;
  const had = await shown(showMore);
  await set({ hideShowMore: true, hideSidebarArrow: true });
  if (had) await until(async () => (await shown(showMore)) === false, "Show More hidden");
  await until(async () => (await shown('[data-a-target="side-nav-arrow"]')) === false, "arrow hidden");
  assert.equal(await shown(SECTION, "Live Channels"), true, "sections stay");
});

test("narrow window: Top-bar icons keeps the search button", async () => {
  await open(channel, 900);
  await set({ hideTopIcons: true });
  await until(() => driver.executeScript("return !!document.querySelector('[data-tas-top-icon]')"), "an icon hidden");
  const searches = await driver.executeScript(`return [...document.querySelectorAll(
    'nav[data-a-target="top-nav-container"] [aria-label*="search" i]')].map((e) => !!e.closest("[data-tas-top-icon]"))`);
  assert.ok(searches.length > 0, "search controls found");
  assert.deepEqual(searches, searches.map(() => false), "no search control hidden by the extension");
});

test("collapsed sidebar: Live Channels and Viewers Also Watch hidden by their options", async () => {
  await open(channel, 1000);
  await set(ALL_OFF);
  assert.equal(await shown(COLLAPSED_SECTION, "Live Channels"), true, "collapsed sidebar has Live Channels");
  await set({ hideLiveChannels: true });
  await until(async () => (await shown(COLLAPSED_SECTION, "Live Channels")) === false, "collapsed Live Channels hidden");
  assert.equal(await shown(COLLAPSED_SECTION, "Viewers Also Watch"), true);
  await set({ hideLiveChannels: false, hideSidebarAlsoWatch: true });
  await until(async () => (await shown(COLLAPSED_SECTION, "Viewers Also Watch")) === false, "collapsed Viewers Also Watch hidden");
  await until(async () => (await shown(COLLAPSED_SECTION, "Live Channels")) === true, "collapsed Live Channels back");
});

test("Browse button", async () => {
  await set({ hideBrowse: true });
  await until(async () => (await shown('a[data-a-target="browse-link"]')) === false, "Browse hidden");
});

test("Top-bar icons: hides the icon buttons, keeps logo, search, Browse, login and the user menu", async (t) => {
  await set({ hideTopIcons: true });
  const NAV = 'nav[data-a-target="top-nav-container"]';
  await until(() => driver.executeScript(`return !!document.querySelector('${NAV} [data-tas-top-icon]')`), "an icon hidden");
  const hidden = await driver.executeScript(`return [...document.querySelectorAll('${NAV} [data-tas-top-icon]')]
    .flatMap((w) => [...w.querySelectorAll("button, a")].concat(w.matches("button, a") ? [w] : []))
    .map((e) => e.getAttribute("aria-label") || e.getAttribute("data-a-target") || e.textContent.trim())`);
  t.diagnostic(`hidden: ${JSON.stringify(hidden)}`);
  for (const [sel, what] of [['a[data-a-target="home-link"], a[aria-label="Twitch Home"]', "logo"],
                             ['[data-a-target="login-button"]', "log in"], ['[data-a-target="signup-button"]', "sign up"],
                             [`${NAV} input`, "search box"], [`${NAV} [aria-label*="User Menu" i]`, "user menu"],
                             [`${NAV} button[aria-label*="search" i]`, "search button"], ['a[data-a-target="browse-link"]', "Browse"]]) {
    assert.equal(await shown(sel), true, `${what} stays`);
  }
});

test("logged out, the Following redirects do nothing", async () => {
  await set({ logoToFollowing: true, startOnFollowing: true });
  await open("");
  await set({ logoToFollowing: true, startOnFollowing: true });
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(await driver.executeScript("return location.pathname"), "/");
  assert.equal(await driver.executeScript(
    "return document.querySelector('a[data-a-target=\"home-link\"], a[aria-label=\"Twitch Home\"]').getAttribute('href')"), "/");
});

test("everything off: nothing on the page is tagged hidden", async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const classes = await driver.executeScript("return [...document.documentElement.classList].filter((c) => c.startsWith('tas-'))");
  assert.deepEqual(classes, []);
});

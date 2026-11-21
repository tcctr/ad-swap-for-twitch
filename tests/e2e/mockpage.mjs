// Shared setup for tests on the mock Twitch page: a local server, one Zen for the file, and a
// fresh page before each test.
import { before, after, beforeEach } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { buildTestExtension, startZen, state, waitFor } from "./zen.mjs";

export function useMockPage({ settings } = {}) {
  const page = readFileSync(new URL("./mock/twitch.html", import.meta.url));
  const ctx = {};
  let server;

  before(async () => {
    server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    ctx.base = `http://127.0.0.1:${server.address().port}`;
    ctx.driver = await startZen({ extension: buildTestExtension({ localhost: true, settings }) });
  });
  after(async () => {
    if (ctx.driver) await ctx.driver.quit();
    if (server) server.close();
  });
  beforeEach(async () => {
    await ctx.driver.get(`${ctx.base}/k4sen`);
    await waitFor(() => state(ctx.driver), { what: "extension state on the page" });
    await waitFor(async () => (await state(ctx.driver)).playerRect, { what: "main video found" });
  });

  ctx.state = () => state(ctx.driver);
  ctx.mock = (call) => ctx.driver.executeScript(`return window.mock.${call}`);
  // Waits until the published state passes the check; returns that state.
  ctx.until = (check, what, timeout = 10000) =>
    waitFor(async () => { const s = await state(ctx.driver); return s && check(s) && s; }, { what, timeout });
  ctx.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return ctx;
}

export const near = (a, b, px = 2) => ["left", "top", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= px);

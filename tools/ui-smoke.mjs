// Whiteaxe browser smoke test. No hardware or external web services.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";

const require = createRequire(join(process.env.UI_TEST_MODULES || process.cwd(), "package.json"));
const { chromium } = require("playwright-core");
const root = resolve("dist/ui");
const output = resolve("ui-test-results");
await mkdir(output, { recursive: true });

const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
let page;
const errors = [];
const checks = [];
const artwork = ".preview > svg:first-child > g > path";
const snapshot = () => page.locator(artwork).evaluateAll((paths) =>
  paths.map((p) => ({ d: p.getAttribute("d"), stroke: getComputedStyle(p).stroke })),
);
const waitForPaths = (count) => page.waitForFunction(
  ({ selector, count }) => document.querySelectorAll(selector).length === count,
  { selector: artwork, count },
);
const idle = () => page.locator(".preview-loader").waitFor({ state: "hidden" });
const pass = (name) => { checks.push(name); console.log("PASS " + name); };

try {
  // Ubuntu GitHub-hosted runners already contain Google Chrome.
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  // Keep the test offline and ensure no USB connection can be made.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith(origin + "/") ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "serial", {
      value: {
        getPorts: async () => [],
        requestPort: async () => { throw new Error("Hardware access forbidden during UI tests"); },
      },
      configurable: true,
    });
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Upload SVG" }).waitFor();
  pass("application boots in WebSerial mode without hardware");
  await page.locator('input[type="file"]').setInputFiles("docs/whiteaxe-fixtures/colors-groups.svg");
  await waitForPaths(5);
  await idle();
  await page.locator(".drag-target").waitFor({ state: "hidden" });
  const original = await snapshot();
  const palette = [...new Set(original.map((p) => p.stroke))].sort();
  assert.deepEqual(palette, ["rgb(196, 62, 50)", "rgb(213, 163, 59)", "rgb(255, 255, 255)", "rgb(49, 84, 163)"].sort());
  pass("real SVG upload and four original stroke colors");
  const warm = page.locator(".layer-row").filter({ has: page.locator(".layer-name", { hasText: /^warm$/ }) });
  const cool = page.locator(".layer-row").filter({ has: page.locator(".layer-name", { hasText: /^cool$/ }) });
  assert.equal(await warm.locator(".layer-swatch").count(), 2);
  assert.equal(await cool.locator(".layer-swatch").count(), 2);
  const coolColors = await cool.locator(".layer-swatch").evaluateAll((nodes) => nodes.map(n => getComputedStyle(n).backgroundColor));
  assert.ok(coolColors.includes("rgb(255, 255, 255)"), "white swatch missing");
  pass("mixed group swatches and white ink indicator");
  await page.screenshot({ path: join(output, "01-artwork.png"), fullPage: true });
  await warm.getByRole("checkbox").uncheck();
  await waitForPaths(3);
  await idle();
  const remaining = await snapshot();
  assert.deepEqual(remaining, original.filter((p, i) => i >= 2), "hiding warm group changed remaining geometry");
  pass("group toggle preserves all remaining coordinates");
  await page.screenshot({ path: join(output, "02-group-hidden.png"), fullPage: true });
  await page.getByRole("button", { name: "None", exact: true }).click();
  await waitForPaths(0);
  await idle();
  assert.equal(await page.locator(".layer-row input:checked").count(), 0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await waitForPaths(5);
  await idle();
  assert.deepEqual(await snapshot(), original);
  pass("All and None restore the exact original placement");
  const mode = page.locator(".preview-mode-toggle select");
  await mode.selectOption("plot");
  await page.locator(".preview > svg:first-child > g[transform] > path").first().waitFor({ state: "attached" });
  await idle();
  await page.screenshot({ path: join(output, "03-plot.png"), fullPage: true });
  await mode.selectOption("artwork");
  await waitForPaths(5);
  assert.deepEqual(await snapshot(), original);
  pass("switch to the original motion preview and back");
  await page.locator("details > summary").click();
  await page.getByLabel("layer by group").uncheck();
  await idle();
  assert.equal(await page.locator(".layer-row").count(), 4);
  // Use computed style, not the source spelling of the SVG stroke.
  const whiteIndex = await page.locator(".layer-row").evaluateAll(rows =>
    rows.findIndex(row => [...row.querySelectorAll(".layer-swatch")].some(n => getComputedStyle(n).backgroundColor === "rgb(255, 255, 255)")),
  );
  assert.ok(whiteIndex >= 0);
  await page.locator(".layer-row").nth(whiteIndex).getByRole("checkbox").uncheck();
  await waitForPaths(4);
  await idle();
  assert.deepEqual(await snapshot(), original.filter(p => p.stroke !== "rgb(255, 255, 255)"));
  pass("stroke-based layer selection preserves remaining geometry");
  await page.screenshot({ path: join(output, "04-stroke-layers.png"), fullPage: true });
  assert.deepEqual(errors, [], "uncaught browser errors");
  pass("no uncaught browser errors");
} catch (error) {
  if (page) await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  console.log(JSON.stringify({ checks, errors }));
  await browser?.close();
  await new Promise((done) => server.close(done));
}

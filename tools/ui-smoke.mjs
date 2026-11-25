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
  await page.locator(".advanced-settings > summary").click();
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
  await page.getByRole("button", { name: "All", exact: true }).click();
  await waitForPaths(5);
  await idle();
  const placement = page.locator(".placement-controls select");
  await placement.selectOption("manual");
  await page.getByRole("alert").filter({ hasText: "Confirm machine travel" }).waitFor();
  const fitted = await snapshot();
  const points = (drawing) => drawing.flatMap(p => p.d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi).map(Number));
  const near = (a, b, tolerance = 0.002) => assert.ok(Math.abs(a - b) <= tolerance, a + " != " + b);
  points(fitted).forEach((value, i) => near(value, points(original)[i]));
  pass("entering Manual preserves Fit placement and blocks unconfirmed travel");

  const x = page.getByLabel("X (mm)", { exact: true });
  const y = page.getByLabel("Y (mm)", { exact: true });
  const scale = page.getByLabel("Scale (%)", { exact: true });
  await scale.fill("100");
  await x.fill("30");
  await y.fill("40");
  await page.getByLabel("Machine travel X (mm)", { exact: true }).fill("320");
  await page.getByLabel("Machine travel Y (mm)", { exact: true }).fill("250");
  await idle();
  await page.locator(".placement-error").waitFor({ state: "hidden" });
  const manual = await snapshot();
  const xy = points(manual);
  near(Math.min(...xy.filter((_, i) => i % 2 === 0)), 30);
  near(Math.min(...xy.filter((_, i) => i % 2 === 1)), 40);
  // Physical SVG import includes browser CTM and flattening precision. Allow 0.01 mm
  // only for this parser-to-physical-size assertion; placement invariants remain strict.
  near(Math.max(...xy.filter((_, i) => i % 2 === 0)) - 30, 70, 0.01);
  pass("manual X/Y and actual SVG physical scale");
  await page.getByRole("button", { name: "Center both", exact: true }).click();
  await idle();
  const centered = await snapshot();
  const bounds = points(centered);
  const xs = bounds.filter((_, i) => i % 2 === 0);
  const ys = bounds.filter((_, i) => i % 2 === 1);
  const sheet = page.locator(".manual-paper");
  const dimensions = (await sheet.getAttribute("viewBox")).split(" ").map(Number);
  near((Math.min(...xs) + Math.max(...xs)) / 2, dimensions[2] / 2);
  near((Math.min(...ys) + Math.max(...ys)) / 2, dimensions[3] / 2);
  pass("center both axes using full artwork bounds");

  const rect = await sheet.boundingBox();
  const beforeX = Number(await x.inputValue());
  const beforeY = Number(await y.inputValue());
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 10 * rect.width / dimensions[2], rect.y + rect.height / 2 + 5 * rect.height / dimensions[3], { steps: 5 });
  near(Number(await x.inputValue()), beforeX);
  await page.mouse.up();
  await idle();
  near(Number(await x.inputValue()), beforeX + 10, 0.5);
  near(Number(await y.inputValue()), beforeY + 5, 0.5);
  pass("pointer drag commits physical millimetres only on release");
  await page.screenshot({ path: join(output, "05-manual-placement.png"), fullPage: true });

  await x.fill("-10");
  await page.getByRole("alert").filter({ hasText: "outside the paper" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Plot", exact: true }).isDisabled(), true);
  pass("off-paper placement is rejected without silent clipping");
  await page.screenshot({ path: join(output, "06-out-of-bounds.png"), fullPage: true });
  await placement.selectOption("original");
  await idle();
  assert.equal(await page.locator(".manual-paper").count(), 0);
  await placement.selectOption("fit");
  await waitForPaths(5);
  await idle();
  assert.deepEqual(await snapshot(), original);
  pass("Original and Fit remain available and Fit restores exact coordinates");
  assert.equal(await page.title(), "Whiteaxe Studio");
  assert.equal(await page.locator(".file-name").innerText(), "colors-groups.svg");
  const canvasBox = await page.locator(".canvas-workspace").boundingBox();
  const inspectorBox = await page.locator(".control-panel").boundingBox();
  assert.ok(canvasBox.x < inspectorBox.x, "inspector should be on the right");
  pass("Studio layout and loaded document name");
  const unchanged = await snapshot();
  const viewBefore = await page.locator(".preview > svg").first().boundingBox();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const viewAfter = await page.locator(".preview > svg").first().boundingBox();
  assert.ok(viewAfter.width > viewBefore.width);
  assert.deepEqual(await snapshot(), unchanged);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Pan", exact: true }).getAttribute("aria-pressed"), "true");
  const area = await page.locator(".preview-area").boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 - 70, area.y + area.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  assert.ok(await page.locator(".preview-area").evaluate(el => el.scrollLeft > 0 || el.scrollTop > 0));
  assert.deepEqual(await snapshot(), unchanged);
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  pass("zoom and pan change only the viewport");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  assert.equal(await page.locator(".studio").getAttribute("data-theme"), "dark");
  assert.equal(await page.locator(".preview").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
  assert.deepEqual(await snapshot(), unchanged);
  await page.screenshot({ path: join(output, "07-studio-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  assert.equal(await page.locator(".studio").getAttribute("data-theme"), "light");
  await page.screenshot({ path: join(output, "08-studio-light.png"), fullPage: true });
  pass("light and dark themes preserve white paper and artwork geometry");
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

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function assertPointerTracking(before, after, from, to, rect) {
  const { PerspectiveCamera, Vector3 } = await import("three");
  const camera = (view) => {
    const result = new PerspectiveCamera(view.fov, rect.width / rect.height, 0.03, 100);
    result.position.set(view.x, view.y, view.z);
    result.lookAt(view.x + Math.sin(view.yaw) * Math.cos(view.pitch),
      view.y + Math.sin(view.pitch), view.z + Math.cos(view.yaw) * Math.cos(view.pitch));
    result.updateMatrixWorld();
    return result;
  };
  const point = new Vector3((from.x - rect.x) / rect.width * 2 - 1,
    1 - (from.y - rect.y) / rect.height * 2, 0.5).unproject(camera(before));
  point.project(camera(after));
  assert.ok(Math.abs(rect.x + (point.x + 1) * rect.width / 2 - to.x) < 1, "the grabbed point follows the finger horizontally");
  assert.ok(Math.abs(rect.y + (1 - point.y) * rect.height / 2 - to.y) < 1, "the grabbed point follows the finger vertically");
}

test("player view: real touch, gestures, history, orientation, offline and file access", { timeout: 120000 }, async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    try {
      const file = path.join(__dirname, name === "/" ? "index.html" : name);
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" })[path.extname(file)] || "application/octet-stream");
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    const positions = () => page.locator(".piece").evaluateAll((nodes) => nodes.map((n) => [n.dataset.id, n.style.left, n.style.top]));
    const initial = await positions();
    const cam = () => page.evaluate(() => PlayerView.getCameraState());
    const center = async (id) => { const r = await page.locator(`[data-id="${id}"]`).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const cdp = await context.newCDPSession(page);
    const touch = async (type, touchPoints) => {
      await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
      await page.waitForTimeout(35);
    };
    const tap = async (id) => { const p = { id: 1, ...await center(id) }; await touch("touchStart", [p]); await touch("touchEnd", []); };
    await tap("home-1");
    assert.deepEqual(await positions(), initial, "one tap does not snap players");
    await tap("home-1");
    assert.equal(await page.locator("#player-view-dialog").isVisible(), true);
    assert.match(await page.locator("#player-view-title").textContent(), /味方 1番/);
    assert.equal(await page.locator("#player-view-error").isVisible(), false);
    const origin = await cam(); assert.equal(origin.y, 0.9);
    const dragRect = await page.locator("#player-view-canvas").boundingBox();
    let one = { id: 1, x: 125, y: 350 };
    await touch("touchStart", [one]);
    one = { ...one, x: 165, y: 365 };
    await touch("touchMove", [one]); await touch("touchEnd", []);
    const looked = await cam();
    await assertPointerTracking(origin, looked, { x: 125, y: 350 }, one, dragRect);
    assert.ok(looked.yaw > origin.yaw, "rightward dragging uses the corrected horizontal direction"); assert.notEqual(looked.pitch, origin.pitch);
    assert.equal(looked.x, origin.x); assert.equal(looked.z, origin.z);
    one = { id: 1, x: 110, y: 350 }; let two = { id: 2, x: 240, y: 350 };
    await touch("touchStart", [one]);
    await touch("touchStart", [one, two]);
    assert.deepEqual(await cam(), looked, "adding a finger does not jump");
    one = { ...one, x: 130, y: 380 }; two = { ...two, x: 260, y: 380 };
    await touch("touchMove", [one, two]);
    const moved = await cam();
    assert.notEqual(moved.x, looked.x); assert.notEqual(moved.z, looked.z);
    const movedX = moved.x - looked.x, movedZ = moved.z - looked.z;
    assert.ok(movedX * Math.cos(looked.yaw) - movedZ * Math.sin(looked.yaw) > 0,
      "two-finger horizontal movement uses the corrected direction");
    assert.ok(movedX * Math.sin(looked.yaw) + movedZ * Math.cos(looked.yaw) > 0,
      "two-finger vertical movement uses the corrected direction");
    assert.ok(Math.abs(moved.fov - looked.fov) < 1e-10, "moving both fingers together preserves zoom");
    assert.equal(moved.yaw, looked.yaw); assert.equal(moved.y, 0.9);
    one = { ...one, x: 100 }; two = { ...two, x: 290 };
    await touch("touchMove", [one, two]);
    const zoomed = await cam(); assert.ok(zoomed.fov < moved.fov);
    await touch("touchEnd", [two]);
    assert.deepEqual(await cam(), zoomed, "removing a finger does not jump");
    await touch("touchMove", [{ ...one, x: one.x + 20 }]);
    assert.notEqual((await cam()).yaw, zoomed.yaw);
    await touch("touchCancel", []);
    await page.locator("#reset-player-view").click(); assert.deepEqual(await cam(), origin);
    await page.locator("#player-view-canvas").focus();
    await page.keyboard.press("ArrowRight"); assert.notEqual((await cam()).yaw, origin.yaw);
    await page.locator("#reset-player-view").click();
    fs.mkdirSync(path.join(__dirname, ".test-artifacts"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, ".test-artifacts/player-view-mobile.png") });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#player-view-dialog").isVisible(), false);
    assert.deepEqual(await positions(), initial, "viewing never moves pieces");
    assert.equal(await page.locator("#undo").isDisabled(), true);
    await page.waitForFunction(() => document.activeElement?.dataset.id === "home-1");
    await tap("home-1"); await tap("away-2");
    assert.equal(await page.locator("#player-view-dialog").isVisible(), false, "different players are not a double tap");
    await page.locator('[data-id="ball"]').dblclick();
    assert.equal(await page.locator("#player-view-dialog").isVisible(), false, "the ball does not open player view");
    await page.locator('[data-id="away-2"]').dblclick();
    assert.match(await page.locator("#player-view-title").textContent(), /相手 2番/);
    assert.ok(Math.cos((await cam()).yaw) > 0);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: path.join(__dirname, ".test-artifacts/player-view-landscape.png") });
    assert.equal(await page.locator("#close-player-view").isVisible(), true);
    await page.locator("#close-player-view").click();
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.reload();
    const horizontal = await positions();
    await page.locator('[data-id="home-4"]').dblclick();
    await page.screenshot({ path: path.join(__dirname, ".test-artifacts/player-view-desktop.png") });
    await page.locator("#player-view-canvas").hover();
    const beforeWheel = await cam(); await page.mouse.wheel(0, -120); await page.waitForTimeout(50);
    assert.ok((await cam()).fov < beforeWheel.fov);
    await page.locator("#close-player-view").click(); assert.deepEqual(await positions(), horizontal);
    const courtBox = await page.locator("#court").boundingBox();
    const oldZoom = await page.locator(".court-wrap").evaluate((el) => el.style.getPropertyValue("--court-zoom"));
    await page.mouse.dblclick(courtBox.x + courtBox.width * 0.02, courtBox.y + courtBox.height * 0.15);
    assert.notEqual(await page.locator(".court-wrap").evaluate((el) => el.style.getPropertyValue("--court-zoom")), oldZoom, "empty-court double tap still changes fit");
    assert.equal(await page.locator("#player-view-dialog").isVisible(), false);
    await page.reload();
    // A drag is still a drag and keeps undo/redo intact.
    const p = await center("home-1");
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y + 45); await page.mouse.up();
    assert.equal(await page.locator("#player-view-dialog").isVisible(), false);
    assert.equal(await page.locator("#undo").isDisabled(), false);
    await page.locator("#undo").click(); assert.deepEqual(await positions(), horizontal);
    // Automatic positions need not be on the manual grid: tapping must preserve them.
    await page.locator("#auto-position").click(); await page.locator('[data-auto="full"]').click();
    const b = await center("ball");
    await page.mouse.move(b.x, b.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y + 45); await page.mouse.up();
    await page.waitForTimeout(700);
    const automatic = await positions();
    assert.notDeepEqual(automatic, horizontal);
    await page.locator('[data-id="away-4"]').dblclick();
    assert.equal(await page.locator("#player-view-error").isVisible(), false);
    await page.locator("#close-player-view").click();
    assert.deepEqual(await positions(), automatic, "entering player view preserves FULL positions");
    await page.locator("#undo").click(); assert.deepEqual(await positions(), horizontal, "camera actions do not add undo entries");
    // Render the floor's aiming overlay and persistent arrows together.
    await page.locator("#aim-button").click(); await page.locator('[data-aim="always"]').click();
    await page.locator("#line-button").click(); await page.locator('[data-line="permanent"]').click();
    const c = await page.locator("#court").boundingBox();
    await page.mouse.move(c.x + c.width * 0.02, c.y + c.height * 0.3);
    await page.mouse.down(); await page.waitForTimeout(550);
    await page.mouse.move(c.x + c.width * 0.45, c.y + c.height * 0.3); await page.mouse.up();
    assert.equal(await page.locator("#arrow-lines line").count(), 1);
    await page.locator('[data-id="home-2"]').dblclick();
    assert.equal(await page.locator("#player-view-error").isVisible(), false);
    await page.screenshot({ path: path.join(__dirname, ".test-artifacts/player-view-overlays.png") });
    await page.locator("#close-player-view").click();
    // Offline load must include the bundled renderer, with no CDN requests.
    await context.setOffline(true); await page.reload();
    await page.locator('[data-id="home-2"]').dblclick();
    assert.equal(await page.locator("#player-view-error").isVisible(), false);
    await page.locator("#close-player-view").click();
    await context.setOffline(false);
    const local = await context.newPage();
    await local.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    await local.locator('[data-id="home-2"]').focus(); await local.keyboard.press("Enter");
    assert.equal(await local.locator("#player-view-dialog").isVisible(), true);
    assert.equal(await local.locator("#player-view-error").isVisible(), false);
    // Graceful fallback for devices without WebGL2.
    const unsupported = await context.newPage();
    await unsupported.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === "webgl2" ? null : original.call(this, type, ...args);
      };
    });
    await unsupported.goto("http://127.0.0.1:" + server.address().port);
    await unsupported.locator('[data-id="home-2"]').dblclick();
    assert.equal(await unsupported.locator("#player-view-error").isVisible(), true);
    await unsupported.locator("#close-player-view").click();
    assert.equal(await unsupported.locator(".piece").count(), 13);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

test("saved formations, responsive toolbar, and offline PWA", async () => {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.join(
      root,
      pathname.endsWith("/") ? pathname + "index.html" : pathname,
    );
    try {
      const content = fs.readFileSync(file);
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
      };
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 1136, height: 905 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    const checkInitialFit = async () => {
      const fits = await page.locator(".court-scroll").evaluate((el) => {
        const court = el.querySelector("#court").getBoundingClientRect();
        const view = el.getBoundingClientRect();
        return (
          court.left >= view.left &&
          court.top >= view.top &&
          court.right <= view.left + el.clientWidth + 1 &&
          court.bottom <= view.top + el.clientHeight + 1
        );
      });
      assert.ok(fits, "initial view shows the whole court");
    };
    assert.equal(
      await page.locator("#landscape").getAttribute("aria-pressed"),
      "true",
    );
    await checkInitialFit();
    await page.setViewportSize({ width: 700, height: 900 });
    await page.reload();
    assert.equal(
      await page.locator("#portrait").getAttribute("aria-pressed"),
      "true",
    );
    await checkInitialFit();
    assert.equal(
      await page.locator(".toolbar-home").getAttribute("href"),
      "./",
    );
    const setOrientation = async (id) => {
      if (!(await page.locator("#tool-panel").isVisible()))
        await page.locator("#toggle-tools").click();
      await page.locator("#" + id).click();
      await page.locator("#toggle-tools").click();
    };
    await page.setViewportSize({ width: 1136, height: 905 });
    await setOrientation("portrait");
    const checkBallSize = async () => {
      const sizes = await page.locator("#court").evaluate((court) => {
        const player = court
          .querySelector(".piece:not(.ball)")
          .getBoundingClientRect();
        const ball = court.querySelector(".piece.ball").getBoundingClientRect();
        return { player: player.width, width: ball.width, height: ball.height };
      });
      assert.ok(
        Math.abs(sizes.width - sizes.player / 2) < 0.1,
        "ball diameter is half the player",
      );
      assert.ok(
        Math.abs(sizes.height - sizes.width) < 0.1,
        "ball stays circular",
      );
    };
    const positions = () =>
      page
        .locator(".piece")
        .evaluateAll((elements) =>
          elements.map((e) => [e.dataset.id, e.style.left, e.style.top]),
        );
    const original = await positions();
    assert.equal(await page.locator("#help-dialog").isVisible(), false);
    await page.locator("#toggle-tools").click();
    await page.locator("#open-help").tap();
    assert.equal(await page.locator("#help-dialog").isVisible(), true);
    await page.setViewportSize({ width: 320, height: 568 });
    const closeBefore = await page.locator("#close-help").boundingBox();
    await page
      .locator(".help-content")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    assert.deepEqual(
      await page.locator("#close-help").boundingBox(),
      closeBefore,
    );
    await page.locator("#help-dialog summary").click();
    assert.equal(
      await page.locator("#help-dialog details").getAttribute("open"),
      "",
    );
    await page.keyboard.press("Control+z");
    assert.deepEqual(await positions(), original, "help does not change board");
    await page.screenshot({
      path: path.join(process.env.TEMP, "rv-help-mobile.png"),
    });
    await page.touchscreen.tap(2, 2);
    assert.equal(await page.locator("#help-dialog").isVisible(), false);
    assert.equal(await page.locator("#tool-panel").isVisible(), true);
    await page.locator("#open-help").click();
    await page.locator("#close-help").click();
    assert.equal(await page.locator("#tool-panel").isVisible(), true);
    assert.equal(
      await page
        .locator("#open-help")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.locator("#open-help").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#help-dialog").isVisible(), false);
    assert.equal(await page.locator("#tool-panel").isVisible(), true);
    await page.locator("#toggle-tools").click();
    await page.setViewportSize({ width: 1136, height: 905 });

    await page.locator("#toggle-tools").click();
    await page.locator('[data-slot="0"]').click();
    assert.match(
      await page.locator("#status").textContent(),
      /保存した配置を開きました/,
    );
    for (let i = 0; i < 5; i++) {
      const slot = page.locator(`[data-slot="${i}"]`);
      await slot.click({ delay: 750 });
      assert.match(await slot.getAttribute("class"), /saved/);
      assert.match(await page.locator("#status").textContent(), /保存しました/);
    }
    await page.locator("#toggle-tools").click();
    await page.locator('[data-id="home-1"]').focus();
    await page.keyboard.press("ArrowLeft");
    assert.notDeepEqual(await positions(), original);
    await page.locator("#toggle-tools").click();
    await page.locator('[data-slot="0"]').click();
    assert.deepEqual(await positions(), original);
    await page.locator("#toggle-tools").click();
    await page.locator("#undo").click();
    assert.notDeepEqual(await positions(), original);
    await page.locator("#toggle-tools").click();
    // Cancelled long presses must neither save nor load.
    const before = await page.evaluate(() =>
      localStorage.getItem("rv-tactic-board-v1-slots"),
    );
    const slot = page.locator('[data-slot="0"]');
    const box = await slot.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
    await page.waitForTimeout(750);
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("rv-tactic-board-v1-slots"),
      ),
      before,
    );
    await slot.focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(750);
    await page.keyboard.up("Space");
    assert.notEqual(
      await page.evaluate(() =>
        localStorage.getItem("rv-tactic-board-v1-slots"),
      ),
      before,
    );
    await page.screenshot({
      path: path.join(process.env.TEMP, "rv-toolbar-desktop.png"),
    });
    await page.locator("#toggle-tools").click();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      for (const orientation of ["portrait", "landscape"]) {
        await setOrientation(orientation);
        const toolbarButtons = await page
          .locator(".board-heading button")
          .evaluateAll((buttons) =>
            buttons.map((b) => {
              const r = b.getBoundingClientRect();
              return r.y + r.height / 2;
            }),
          );
        assert.ok(
          Math.max(...toolbarButtons) - Math.min(...toolbarButtons) < 1,
          "toolbar stays on one row",
        );
        const headingBefore = await page
          .locator(".board-heading")
          .boundingBox();
        const scrollInfo = await page
          .locator(".court-scroll")
          .evaluate((el) => {
            el.scrollTop = el.scrollHeight;
            el.scrollLeft = el.scrollWidth;
            return {
              top: el.scrollTop,
              left: el.scrollLeft,
              width: el.clientWidth,
              height: el.clientHeight,
            };
          });
        assert.deepEqual(
          await page.locator(".board-heading").boundingBox(),
          headingBefore,
          "toolbar stays fixed",
        );
        const courtSize = await page.locator("#court").boundingBox();
        if (orientation === "portrait")
          assert.ok(Math.abs(courtSize.width - (scrollInfo.width - 40)) < 1);
        else
          assert.ok(Math.abs(courtSize.height - (scrollInfo.height - 40)) < 1);
        if (orientation === "portrait" && courtSize.height > scrollInfo.height)
          assert.ok(scrollInfo.top > 0);
        if (orientation === "landscape" && courtSize.width > scrollInfo.width)
          assert.ok(scrollInfo.left > 0);
        await page.locator(".court-scroll").evaluate((el) => {
          el.scrollTop = 0;
          el.scrollLeft = 0;
        });
        const sizing = await page.locator("#court").evaluate((court) => {
          const rect = court.getBoundingClientRect();
          const expected =
            ((document
              .querySelector(".workspace")
              .classList.contains("landscape")
              ? rect.height
              : rect.width) *
              0.86) /
            9;
          return [...court.querySelectorAll(".piece:not(.ball)")].map(
            (piece) => {
              const circle = piece.getBoundingClientRect();
              return {
                expected,
                width: circle.width,
                height: circle.height,
                font: parseFloat(getComputedStyle(piece).fontSize),
              };
            },
          );
        });
        await checkBallSize();
        sizing.forEach((size) => {
          assert.ok(
            Math.abs(size.width - size.expected) < 0.1,
            "player diameter is 1 m",
          );
          assert.ok(
            Math.abs(size.height - size.width) < 0.1,
            "player remains circular",
          );
          assert.ok(
            Math.abs(size.font - size.expected * 0.4) < 0.1,
            "number scales with circle",
          );
        });
        for (const id of ["toggle-tools", "clear", "reset", "undo", "redo"]) {
          const rect = await page.locator("#" + id).boundingBox();
          assert.ok(
            rect.x >= 0 &&
              rect.y >= 0 &&
              rect.x + rect.width <= viewport.width + 1 &&
              rect.y + rect.height <= viewport.height + 1,
            id + " fits " + JSON.stringify(viewport),
          );
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await setOrientation("portrait");
    await page.locator("#toggle-tools").click();
    await page.screenshot({
      path: path.join(process.env.TEMP, "rv-toolbar-mobile.png"),
    });
    // Reset saved slots without changing the current board, then check mirrored defaults.
    const boardBeforeReset = await positions();
    await page.locator("#reset-slots").click();
    assert.deepEqual(await positions(), boardBeforeReset);
    const defaults = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rv-tactic-board-v1-slots")),
    );
    for (const formation of defaults) {
      formation.pieces
        .filter((p) => p.team === "home")
        .forEach((home) => {
          const away = formation.pieces.find(
            (p) => p.team === "opponent" && p.number === home.number,
          );
          assert.ok(Math.abs(away.x - (100 - home.x)) < 1e-8);
          assert.ok(Math.abs(away.y - (100 - home.y)) < 1e-8);
        });
    }
    for (const formation of defaults.slice(1)) {
      const home = formation.pieces.filter((p) => p.team === "home");
      assert.equal(
        new Set(home.filter((p) => p.number <= 3).map((p) => p.y)).size,
        1,
      );
      assert.equal(
        new Set(home.filter((p) => p.number >= 4).map((p) => p.y)).size,
        1,
      );
    }
    for (const [left, right] of [
      [1, 2],
      [3, 4],
    ]) {
      defaults[left].pieces.forEach((p, i) => {
        const other = defaults[right].pieces[i];
        assert.equal(other.y, p.y);
        assert.ok(Math.abs(other.x - (100 - p.x)) < 1e-8);
      });
    }
    await page.locator('[data-slot="1"]').click();
    assert.notDeepEqual(await positions(), original);
    await page.locator("#reset").click();
    // Actual multi-touch input through the browser's touch dispatcher.
    const cdp = await context.newCDPSession(page);
    const center = async (id, touchId) => {
      const r = await page.locator('[data-id="' + id + '"]').boundingBox();
      return { id: touchId, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const touch = (type, touchPoints) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const baseline = await positions();
    let one = await center("home-1", 1),
      two = await center("ball", 2);
    await touch("touchStart", [one]);
    await touch("touchStart", [one, two]);
    one = { ...one, x: one.x - 22 };
    two = { ...two, x: two.x + 20 };
    await touch("touchMove", [one, two]);
    const bothMoved = await positions();
    assert.notDeepEqual(
      bothMoved.find((p) => p[0] === "home-1"),
      baseline.find((p) => p[0] === "home-1"),
    );
    assert.notDeepEqual(
      bothMoved.find((p) => p[0] === "ball"),
      baseline.find((p) => p[0] === "ball"),
    );
    await touch("touchEnd", [one]);
    two = { ...two, x: two.x + 16 };
    await touch("touchMove", [two]);
    await page.waitForFunction(
      (previous) =>
        document.querySelector('[data-id="ball"]').style.left !== previous,
      bothMoved.find((p) => p[0] === "ball")[1],
    );
    assert.notDeepEqual(
      (await positions()).find((p) => p[0] === "ball"),
      bothMoved.find((p) => p[0] === "ball"),
    );
    await touch("touchEnd", []);
    await page.locator("#undo").click();
    assert.deepEqual(await positions(), baseline);
    // Opponent and home courts can be manipulated at the same time in both orientations.
    for (const orientation of ["portrait", "landscape"]) {
      await page.setViewportSize(
        orientation === "portrait"
          ? { width: 390, height: 844 }
          : { width: 844, height: 390 },
      );
      await setOrientation(orientation);
      const beforeTeams = await positions();
      one = await center("home-2", 1);
      two = await center("away-2", 2);
      await touch("touchStart", [one, two]);
      const delta =
        orientation === "portrait" ? { x: 18, y: 0 } : { x: 0, y: 18 };
      await touch("touchMove", [
        { ...one, x: one.x + delta.x, y: one.y + delta.y },
        { ...two, x: two.x - delta.x, y: two.y - delta.y },
      ]);
      await page.waitForFunction(
        (previous) =>
          ["home-2", "away-2"].every((id) => {
            const el = document.querySelector('[data-id="' + id + '"]');
            const old = previous.find((p) => p[0] === id);
            return el.style.left !== old[1] || el.style.top !== old[2];
          }),
        beforeTeams,
      );
      await touch("touchEnd", []);
      await page.locator("#undo").click();
      assert.deepEqual(await positions(), beforeTeams);
    }
    await setOrientation("portrait");
    await page.setViewportSize({ width: 390, height: 844 });
    // Cancelling simultaneous gestures restores their positions.
    one = await center("home-1", 1);
    two = await center("ball", 2);
    await touch("touchStart", [one, two]);
    await touch("touchMove", [
      { ...one, x: one.x - 20 },
      { ...two, x: two.x + 20 },
    ]);
    await touch("touchCancel", []);
    assert.deepEqual(await positions(), baseline);
    // Long press draws; two or more touches cancel drawing and pan.
    await page.locator("#toggle-tools").click();
    await page.locator("#line-lifetime").selectOption("permanent");
    await page.locator("#toggle-tools").click();
    await page.setViewportSize({ width: 700, height: 700 });
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    const courtBox = await page.locator("#court").boundingBox();
    one = {
      id: 1,
      x: courtBox.x + courtBox.width * 0.35,
      y: courtBox.y + courtBox.height * 0.25,
    };
    two = { id: 2, x: courtBox.x + courtBox.width * 0.65, y: one.y };
    await touch("touchStart", [one]);
    await page.waitForTimeout(550);
    await touch("touchMove", [{ ...one, y: one.y - 35 }]);
    await touch("touchEnd", []);
    assert.equal(await page.locator("#arrow-lines line").count(), 1);
    await page.locator("#undo").click();
    await touch("touchStart", [one]);
    await page.waitForTimeout(550);
    one = { ...one, y: one.y - 25 };
    await touch("touchMove", [one]);
    await touch("touchStart", [one, two]);
    assert.equal(
      await page.locator("#arrow-lines line").count(),
      0,
      "second finger cancels arrow preview",
    );
    one = { ...one, y: one.y - 60 };
    two = { ...two, y: two.y - 60 };
    await touch("touchMove", [one, two]);
    await page.waitForFunction(
      () => document.querySelector(".court-scroll").scrollTop > 40,
    );
    const third = { id: 3, x: courtBox.x + courtBox.width * 0.5, y: two.y };
    await touch("touchStart", [one, two, third]);
    await touch("touchMove", [
      { ...one, y: one.y - 30 },
      { ...two, y: two.y - 30 },
      { ...third, y: third.y - 30 },
    ]);
    await touch("touchEnd", []);
    assert.equal(await page.locator("#arrow-lines line").count(), 0);
    // A quick single-finger drag pans and cannot turn into a long-press arrow.
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    one = {
      id: 1,
      x: courtBox.x + courtBox.width * 0.35,
      y: courtBox.y + courtBox.height * 0.25,
    };
    await touch("touchStart", [one]);
    await touch("touchMove", [{ ...one, y: one.y - 60 }]);
    await page.waitForTimeout(550);
    await touch("touchEnd", []);
    assert.ok(
      await page.locator(".court-scroll").evaluate((el) => el.scrollTop > 40),
    );
    assert.equal(await page.locator("#arrow-lines line").count(), 0);
    // Temporary arrows share the deadline of the last completed arrow.
    await page.locator("#toggle-tools").click();
    await page.locator("#line-lifetime").selectOption("temporary");
    await page.locator("#toggle-tools").click();
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.clock.install();
    const drawTemporary = async () => {
      await touch("touchStart", [one]);
      await page.clock.runFor(550);
      await touch("touchMove", [{ ...one, y: one.y - 35 }]);
      await touch("touchEnd", []);
    };
    await drawTemporary();
    await page.clock.runFor(3000);
    await drawTemporary();
    await page.clock.runFor(2000);
    assert.equal(
      await page.locator("#arrow-lines line").count(),
      2,
      "earlier arrow survives its original deadline",
    );
    await page.clock.runFor(3001);
    assert.equal(
      await page.locator("#arrow-lines line").count(),
      0,
      "all temporary arrows expire together",
    );
    // 描画を迷って止まっていても、移動による再描画時も既存線を残す。
    await drawTemporary();
    await touch("touchStart", [one]);
    await page.clock.runFor(6500);
    assert.equal(await page.locator("#arrow-lines line").count(), 1);
    await touch("touchMove", [{ ...one, y: one.y - 35 }]);
    assert.equal(await page.locator("#arrow-lines line").count(), 2);
    await page.clock.runFor(6000);
    assert.equal(await page.locator("#arrow-lines line").count(), 2);
    await touch("touchEnd", []);
    await page.clock.runFor(4999);
    assert.equal(await page.locator("#arrow-lines line").count(), 2);
    await page.clock.runFor(2);
    assert.equal(await page.locator("#arrow-lines line").count(), 0);
    // 描かずに離す・キャンセル・2本指切替でも、5秒後の消去を再開する。
    for (const ending of ["release", "cancel", "pinch"]) {
      await drawTemporary();
      await touch("touchStart", [one]);
      await page.clock.runFor(6500);
      assert.equal(await page.locator("#arrow-lines line").count(), 1);
      if (ending === "pinch") {
        await touch("touchStart", [one, { id: 2, x: one.x + 70, y: one.y }]);
        await page.clock.runFor(5001);
        assert.equal(await page.locator("#arrow-lines line").count(), 0);
        await touch("touchEnd", []);
      } else {
        await touch(ending === "cancel" ? "touchCancel" : "touchEnd", []);
        await page.clock.runFor(4999);
        assert.equal(await page.locator("#arrow-lines line").count(), 1);
        await page.clock.runFor(2);
        assert.equal(await page.locator("#arrow-lines line").count(), 0);
      }
    }
    await page.clock.resume();
    // Pinch enlarges both axes, then orientation selection resets to short-side fit.
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    const beforePinch = await page.locator("#court").boundingBox();
    one = { id: 1, x: 240, y: beforePinch.y + beforePinch.height * 0.25 };
    two = { id: 2, x: 400, y: one.y };
    await touch("touchStart", [one, two]);
    await touch("touchMove", [
      { ...one, x: 160 },
      { ...two, x: 480 },
    ]);
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".court-wrap")
            .style.getPropertyValue("--court-zoom"),
        ) > 1.8,
    );
    await touch("touchEnd", []);
    await checkBallSize();
    assert.ok(
      await page
        .locator(".court-scroll")
        .evaluate(
          (el) =>
            el.scrollWidth > el.clientWidth &&
            el.scrollHeight > el.clientHeight,
        ),
    );
    assert.equal(await page.locator("#arrow-lines line").count(), 0);
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    one = { id: 1, x: 160, y: 180 };
    two = { id: 2, x: 480, y: 180 };
    await touch("touchStart", [one, two]);
    await touch("touchMove", [
      { ...one, x: 290 },
      { ...two, x: 350 },
    ]);
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".court-wrap")
            .style.getPropertyValue("--court-zoom"),
        ) < 0.6,
    );
    await touch("touchEnd", []);
    const fullFit = await page.locator(".court-scroll").evaluate((el) => {
      const c = el.querySelector("#court").getBoundingClientRect();
      return c.width <= el.clientWidth && c.height <= el.clientHeight;
    });
    assert.ok(fullFit, "minimum zoom fits the whole court");
    const doubleTapEmpty = async () => {
      const r = await page.locator("#court").boundingBox();
      const p = { id: 1, x: r.x + r.width * 0.4, y: r.y + r.height * 0.25 };
      await touch("touchStart", [p]);
      await touch("touchMove", [{ ...p, x: p.x + 14, y: p.y + 6 }]);
      await page.waitForTimeout(320);
      assert.equal(
        await page.locator("#arrow-lines line").count(),
        0,
        "touch jitter must not show an arrow preview",
      );
      await touch("touchEnd", []);
      await page.waitForTimeout(370);
      await touch("touchStart", [{ ...p, x: p.x + 20 }]);
      await touch("touchMove", [{ ...p, x: p.x + 32, y: p.y + 6 }]);
      await touch("touchEnd", []);
    };
    await doubleTapEmpty();
    assert.equal(
      await page
        .locator(".court-wrap")
        .evaluate((el) => Number(el.style.getPropertyValue("--court-zoom"))),
      1,
    );
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    await doubleTapEmpty();
    assert.ok(
      await page
        .locator(".court-wrap")
        .evaluate(
          (el) => Number(el.style.getPropertyValue("--court-zoom")) < 1,
        ),
    );
    assert.equal(
      await page.locator("#arrow-lines line").count(),
      0,
      "double taps do not draw arrows",
    );
    await checkBallSize();
    await setOrientation("portrait");
    assert.equal(
      await page
        .locator(".court-wrap")
        .evaluate((el) => el.style.getPropertyValue("--court-zoom")),
      "1",
    );
    // Horizontal scrolling in landscape uses the same gesture.
    await page.setViewportSize({ width: 390, height: 844 });
    await setOrientation("landscape");
    await page.locator(".court-scroll").evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    const horizontal = await page.locator("#court").boundingBox();
    one = { id: 1, x: 240, y: horizontal.y + horizontal.height * 0.4 };
    two = { id: 2, x: 300, y: horizontal.y + horizontal.height * 0.6 };
    await touch("touchStart", [one, two]);
    await touch("touchMove", [
      { ...one, x: one.x - 60 },
      { ...two, x: two.x - 60 },
    ]);
    await page.waitForFunction(
      () => document.querySelector(".court-scroll").scrollLeft > 40,
    );
    await touch("touchEnd", []);
    assert.equal(await page.locator("#arrow-lines line").count(), 0);
    await setOrientation("portrait");
    await page.locator("#toggle-tools").click();
    await page.screenshot({
      path: path.join(process.env.TEMP, "rv-formations-mobile.png"),
    });
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator(".piece").count(), 13);
    await page.locator("#toggle-tools").click();
    assert.equal(await page.locator(".position-slot.saved").count(), 5);
    await page.locator('[data-slot="0"]').click();
    assert.match(
      await page.locator("#status").textContent(),
      /保存した配置を開きました/,
    );
    await setOrientation("landscape");
    assert.equal(
      await page.locator("#landscape").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#tool-panel").isVisible(), false);
    assert.equal(
      await page.evaluate(
        async () => (await fetch("./icons/icon-512.png")).status,
      ),
      200,
    );
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

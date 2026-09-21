const { test } = require("node:test");
const assert = require("node:assert/strict");
// 画面を起動せず、アプリと同じ純粋な計算関数を直接検証する。
const { aimPolygon: polygon } = require("./board-model.js");
const bounds = { left: 7, right: 93 };
const ball = { x: 50, y: 146 };
test("unblocked aim reaches the far baseline and stays inside sidelines", () => {
  const points = polygon(ball, [], bounds, 70, 10);
  assert.equal(points[361].y, 10);
  assert.ok(
    points.every(
      (p) =>
        p.x >= 7 - 1e-8 && p.x <= 93 + 1e-8 && p.y >= 10 - 1e-8 && p.y <= 146,
    ),
  );
});
test("defender cuts off the ray at its front edge, leaving adjacent lanes open", () => {
  const points = polygon(ball, [{ x: 50, y: 85, radius: 5 }], bounds, 70, 10);
  assert.equal(points[361].y, 90);
  assert.ok(points.some((p) => p.y < 70));
});
test("a defender behind the ball does not block the target", () => {
  assert.equal(
    polygon(ball, [{ x: 50, y: 170, radius: 5 }], bounds, 70, 10)[361].y,
    10,
  );
});
test("opponent possession mirrors the shooting region toward home", () => {
  const forward = polygon(ball, [{ x: 50, y: 85, radius: 5 }], bounds, 70, 10);
  const reverse = polygon(
    { x: 50, y: 54 },
    [{ x: 50, y: 115, radius: 5 }],
    bounds,
    130,
    190,
  );
  forward.forEach((p, i) => {
    assert.ok(Math.abs(p.x - reverse[i].x) < 1e-8);
    assert.ok(Math.abs(200 - p.y - reverse[i].y) < 1e-8);
  });
});

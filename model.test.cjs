// 保存形式と参照の独立性を守るため、DOMを使わず配置モデルを検証する。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PLAYER_GRID,
  createInitialState,
  createDefaultSlots,
  isValidState,
} = require("./board-model.js");

const onPlayerGrid = (piece) =>
  Number.isInteger(
    Math.round(
      ((piece.x - PLAYER_GRID.xOrigin) / PLAYER_GRID.xStep) * 1e9,
    ) / 1e9,
  ) &&
  Number.isInteger(
    Math.round(
      ((piece.y - PLAYER_GRID.yOrigin) / PLAYER_GRID.yStep) * 1e9,
    ) / 1e9,
  );

test("default slots are valid and independent", () => {
  const slots = createDefaultSlots();
  assert.equal(slots.length, 5);
  slots.forEach((slot) => assert.ok(isValidState(slot)));
  slots.forEach((slot) =>
    slot.pieces
      .filter((piece) => piece.team !== "ball")
      .forEach((piece) => assert.ok(onPlayerGrid(piece))),
  );
  const original = createInitialState();
  slots[0].pieces[0].x = 7;
  slots[1].pieces[0].x = 8;
  assert.deepEqual(createInitialState(), original);
  assert.deepEqual(createDefaultSlots()[0], original);
  assert.notEqual(slots[2].pieces[0].x, 8);
});

test("saved data rejects missing, duplicate, null and out-of-range pieces", () => {
  for (const mutate of [
    (s) => s.pieces.pop(),
    (s) => (s.pieces[1] = { ...s.pieces[0] }),
    (s) => (s.pieces[0] = null),
    (s) => (s.pieces[0].x = NaN),
    (s) => (s.pieces[0].y = 101),
    (s) => s.arrows.push({ x1: 0, y1: 0, x2: Infinity, y2: 0 }),
  ]) {
    const state = createInitialState();
    mutate(state);
    assert.ok(!isValidState(state));
  }
  assert.ok(!isValidState(null));
});

test("mirrored formations preserve depth and reflect each piece horizontally", () => {
  const slots = createDefaultSlots();
  for (const [normal, mirrored] of [
    [1, 2],
    [3, 4],
  ]) {
    slots[normal].pieces.forEach((piece, index) => {
      assert.equal(slots[mirrored].pieces[index].x, 100 - piece.x);
      assert.equal(slots[mirrored].pieces[index].y, piece.y);
    });
  }
});

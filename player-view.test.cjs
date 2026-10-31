const { test } = require("node:test");
const assert = require("node:assert/strict");
const model = require("./player-view-model.js");

function projection(view, width, height, PerspectiveCamera) {
  const camera = new PerspectiveCamera(view.fov, width / height, 0.03, 100);
  camera.position.set(view.x, view.y, view.z);
  camera.lookAt(view.x + Math.sin(view.yaw) * Math.cos(view.pitch),
    view.y + Math.sin(view.pitch), view.z + Math.cos(view.yaw) * Math.cos(view.pitch));
  camera.updateMatrixWorld();
  return camera;
}

test("3D coordinates use meters and both teams start facing the opposite court", () => {
  assert.deepEqual(model.toWorld({ x: 7, y: 5 }), { x: -4.5, z: -9 });
  assert.deepEqual(model.toWorld({ x: 93, y: 95 }), { x: 4.5, z: 9 });
  const home = model.createCamera({ x: 50, y: 75, team: "home" });
  const away = model.createCamera({ x: 50, y: 25, team: "opponent" });
  assert.equal(Math.cos(home.yaw), -1);
  assert.equal(Math.cos(away.yaw), 1);
  assert.equal(home.y, 0.9);
  assert.equal(away.y, 0.9);
});

test("look stays in place; movement follows heading and preserves 90cm height", () => {
  const camera = model.createCamera({ x: 50, y: 75, team: "home" });
  const before = { ...camera };
  model.look(camera, 100, 10000);
  assert.equal(camera.x, before.x);
  assert.equal(camera.z, before.z);
  assert.equal(camera.y, 0.9);
  assert.ok(camera.pitch <= Math.PI / 3);
  camera.yaw = 0;
  model.move(camera, 100, 0, 800);
  assert.ok(camera.x < before.x);
  assert.equal(camera.z, before.z);
  camera.yaw = Math.PI / 2;
  const x = camera.x;
  model.move(camera, 0, 100, 800);
  assert.ok(camera.x < x);
  model.move(camera, 100000, 100000, 1);
  assert.ok(Math.abs(camera.x) <= 6 && Math.abs(camera.z) <= 10.5);
  assert.equal(camera.y, 0.9);
});

test("pinching changes field of view independently of camera position and has limits", () => {
  const camera = model.createCamera({ x: 50, y: 75, team: "home" });
  const before = { ...camera };
  model.zoom(camera, 2);
  assert.ok(camera.fov < before.fov);
  assert.deepEqual({ ...camera, fov: before.fov }, before);
  model.zoom(camera, 1000); assert.equal(camera.fov, 35);
  model.zoom(camera, 0.0001); assert.equal(camera.fov, 95);
  for (const ratio of [0, -1, NaN, Infinity]) model.zoom(camera, ratio);
  assert.equal(camera.fov, 95);
});

test("dragging keeps the grabbed scene point under the pointer across viewports, zoom and headings", async () => {
  const { PerspectiveCamera, Vector3 } = await import("three");
  for (const [width, height] of [[390, 740], [844, 270], [1100, 640]]) {
    for (const fov of [35, 70, 95]) {
      for (const yaw of [0, Math.PI, -3, 4]) {
        for (const pitch of [-0.5, 0, 0.6]) {
          const view = { x: 1, y: 0.9, z: 5, yaw, pitch, fov };
          const from = { x: width * 0.35, y: height * 0.4 };
          const to = { x: from.x + 24, y: from.y + 15 };
          const point = new Vector3(from.x / width * 2 - 1, 1 - from.y / height * 2, 0.5)
            .unproject(projection(view, width, height, PerspectiveCamera));
          model.dragLook(view, from, to, width, height);
          const screen = point.project(projection(view, width, height, PerspectiveCamera));
          assert.ok(Math.abs((screen.x + 1) * width / 2 - to.x) < 1e-7);
          assert.ok(Math.abs((1 - screen.y) * height / 2 - to.y) < 1e-7);
          assert.equal(view.y, 0.9); assert.equal(view.x, 1); assert.equal(view.z, 5);
        }
      }
    }
  }
});

test("look dragging slows with zoom, stays reversible and respects vertical limits", () => {
  const base = model.createCamera({ x: 50, y: 75, team: "home" });
  const from = { x: 195, y: 370 }, to = { x: 235, y: 390 };
  const view = { ...base };
  model.dragLook(view, from, to, 390, 740);
  assert.ok(view.yaw > base.yaw && view.yaw - base.yaw < 0.1, "40px no longer rotates at the old 0.2rad rate");
  const enlarged = { ...base, fov: 35 };
  model.dragLook(enlarged, from, to, 390, 740);
  assert.ok(Math.abs(enlarged.yaw - base.yaw) < Math.abs(view.yaw - base.yaw));
  const split = { ...base };
  const middle = { x: 215, y: 380 };
  model.dragLook(split, from, middle, 390, 740);
  model.dragLook(split, middle, to, 390, 740);
  assert.ok(Math.abs(split.yaw - view.yaw) < 1e-12 && Math.abs(split.pitch - view.pitch) < 1e-12);
  model.dragLook(view, to, from, 390, 740);
  assert.ok(Math.abs(view.yaw - base.yaw) < 1e-12 && Math.abs(view.pitch - base.pitch) < 1e-12);
  model.dragLook(view, from, { x: from.x, y: 100000 }, 390, 740);
  assert.ok(Number.isFinite(view.yaw) && Math.abs(view.pitch) <= Math.PI / 3);
});

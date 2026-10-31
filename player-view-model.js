// Meter-based camera math, independent of the 2D orientation and of WebGL.
const PlayerViewModel = (() => {
  "use strict";
  const HEIGHT = 0.9;
  const DEFAULT_FOV = 70;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const toWorld = (p) => ({ x: ((p.x - 50) * 9) / 86, z: (p.y - 50) / 5 });
  function createCamera(p) {
    const position = toWorld(p);
    const forward = p.team === "home" ? -1 : 1;
    return { ...position, y: HEIGHT,
      yaw: Math.atan2(-position.x, forward * 4.5 - position.z),
      pitch: 0, fov: DEFAULT_FOV };
  }
  function look(camera, dx, dy) {
    camera.yaw -= dx * 0.005;
    camera.pitch = clamp(camera.pitch + dy * 0.005, -Math.PI / 3, Math.PI / 3);
  }
  // 画面上の点を、現在のカメラから見たワールド方向へ変換する。
  function screenRay(camera, point, width, height) {
    const focal = height / (2 * Math.tan(camera.fov * Math.PI / 360));
    const a = (point.x - width / 2) / focal;
    const b = (height / 2 - point.y) / focal;
    const length = Math.hypot(1, a, b);
    const sinYaw = Math.sin(camera.yaw), cosYaw = Math.cos(camera.yaw);
    const sinPitch = Math.sin(camera.pitch), cosPitch = Math.cos(camera.pitch);
    const forward = cosPitch - b * sinPitch;
    return {
      x: (sinYaw * forward - a * cosYaw) / length,
      y: (sinPitch + b * cosPitch) / length,
      z: (cosYaw * forward + a * sinYaw) / length,
    };
  }
  function dragLook(camera, from, to, width, height) {
    if (width <= 0 || height <= 0) return;
    const anchor = screenRay(camera, from, width, height);
    const focal = height / (2 * Math.tan(camera.fov * Math.PI / 360));
    const a = (to.x - width / 2) / focal;
    const b = (height / 2 - to.y) / focal;
    const offset = Math.atan2(b, 1);
    const angle = Math.asin(clamp(anchor.y * Math.hypot(1, a, b) / Math.hypot(1, b), -1, 1));
    const wrapNear = (angle, reference) => reference + Math.atan2(Math.sin(angle - reference), Math.cos(angle - reference));
    // 上下を大きく見回している場合も、直前の姿勢に近い解を使う。
    const candidates = [angle - offset, Math.PI - angle - offset]
      .map((pitch) => wrapNear(pitch, camera.pitch));
    const nearest = candidates.reduce((best, pitch) =>
      Math.abs(pitch - camera.pitch) < Math.abs(best - camera.pitch) ? pitch : best);
    camera.pitch = clamp(nearest, -Math.PI / 3, Math.PI / 3);
    const forward = Math.cos(camera.pitch) - b * Math.sin(camera.pitch);
    camera.yaw = wrapNear(Math.atan2(anchor.x, anchor.z) + Math.atan2(a, forward), camera.yaw);
  }
  function move(camera, dx, dy, viewportHeight) {
    const scale = 8 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, viewportHeight);
    // Drag the scene: horizontal movement strafes, vertical movement goes forward/back.
    camera.x = clamp(camera.x - (Math.cos(camera.yaw) * dx + Math.sin(camera.yaw) * dy) * scale, -6, 6);
    camera.z = clamp(camera.z + (Math.sin(camera.yaw) * dx - Math.cos(camera.yaw) * dy) * scale, -10.5, 10.5);
    camera.y = HEIGHT;
  }
  function zoom(camera, ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const tangent = Math.tan(camera.fov * Math.PI / 360) / ratio;
    camera.fov = clamp(2 * Math.atan(tangent) * 180 / Math.PI, 35, 95);
  }
  return { HEIGHT, DEFAULT_FOV, toWorld, createCamera, look, dragLook, move, zoom };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PlayerViewModel;

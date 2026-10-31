import * as THREE from "three";

// The bundled classic script works offline and when index.html is opened directly.
(() => {
  "use strict";
  const model = PlayerViewModel;
  const dialog = document.getElementById("player-view-dialog");
  const canvas = document.getElementById("player-view-canvas");
  const error = document.getElementById("player-view-error");
  const pointers = new Map();
  let renderer, scene, camera, view, origin, returnId, frame = 0;
  let getSnapshot, sceneSignature, observer;
  const color = (p) => p.team === "home" ? 0x397cd8 : 0xdb6559;
  const material = (c, opacity = 1) => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.85, transparent: opacity < 1, opacity,
    depthWrite: opacity === 1, side: THREE.DoubleSide,
  });
  function mesh(geometry, mat, x, y, z, parent = scene) {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }
  function floor(width, depth, x, z, c, y = 0.003, opacity = 1) {
    const object = mesh(new THREE.PlaneGeometry(width, depth), material(c, opacity), x, y, z);
    object.rotation.x = -Math.PI / 2;
    return object;
  }
  function segment(a, b, width, c, y = 0.008) {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const object = floor(width, length, (a.x + b.x) / 2, (a.z + b.z) / 2, c, y);
    object.rotation.z = -Math.atan2(b.x - a.x, b.z - a.z);
  }
  function label(text, c) {
    const image = document.createElement("canvas");
    image.width = 256; image.height = 128;
    const ctx = image.getContext("2d");
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.roundRect(4, 4, 248, 120, 28); ctx.fill();
    ctx.fillStyle = "white";
    ctx.font = "bold 62px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 68);
    const texture = new THREE.CanvasTexture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    sprite.scale.set(0.7, 0.35, 1);
    return sprite;
  }
  function clearScene() {
    if (!scene) return;
    scene.traverse((object) => {
      object.geometry?.dispose();
      for (const mat of [object.material].flat().filter(Boolean)) {
        mat.map?.dispose(); mat.dispose();
      }
    });
    scene.clear();
  }
  function buildScene(snapshot) {
    clearScene();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe4ece6);
    scene.fog = new THREE.Fog(0xe4ece6, 24, 65);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6c8174, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(-5, 12, 6); scene.add(light);
    floor(150, 150, 0, 0, 0xc7d4c5, 0);
    floor(9, 9, 0, 4.5, 0x537d70);
    floor(9, 9, 0, -4.5, 0x638878);
    for (const x of [-4.5, 4.5]) floor(0.05, 18.05, x, 0, 0xf2f4dc);
    for (const z of [-9, -3, 0, 3, 9]) floor(9, 0.05, 0, z, 0xf2f4dc);
    for (const z of [-8.2, 8.2]) {
      const badge = label(z > 0 ? "HOME" : "AWAY", z > 0 ? "#397cd8" : "#c75c53");
      badge.position.set(0, 0.02, z);
      // Team labels stand beyond the end lines, keeping the playing surface clear.
      badge.position.set(0, 0.55, Math.sign(z) * 10);
      badge.scale.set(1.4, 0.7, 1); scene.add(badge);
    }
    // Rolling volleyball: net clearance 35cm. The 1m mesh depth is illustrative.
    const vertices = [];
    for (let x = -4.5; x <= 4.51; x += 0.1) vertices.push(x, 0.35, 0, x, 1.35, 0);
    for (let y = 0.35; y <= 1.351; y += 0.1) vertices.push(-4.5, y, 0, 4.5, y, 0);
    const net = new THREE.BufferGeometry();
    net.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    scene.add(new THREE.LineSegments(net, new THREE.LineBasicMaterial({ color: 0x52645c, transparent: true, opacity: 0.38 })));
    for (const y of [0.35, 1.35]) mesh(new THREE.BoxGeometry(9, 0.035, 0.025), material(0xf5f5e8), 0, y, 0);
    for (const x of [-4.7, 4.7]) mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8), material(0x304c47), x, 0.75, 0);
    const ball = snapshot.pieces.find((p) => p.team === "ball");
    if (snapshot.aim) {
      const start = model.toWorld(ball);
      const defenders = snapshot.pieces.filter((p) => p.team === (ball.y >= 50 ? "opponent" : "home"))
        .map((p) => { const w = model.toWorld(p); return { x: w.x, y: w.z, radius: BoardModel.pieceDiameter(p, ball, snapshot.adaptive) / 2 }; });
      const points = BoardModel.aimPolygon({ x: start.x, y: start.z }, defenders,
        { left: -4.5, right: 4.5 }, ball.y >= 50 ? -3 : 3, ball.y >= 50 ? -9 : 9);
      const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
      // Remove receive-area disks as in the 2D overlay.
      for (const p of defenders) {
        const hole = new THREE.Path(); hole.absarc(p.x, -p.y, p.radius, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
      const aim = mesh(new THREE.ShapeGeometry(shape), material(0xffdc5c, 0.3), 0, 0.006, 0);
      aim.rotation.x = -Math.PI / 2;
    }
    for (const arrow of snapshot.arrows) {
      const a = model.toWorld({ x: arrow.x1, y: arrow.y1 });
      const b = model.toWorld({ x: arrow.x2, y: arrow.y2 });
      segment(a, b, 0.065, 0xffedaa);
      const angle = Math.atan2(b.x - a.x, b.z - a.z);
      for (const offset of [-0.55, 0.55]) segment(b,
        { x: b.x - Math.sin(angle + offset) * 0.32, z: b.z - Math.cos(angle + offset) * 0.32 }, 0.065, 0xffedaa);
    }
    for (const p of snapshot.pieces) {
      const { x, z } = model.toWorld(p);
      if (p.team === "ball") {
        mesh(new THREE.SphereGeometry(0.25, 20, 12), material(0xffed85), x, 0.25, z);
        mesh(new THREE.TorusGeometry(0.25, 0.012, 5, 32), material(0x4a737c), x, 0.25, z);
        continue;
      }
      const radius = BoardModel.pieceDiameter(p, ball, snapshot.adaptive) / 2;
      const disk = mesh(new THREE.CircleGeometry(radius, 48), material(color(p), 0.2), x, 0.012, z);
      disk.rotation.x = -Math.PI / 2;
      const ring = mesh(new THREE.RingGeometry(radius - 0.018, radius, 48), material(color(p), 0.65), x, 0.014, z);
      ring.rotation.x = -Math.PI / 2;
      if (p.id === returnId) continue;
      const group = new THREE.Group(); group.position.set(x, 0, z);
      group.rotation.y = p.team === "home" ? Math.PI : 0; scene.add(group);
      // 全員を同じ座位の高さにそろえ、足は描画しない。
      const torsoY = 0.34, headY = 0.78;
      mesh(new THREE.CapsuleGeometry(0.19, 0.23, 4, 10), material(color(p)), 0, torsoY, 0, group);
      mesh(new THREE.SphereGeometry(0.145, 12, 8), material(0xe6ba94), 0, headY, 0, group);
      for (const side of [-1, 1]) {
        const arm = mesh(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), material(color(p)), side * 0.29, torsoY - 0.07, 0.04, group);
        arm.rotation.z = side * 0.22;
      }
      const badge = label(String(p.number), p.team === "home" ? "#2868bc" : "#bc4c43");
      badge.position.set(0, headY + 0.4, 0); group.add(badge);
    }
  }
  function render() {
    frame = 0;
    if (!dialog.open || !renderer || !view || document.hidden || !canvas.clientHeight) return;
    const snapshot = getSnapshot();
    const signature = JSON.stringify(snapshot);
    if (signature !== sceneSignature) { buildScene(snapshot); sceneSignature = signature; }
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.fov = view.fov; camera.updateProjectionMatrix();
    camera.position.set(view.x, model.HEIGHT, view.z);
    camera.lookAt(view.x + Math.sin(view.yaw) * Math.cos(view.pitch),
      model.HEIGHT + Math.sin(view.pitch), view.z + Math.cos(view.yaw) * Math.cos(view.pitch));
    renderer.render(scene, camera);
  }
  function requestRender() {
    if (dialog.open && renderer && !frame) frame = requestAnimationFrame(render);
  }
  function geometry() {
    const points = [...pointers.values()];
    const x = points.reduce((n, p) => n + p.x, 0) / points.length;
    const y = points.reduce((n, p) => n + p.y, 0) / points.length;
    return { x, y, radius: Math.sqrt(points.reduce((n, p) => n + (p.x - x) ** 2 + (p.y - y) ** 2, 0) / points.length) };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2 || !view || !renderer) return;
    event.preventDefault(); canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.shiftKey });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const before = geometry();
    const next = { ...previous, x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);
    const after = geometry();
    if (pointers.size >= 2) {
      model.move(view, after.x - before.x, after.y - before.y, canvas.clientHeight);
      if (before.radius > 4 && after.radius > 4) model.zoom(view, after.radius / before.radius);
    } else if (previous.pan) model.move(view, next.x - previous.x, next.y - previous.y, canvas.clientHeight);
    else {
      // 指が触れていた景色を、新しい指の位置へ投影する。画角・画面寸法も反映する。
      const rect = canvas.getBoundingClientRect();
      model.dragLook(view,
        { x: previous.x - rect.left, y: previous.y - rect.top },
        { x: next.x - rect.left, y: next.y - rect.top },
        rect.width, rect.height);
    }
    requestRender();
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, release);
  function releaseAll() {
    for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
  }
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    if (!view || !renderer) return;
    event.preventDefault(); model.zoom(view, Math.exp(-event.deltaY * 0.001)); requestRender();
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (!view || !renderer) return;
    const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key];
    if (delta) {
      event.preventDefault();
      if (event.shiftKey) model.move(view, ...delta, canvas.clientHeight);
      else model.look(view, ...delta);
    } else if (event.key === "+" || event.key === "=") { event.preventDefault(); model.zoom(view, 1.1); }
    else if (event.key === "-") { event.preventDefault(); model.zoom(view, 1 / 1.1); }
    else return;
    requestRender();
  });
  document.getElementById("reset-player-view").onclick = () => { releaseAll(); view = { ...origin }; requestRender(); };
  document.getElementById("close-player-view").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    releaseAll(); cancelAnimationFrame(frame); frame = 0;
    observer?.disconnect(); clearScene(); sceneSignature = null;
    document.querySelector(`[data-id="${returnId}"]`)?.focus({ preventScroll: true });
    getSnapshot = null;
  });
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => { releaseAll(); requestRender(); });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault(); releaseAll();
    error.textContent = "3D表示が中断されました。2Dに戻って、もう一度選手の視点を開いてください。";
    error.hidden = false;
    renderer?.dispose(); renderer = null;
  });
  window.PlayerView = {
    open(id, readSnapshot) {
      if (dialog.open) return;
      const p = readSnapshot().pieces.find((piece) => piece.id === id && piece.team !== "ball");
      if (!p) return;
      returnId = id; getSnapshot = readSnapshot;
      origin = model.createCamera(p); view = { ...origin };
      document.getElementById("player-view-title").textContent = `${p.team === "home" ? "味方" : "相手"} ${p.number}番の視点`;
      document.getElementById("player-view-team").dataset.team = p.team;
      error.hidden = true; dialog.showModal();
      try {
        if (!renderer) {
          renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          camera = new THREE.PerspectiveCamera(70, 1, 0.03, 100);
        }
        observer = new ResizeObserver(requestRender); observer.observe(canvas);
        render(); canvas.focus({ preventScroll: true });
      } catch (cause) {
        observer?.disconnect(); clearScene(); renderer?.dispose(); renderer = null;
        error.textContent = "この端末では3D表示を開始できません。2Dに戻ってご利用ください。";
        error.hidden = false;
        document.getElementById("close-player-view").focus();
        console.warn("Player view unavailable:", cause.message);
      }
    },
    refresh: requestRender,
    getCameraState: () => dialog.open && view ? { ...view } : null,
  };
})();

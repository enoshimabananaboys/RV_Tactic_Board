(() => {
  "use strict";
  // 操作の時間・距離はここに集約する。変更時は使い方とREADMEも更新する。
  const TIMING = {
    arrowHold: 500,
    arrowLifetime: 5000,
    aimLifetime: 5000,
    slotHold: 650,
    notice: 3500,
    doubleTap: 450,
  };
  const LIMITS = {
    history: 60,
    zoom: 3,
    touchSlop: 24,
    mouseSlop: 10,
    doubleTapDistance: 40,
  };
  const {
    PLAYER_GRID,
    pieceDiameter,
    aimPolygon,
    createInitialState,
    isValidState,
    createDefaultSlots,
  } = BoardModel;
  const $ = (id) => document.getElementById(id);
  const KEY = "rv-tactic-board-v1";
  const SLOTS_KEY = KEY + "-slots";

  // 配置・表示状態・指ごとの操作を分ける。一時矢印は履歴に含めない。
  let state = createInitialState(),
    landscape = false,
    zoom = 1;
  // 再読み込みまでは、最後に呼び出した枠の最新内容を「初期位置」として扱う。
  let recalledSlotIndex = null;
  let pinch = null,
    lastCourtTap = null;
  const gestures = new Map();
  let gestureBefore = null;
  let aimVisibleUntil = 0,
    aimTimer;
  function keepAimBriefly() {
    clearTimeout(aimTimer);
    aimVisibleUntil = Date.now() + TIMING.aimLifetime;
    aimTimer = setTimeout(() => {
      aimVisibleUntil = 0;
      drawAim();
    }, TIMING.aimLifetime);
  }
  $("aim-visibility").onchange = () => {
    clearTimeout(aimTimer);
    aimVisibleUntil = 0;
    drawAim();
  };
  let temporaryArrows = [];
  let expiryTimer;
  let arrowExpiryPaused = false;
  function hasVisibleArrows() {
    return (
      state.arrows.length > 0 ||
      temporaryArrows.some(
        (arrow) => arrowExpiryPaused || arrow.expiresAt > Date.now(),
      )
    );
  }
  // 描画開始から終了まで、既存の一時線も保持する。
  // 中断や複数指パンへの切替でも解除し、消去を止めたままにしない。
  function updateArrowExpiryPause() {
    const drawing = [...gestures.values()].some(
      (g) => g.drawing && !g.scrolling,
    );
    if (drawing && !arrowExpiryPaused) {
      temporaryArrows = temporaryArrows.filter((a) => a.expiresAt > Date.now());
    } else if (!drawing && arrowExpiryPaused) {
      const expiresAt = Date.now() + TIMING.arrowLifetime;
      temporaryArrows.forEach((a) => (a.expiresAt = expiresAt));
    }
    arrowExpiryPaused = drawing;
    scheduleExpiry();
  }
  // 全一時矢印の期限は描画完了時に揃え、タイマーは1本だけ管理する。
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (arrowExpiryPaused) return;
    temporaryArrows = temporaryArrows.filter((a) => a.expiresAt > Date.now());
    if (temporaryArrows.length)
      expiryTimer = setTimeout(
        () => {
          scheduleExpiry();
          drawArrows();
        },
        Math.max(
          0,
          Math.min(...temporaryArrows.map((a) => a.expiresAt)) - Date.now(),
        ),
      );
  }
  const undo = [],
    redo = [];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  let autoMode = "off";
  let autoEnabled = false;
  let autoBlocked = false;
  let autoAnchors = BoardModel.selectAutoAnchors(state.pieces);
  const autoAnimations = new Map();
  let autoFrame = 0;
  let autoPausedAt = null;
  function visualPiece(p, now = performance.now()) {
    const animation = autoAnimations.get(p.id);
    if (!animation) return p;
    const t = Math.min(
      1,
      ((autoPausedAt ?? now) - animation.start) / animation.duration,
    );
    const ease = 1 - (1 - t) ** 3;
    return { ...p, x: animation.x + (p.x - animation.x) * ease,
      y: animation.y + (p.y - animation.y) * ease };
  }
  function animateAuto(now) {
    autoFrame = 0;
    for (const [id, animation] of autoAnimations) {
      const p = state.pieces.find((p) => p.id === id);
      const button = document.querySelector(`[data-id="${id}"]`);
      if (button) placePiece(button, visualPiece(p, now));
      if (now >= animation.start + animation.duration) autoAnimations.delete(id);
    }
    drawAim();
    if (autoAnimations.size) autoFrame = requestAnimationFrame(animateAuto);
  }
  function stopAutoAnimations() {
    cancelAnimationFrame(autoFrame);
    autoFrame = 0;
    autoAnimations.clear();
    autoPausedAt = null;
  }
  function updateAutoUI() {
    $("auto-position").setAttribute("aria-pressed", autoEnabled);
    $("auto-position").textContent = `自動位置${autoMode.toUpperCase()}`;
    $("auto-position").dataset.mode = autoMode;
    $("auto-position").title = "自動位置OFF → ON（中4人）→ FULL（全6人）";
    document.querySelectorAll(".piece:not(.ball)").forEach((button) => {
      button.removeAttribute("aria-disabled");
      button.title = "ドラッグ後に25cm単位へ整列・矢印キーで移動";
    });
  }
  function setAuto(mode) {
    autoMode = mode;
    const enabled = mode !== "off";
    autoEnabled = enabled;
    autoBlocked = false;
    if (enabled) autoAnchors = BoardModel.selectAutoAnchors(state.pieces, autoAnchors);
    else stopAutoAnimations();
    updateAutoUI();
  }
  $("auto-position").onclick = () => {
    if (gestures.size) return;
    const modes = ["off", "on", "full"];
    setAuto(modes[(modes.indexOf(autoMode) + 1) % modes.length]);
    render();
  };
  // 手動操作は表示中の位置から引き継ぐ。他の自動移動は次のボール移動まで停止。
  function beginManualPosition(p, button) {
    if (!autoEnabled) return;
    if (autoPausedAt === null) autoPausedAt = performance.now();
    cancelAnimationFrame(autoFrame);
    autoFrame = 0;
    if (autoAnimations.has(p.id)) {
      const visible = courtPoint({
        x: parseFloat(button.style.left),
        y: parseFloat(button.style.top),
      });
      p.x = visible.x;
      p.y = visible.y;
      autoAnimations.delete(p.id);
    }
    // ボールの取り消しで、後から始めた手動操作を巻き戻さない。
    for (const g of gestures.values()) g.autoMoved?.delete(p.id);
  }
  function resumeAutoAnimations(now) {
    if (autoPausedAt === null) return;
    for (const animation of autoAnimations.values()) {
      animation.start += now - autoPausedAt;
    }
    autoPausedAt = null;
  }
  function runAutoPosition() {
    if (
      !autoEnabled ||
      [...gestures.values()].some((g) => g.piece && g.piece.team !== "ball")
    ) return;
    const destinations = BoardModel.autoPosition(state.pieces, autoAnchors, autoMode);
    if (!destinations.length) {
      if (!autoBlocked) announce(autoMode === "full"
        ? "全6人を配置できません。選手の配置を調整してください。"
        : "中4人を配置できません。固定メンバーの間隔を広げてください。");
      autoBlocked = true;
      return;
    }
    autoBlocked = false;
    const now = performance.now();
    resumeAutoAnimations(now);
    for (const destination of destinations) {
      const p = state.pieces.find((p) => p.id === destination.id);
      if (p.x === destination.x && p.y === destination.y) continue;
      const from = visualPiece(p, now);
      const distance = Math.hypot((from.x - destination.x) * 9 / 86, (from.y - destination.y) / 5);
      autoAnimations.set(p.id, { x: from.x, y: from.y, start: now,
        duration: Math.min(600, 240 + distance * 120) });
      Object.assign(p, destination);
      for (const g of gestures.values()) {
        if (g.piece?.team === "ball") g.autoMoved?.add(p.id);
      }
    }
    if (autoAnimations.size && !autoFrame) autoFrame = requestAnimationFrame(animateAuto);
  }
  let noticeTimer;
  const announce = (message) => {
    $("status").textContent = message;
    // 通常の操作通知は読み上げ領域に留め、保存結果や失敗だけを画面に表示する。
    const show =
      /保存しました|保存した配置を開きました|ありません|できません|読み込めません|初期値に戻しました/.test(
        message,
      );
    $("status").classList.toggle("notice", show);
    clearTimeout(noticeTimer);
    if (show)
      noticeTimer = setTimeout(
        () => $("status").classList.remove("notice"),
        TIMING.notice,
      );
  };
  // ツールと説明ダイアログ：閉じるタップをコート操作へ流さない。
  $("toggle-tools").onclick = () => {
    const open = $("tool-panel").hidden;
    $("tool-panel").hidden = !open;
    $("toggle-tools").setAttribute("aria-expanded", open);
  };
  function openHelp() {
    dismissedByPointer = false;
    if (!$("help-dialog").open) $("help-dialog").showModal();
    document.querySelector(".help-content").scrollTop = 0;
  }
  $("open-help").onclick = openHelp;
  // スクロール可能なパネルでは微小な指の動きでclickが省略されるためpointerupも扱う。
  let helpTouch = null;
  $("open-help").addEventListener("pointerdown", (event) => {
    helpTouch =
      event.pointerType === "touch"
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
  });
  $("open-help").addEventListener("pointermove", (event) => {
    if (
      helpTouch &&
      Math.hypot(event.clientX - helpTouch.x, event.clientY - helpTouch.y) > 18
    )
      helpTouch = null;
  });
  $("open-help").addEventListener("pointercancel", () => {
    helpTouch = null;
  });
  $("open-help").addEventListener("pointerup", (event) => {
    if (helpTouch?.id !== event.pointerId) return;
    helpTouch = null;
    const rect = $("open-help").getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    event.preventDefault();
    openHelp();
  });
  let helpBackdropPointer = null;
  const outsideHelp = (event) => {
    const rect = $("help-dialog").getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  $("help-dialog").addEventListener("pointerdown", (event) => {
    helpBackdropPointer =
      event.target === $("help-dialog") && outsideHelp(event)
        ? event.pointerId
        : null;
  });
  $("help-dialog").addEventListener("pointercancel", () => {
    helpBackdropPointer = null;
  });
  $("help-dialog").addEventListener("click", (event) => {
    if (
      helpBackdropPointer !== null &&
      event.target === $("help-dialog") &&
      outsideHelp(event)
    )
      $("help-dialog").close();
    helpBackdropPointer = null;
  });
  $("close-help").onclick = () => $("help-dialog").close();
  $("help-dialog").addEventListener("close", () =>
    $("open-help").focus({ preventScroll: true }),
  );
  function closeTools() {
    $("tool-panel").hidden = true;
    $("toggle-tools").setAttribute("aria-expanded", "false");
    $("toggle-tools").focus({ preventScroll: true });
  }
  let dismissedByPointer = false;
  document.addEventListener(
    "pointerdown",
    (event) => {
      dismissedByPointer = false;
      if ($("help-dialog").open) return;
      if (
        $("tool-panel").hidden ||
        $("tool-panel").contains(event.target) ||
        $("toggle-tools").contains(event.target)
      )
        return;
      if (event.target.closest(".board-heading")) {
        closeTools();
        return;
      }
      dismissedByPointer = true;
      closeTools();
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  // パネルを閉じた直後のclickを消費し、背後のボタンの誤操作を防ぐ。
  document.addEventListener(
    "click",
    (event) => {
      if (!dismissedByPointer || event.detail === 0) return;
      dismissedByPointer = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if ($("help-dialog").open) return;
    if (event.key === "Escape" && !$("tool-panel").hidden) {
      closeTools();
      event.preventDefault();
    }
  });
  function remember(previous) {
    undo.push(previous);
    if (undo.length > LIMITS.history) undo.shift();
    redo.length = 0;
  }
  function historyButtons() {
    $("undo").disabled = !undo.length;
    $("redo").disabled = !redo.length;
  }
  // 保存座標は常に縦向き（味方が下）。横向きへの変換は描画・入力の境界で行う。
  const screenPoint = (p) => (landscape ? { x: 100 - p.y, y: p.x } : p);
  const courtPoint = (p) => (landscape ? { x: p.y, y: 100 - p.x } : p);
  function pieceBounds(p, adaptive = false) {
    if (p.team === "ball") return { minX: 7, maxX: 93, minY: 5, maxY: 95 };
    // 選手ごとの半径をコート座標へ換算。ラインの描画幅は含めない。
    const clearance = (pieceDiameter(p, state.pieces.find((q) => q.team === "ball"), adaptive) / 2 / 18) * 90;
    const front = p.number >= 4;
    const [min, max] =
      p.team === "home"
        ? front
          ? [50 + clearance, 65 - clearance]
          : [65 + clearance, 95]
        : front
          ? [35 + clearance, 50 - clearance]
          : [5, 35 - clearance];
    return { minX: 7, maxX: 93, minY: min, maxY: max };
  }
  function constrainPiece(p) {
    const bounds = pieceBounds(p);
    p.x = Math.max(bounds.minX, Math.min(bounds.maxX, p.x));
    p.y = Math.max(bounds.minY, Math.min(bounds.maxY, p.y));
  }
  function snapPlayerToGrid(p) {
    if (p.team === "ball") return;
    const bounds = pieceBounds(p, autoEnabled);
    const snapAxis = (value, origin, step, min, max) => {
      const grid = origin + Math.round((value - origin) / step) * step;
      const candidates = [min, max, Math.max(min, Math.min(max, grid))];
      return candidates.reduce((best, candidate) =>
        Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
      );
    };
    p.x = snapAxis(
      p.x,
      PLAYER_GRID.xOrigin,
      PLAYER_GRID.xStep,
      bounds.minX,
      bounds.maxX,
    );
    p.y = snapAxis(
      p.y,
      PLAYER_GRID.yOrigin,
      PLAYER_GRID.yStep,
      bounds.minY,
      bounds.maxY,
    );
  }
  function movePlayerOnGrid(p, dx, dy) {
    const bounds = pieceBounds(p, autoEnabled);
    const moveAxis = (value, origin, step, direction, min, max) => {
      const index = (value - origin) / step;
      const nextIndex =
        direction > 0
          ? Math.floor(index + 1e-9) + 1
          : Math.ceil(index - 1e-9) - 1;
      return Math.max(min, Math.min(max, origin + nextIndex * step));
    };
    if (dx)
      p.x = moveAxis(
        p.x,
        PLAYER_GRID.xOrigin,
        PLAYER_GRID.xStep,
        dx,
        bounds.minX,
        bounds.maxX,
      );
    if (dy)
      p.y = moveAxis(
        p.y,
        PLAYER_GRID.yOrigin,
        PLAYER_GRID.yStep,
        dy,
        bounds.minY,
        bounds.maxY,
      );
  }
  function placePiece(button, p) {
    const display = screenPoint(p);
    button.style.left = `${display.x}%`;
    button.style.top = `${display.y}%`;
  }
  // SVGは確定線・一時線・描画プレビューを重ねて表示する。
  function drawArrows() {
    const previews = [...gestures.values()]
      .filter((g) => !g.piece && !g.scrolling && g.end)
      .map((g) => ({ x1: g.start.x, y1: g.start.y, x2: g.end.x, y2: g.end.y }));
    $("arrow-lines").replaceChildren();
    [
      ...state.arrows,
      ...temporaryArrows.filter(
        (a) => arrowExpiryPaused || a.expiresAt > Date.now(),
      ),
      ...previews,
    ].forEach((a) => {
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      const start = screenPoint({ x: a.x1, y: a.y1 }),
        end = screenPoint({ x: a.x2, y: a.y2 });
      const scaleX = landscape ? 86 / 45 : 1,
        scaleY = landscape ? 1 : 86 / 45;
      Object.entries({
        x1: start.x * scaleX,
        y1: start.y * scaleY,
        x2: end.x * scaleX,
        y2: end.y * scaleY,
        stroke: "#fff5c2",
        "stroke-width": 0.8,
        "stroke-linecap": "round",
        "marker-end": "url(#arrowhead)",
      }).forEach(([k, v]) => line.setAttribute(k, v));
      $("arrow-lines").append(line);
    });
  }
  // Canvasは画面密度に合わせ、選手の円を最後にくり抜く。
  function drawAim() {
    updateDisplayedSizes();
    const canvas = $("aim-overlay");
    const ball = state.pieces.find((p) => p.team === "ball");
    canvas.hidden =
      $("aim-visibility").value !== "always" &&
      ![...gestures.values()].some((g) => g.piece?.team === "ball") &&
      Date.now() >= aimVisibleUntil;
    if (canvas.hidden) return;
    const rect = $("court").getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const width = landscape ? rect.height : rect.width;
    const height = landscape ? rect.width : rect.height;
    const toPixel = (p) => ({
      x: (p.x * width) / 100,
      y: (p.y * height) / 100,
    });
    const target = ball.y >= 50 ? "opponent" : "home";
    const defenders = state.pieces
      .filter((p) => p.team === target)
      .map((p) => ({
        ...toPixel(visualPiece(p)),
        radius: ((width * 0.86) / 9) * pieceDiameter(visualPiece(p), ball, autoEnabled) / 2,
      }));
    const points = aimPolygon(
      toPixel(ball),
      defenders,
      { left: width * 0.07, right: width * 0.93 },
      height * (target === "opponent" ? 0.35 : 0.65),
      height * (target === "opponent" ? 0.05 : 0.95),
    );
    if (landscape) {
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 221, 92, 0.32)";
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    for (const p of defenders) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 円径は実際に表示中の中心間距離から求める。固定選手も両チームとも対象。
  // サイズ変更だけでは固定位置を動かさない。自動配置候補は拡大後の円で計算する。
  function updateDisplayedSizes() {
    const rect = $("court").getBoundingClientRect();
    const meter = ((landscape ? rect.height : rect.width) * 0.86) / 9;
    const ball = state.pieces.find((p) => p.team === "ball");
    for (const p of state.pieces) {
      if (p.team === "ball") continue;
      const button = document.querySelector(`[data-id="${p.id}"]`);
      if (!button) continue;
      const diameter = pieceDiameter(visualPiece(p), ball, autoEnabled);
      button.style.setProperty("--piece-size", `${meter * diameter}px`);
    }
  }
  function updatePieceSize() {
    const rect = $("court").getBoundingClientRect();
    // 競技領域の幅9mは、縦表示の幅（横表示の高さ）の86%に相当する。
    const meter = ((landscape ? rect.height : rect.width) * 0.86) / 9;
    $("court").style.setProperty(
      "--front-size",
      `${meter * pieceDiameter({ number: 4 })}px`,
    );
    $("court").style.setProperty(
      "--back-size",
      `${meter * pieceDiameter({ number: 1 })}px`,
    );
    $("court").style.setProperty(
      "--ball-size",
      `${meter * pieceDiameter({ team: "ball" })}px`,
    );
  }
  function render() {
    updatePieceSize();
    state.pieces.forEach(constrainPiece);
    $("pieces").replaceChildren();
    state.opponents = true;
    state.pieces.forEach((p) => {
      const button = document.createElement("button");
      button.className = `piece ${p.team}`;
      button.dataset.id = p.id;
      if (p.team !== "ball")
        button.style.setProperty(
          "--piece-size",
          p.number >= 4 ? "var(--front-size)" : "var(--back-size)",
        );
      button.textContent = p.team === "ball" ? "" : p.number;
      button.setAttribute(
        "aria-label",
        p.team === "ball"
          ? "ボール"
          : `${p.team === "home" ? "味方" : "相手"} ${p.number}番`,
      );
      button.title =
        p.team === "ball"
          ? "ドラッグで移動・矢印キーで微調整"
          : "ドラッグ後に25cm単位へ整列・矢印キーで移動";
      placePiece(button, visualPiece(p));
      $("pieces").append(button);
    });
    updateAutoUI();
    drawArrows();
    historyButtons();
    drawAim();
  }
  function point(event) {
    const r = $("court").getBoundingClientRect();
    const p = courtPoint({
      x: ((event.clientX - r.left) / r.width) * 100,
      y: ((event.clientY - r.top) / r.height) * 100,
    });
    return {
      x: Math.max(7, Math.min(93, p.x)),
      y: Math.max(5, Math.min(95, p.y)),
    };
  }
  // CSSの外周余白20px×2を除いた領域に、コート全体を収める倍率。
  function applyZoom() {
    document
      .querySelector(".court-wrap")
      .style.setProperty("--court-zoom", zoom);
  }

  function panCourt(dx, dy) {
    const viewport = document.querySelector(".court-scroll");
    viewport.scrollLeft -= dx;
    viewport.scrollTop -= dy;
  }

  function showHomeCourt() {
    const viewport = document.querySelector(".court-scroll");
    viewport.scrollLeft = 0;
    viewport.scrollTop = landscape ? 0 : viewport.scrollHeight;
  }

  function minimumZoom() {
    const viewport = document.querySelector(".court-scroll");
    const width = Math.max(1, viewport.clientWidth - 40),
      height = Math.max(1, viewport.clientHeight - 40);
    return Math.min(
      1,
      landscape ? width / ((height * 86) / 45) : height / ((width * 86) / 45),
    );
  }
  function toggleCourtFit() {
    zoom = Math.abs(zoom - minimumZoom()) < 0.02 ? 1 : minimumZoom();
    applyZoom();
    render();
    showHomeCourt();
  }
  function setOrientation(id, fitWholeCourt = false) {
    if (gestures.size) return;
    lastCourtTap = null;
    landscape = id === "landscape";
    zoom = 1;
    applyZoom();
    document
      .querySelector(".workspace")
      .classList.toggle("landscape", landscape);
    if (fitWholeCourt) {
      zoom = minimumZoom();
      applyZoom();
    }
    $("arrows").setAttribute(
      "viewBox",
      landscape ? "0 0 191.111111 100" : "0 0 100 191.111111",
    );
    $("portrait").setAttribute("aria-pressed", !landscape);
    $("landscape").setAttribute("aria-pressed", landscape);
    render();
    showHomeCourt();
    announce(
      landscape
        ? "横向き：左が味方、右が相手コートです。"
        : "縦向き：下が味方、上が相手コートです。",
    );
  }
  ["portrait", "landscape"].forEach(
    (id) => ($(id).onclick = () => setOrientation(id)),
  );
  window.addEventListener("resize", () => {
    lastCourtTap = null;
    zoom = Math.max(minimumZoom(), zoom);
    applyZoom();
    updatePieceSize();
    if (!gestures.size) render();
    else drawAim();
  });
  // 駒を動かす指は除外し、コート操作の重心と半径でパン・ピンチを計算する。
  function touchGeometry() {
    const touches = [...gestures.values()].filter((g) => g.scrolling);
    if (touches.length < 2) return null;
    const x = touches.reduce((sum, g) => sum + g.clientX, 0) / touches.length;
    const y = touches.reduce((sum, g) => sum + g.clientY, 0) / touches.length;
    const radius = Math.sqrt(
      touches.reduce(
        (sum, g) => sum + (g.clientX - x) ** 2 + (g.clientY - y) ** 2,
        0,
      ) / touches.length,
    );
    return { x, y, radius };
  }
  function resetPinch() {
    const geometry = touchGeometry();
    const rect = $("court").getBoundingClientRect();
    pinch = geometry
      ? {
          ...geometry,
          zoom,
          u: (geometry.x - rect.left) / rect.width,
          v: (geometry.y - rect.top) / rect.height,
        }
      : null;
  }
  // 矢印があれば即時描画、なければ長押し待機／パンへ操作を分岐する。
  function startCourtGesture(event) {
    if (gestures.has(event.pointerId) || event.button !== 0) return;
    const target = event.target.closest(".piece");
    event.preventDefault();
    const start = point(event),
      piece = target
        ? state.pieces.find((p) => p.id === target.dataset.id)
        : null;
    if (piece && [...gestures.values()].some((g) => g.piece === piece)) return;
    if (!gestures.size) gestureBefore = copy(state);
    const original = piece ? copy(piece) : null;
    if (piece && piece.team !== "ball") beginManualPosition(piece, target);
    gestures.set(event.pointerId, {
      pointer: event.pointerId,
      tapStarted: Date.now(),
      tapX: event.clientX,
      tapY: event.clientY,
      tapMoved: false,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      scrolling: false,
      start,
      original,
      autoBefore: piece?.team === "ball" && autoEnabled ? copy(state.pieces) : null,
      autoMoved: new Set(),
      piece,
      target,
      temporary: $("line-lifetime").value === "temporary",
      offset: piece ? { x: piece.x - start.x, y: piece.y - start.y } : null,
    });
    const pending = gestures.get(event.pointerId);
    if (!piece && hasVisibleArrows()) {
      pending.drawing = true;
      pending.tapMoved = true;
      lastCourtTap = null;
      updateArrowExpiryPause();
    } else if (!piece) {
      pending.holdTimer = setTimeout(() => {
        if (pending.scrolling || pending.panning) return;
        pending.drawing = true;
        updateArrowExpiryPause();
        pending.tapMoved = true;
        lastCourtTap = null;
      }, TIMING.arrowHold);
    }
    const touches = [...gestures.values()].filter(
      (g) => !g.piece && g.pointerType === "touch",
    );
    if (touches.length >= 2 || touches.some((g) => g.scrolling)) {
      touches.forEach((g) => {
        clearTimeout(g.holdTimer);
        g.scrolling = true;
        delete g.end;
      });
      updateArrowExpiryPause();
      drawArrows();
      resetPinch();
    }
    if (piece || gestures.size > 1) {
      lastCourtTap = null;
      gestures.forEach((g) => (g.tapMoved = true));
    }
    if (target) {
      target.focus({ preventScroll: true });
      target.classList.add("dragging");
    }
    $("court").setPointerCapture(event.pointerId);
    drawAim();
  }
  function moveCourtGesture(event) {
    const gesture = gestures.get(event.pointerId);
    if (!gesture) return;
    const dx = event.clientX - gesture.clientX,
      dy = event.clientY - gesture.clientY;
    if (
      Math.hypot(event.clientX - gesture.tapX, event.clientY - gesture.tapY) >
      (gesture.pointerType === "touch" ? LIMITS.touchSlop : LIMITS.mouseSlop)
    )
      gesture.tapMoved = true;
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    if (gesture.scrolling) {
      const geometry = touchGeometry();
      if (geometry && pinch) {
        zoom = Math.max(
          minimumZoom(),
          Math.min(
            LIMITS.zoom,
            (pinch.zoom * geometry.radius) / Math.max(1, pinch.radius),
          ),
        );
        applyZoom();
        const viewport = document.querySelector(".court-scroll");
        const rect = $("court").getBoundingClientRect();
        viewport.scrollLeft += rect.left + pinch.u * rect.width - geometry.x;
        viewport.scrollTop += rect.top + pinch.v * rect.height - geometry.y;
        updatePieceSize();
        drawAim();
      } else {
        panCourt(dx, dy);
      }
      return;
    }
    const p = point(event);
    if (gesture.piece) {
      const beforeX = gesture.piece.x, beforeY = gesture.piece.y;
      gesture.piece.x = p.x + gesture.offset.x;
      gesture.piece.y = p.y + gesture.offset.y;
      if (gesture.piece.team === "ball") constrainPiece(gesture.piece);
      if (gesture.piece.team === "ball" &&
        (beforeX !== gesture.piece.x || beforeY !== gesture.piece.y)) runAutoPosition();
      placePiece(gesture.target, gesture.piece);
      drawAim();
    } else if (gesture.drawing) {
      gesture.end = p;
      drawArrows();
    } else if (gesture.tapMoved) {
      clearTimeout(gesture.holdTimer);
      panCourt(
        gesture.panning ? dx : event.clientX - gesture.tapX,
        gesture.panning ? dy : event.clientY - gesture.tapY,
      );
      gesture.panning = true;
    }
  }
  // 中断はその指の移動だけを戻す。最後の指を離した時点で履歴を確定する。
  function finishCourtGesture(event, cancel = false) {
    const g = gestures.get(event.pointerId);
    if (!g) return;
    clearTimeout(g.holdTimer);
    const isTap =
      !cancel &&
      !g.piece &&
      !g.scrolling &&
      !g.tapMoved &&
      !g.end &&
      Date.now() - g.tapStarted < TIMING.arrowHold;
    const doubleTap =
      isTap &&
      lastCourtTap &&
      g.tapStarted - lastCourtTap.time < TIMING.doubleTap &&
      Math.hypot(
        event.clientX - lastCourtTap.x,
        event.clientY - lastCourtTap.y,
      ) < LIMITS.doubleTapDistance;
    lastCourtTap =
      isTap && !doubleTap
        ? { time: Date.now(), x: event.clientX, y: event.clientY }
        : null;
    const snapFrom =
      !cancel && g.piece && g.piece.team !== "ball"
        ? screenPoint({ ...g.piece })
        : null;
    if (snapFrom) {
      snapPlayerToGrid(g.piece);
      placePiece(g.target, g.piece);
    }
    gestures.delete(event.pointerId);
    if (g.scrolling) resetPinch();
    if (g.piece?.team === "ball") {
      if (cancel) {
        clearTimeout(aimTimer);
        aimVisibleUntil = 0;
      } else keepAimBriefly();
    }
    if (cancel) {
      if (g.autoBefore) {
        stopAutoAnimations();
        state.pieces.forEach((p) => {
          if (g.autoMoved.has(p.id)) {
            Object.assign(p, g.autoBefore.find((q) => q.id === p.id));
          }
          placePiece(document.querySelector(`[data-id="${p.id}"]`), p);
        });
      }
      if (g.piece) {
        Object.assign(g.piece, g.original);
        placePiece(g.target, g.piece);
      }
    } else {
      if (
        !g.piece &&
        !g.scrolling &&
        g.end &&
        Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) > 2
      ) {
        const arrow = {
          x1: g.start.x,
          y1: g.start.y,
          x2: g.end.x,
          y2: g.end.y,
        };
        if (g.temporary) {
          const expiresAt = Date.now() + TIMING.arrowLifetime;
          temporaryArrows.forEach((a) => {
            a.expiresAt = expiresAt;
          });
          temporaryArrows.push({ ...arrow, expiresAt });
          scheduleExpiry();
        } else state.arrows.push(arrow);
      }
    }
    if (g.piece && g.piece.team !== "ball") {
      for (const other of gestures.values()) {
        const baseline = other.autoBefore?.find((p) => p.id === g.piece.id);
        if (baseline) Object.assign(baseline, g.piece);
      }
    }
    if (autoEnabled && g.piece && g.piece.team !== "ball" &&
      ![...gestures.values()].some((other) => other.piece?.team === g.piece.team)) {
      const selected = BoardModel.selectAutoAnchors(state.pieces, autoAnchors);
      autoAnchors[g.piece.team] = selected[g.piece.team];
      updateAutoUI();
    }
    updateArrowExpiryPause();
    g.target?.classList.remove("dragging");
    if ($("court").hasPointerCapture(event.pointerId))
      $("court").releasePointerCapture(event.pointerId);
    if (!gestures.size) {
      if (JSON.stringify(state) !== JSON.stringify(gestureBefore))
        remember(gestureBefore);
      gestureBefore = null;
      render();
    } else {
      drawArrows();
      drawAim();
    }
    if (snapFrom) {
      const target = document.querySelector('[data-id="' + g.piece.id + '"]');
      const destination = screenPoint(g.piece);
      target.animate(
        [
          { left: snapFrom.x + "%", top: snapFrom.y + "%" },
          { left: destination.x + "%", top: destination.y + "%" },
        ],
        { duration: 240, easing: "ease-out" },
      );
    }
    if (doubleTap && !gestures.size) toggleCourtFit();
  }
  $("court").addEventListener("pointerdown", startCourtGesture);
  $("court").addEventListener("pointermove", moveCourtGesture);
  $("court").addEventListener("pointerup", (event) =>
    finishCourtGesture(event),
  );
  $("court").addEventListener("pointercancel", (event) =>
    finishCourtGesture(event, true),
  );
  $("court").addEventListener("lostpointercapture", (event) =>
    finishCourtGesture(event, true),
  );
  function change(fn, message) {
    if (gestures.size) return;
    const before = copy(state);
    fn();
    if (JSON.stringify(before) !== JSON.stringify(state)) remember(before);
    render();
    announce(message);
  }
  $("clear").onclick = () =>
    change(() => {
      state.arrows = [];
      temporaryArrows = [];
      scheduleExpiry();
    }, "線を消しました。");
  $("reset").onclick = () => {
    try {
      const initial =
        recalledSlotIndex === null
          ? createInitialState()
          : readSlots()[recalledSlotIndex];
      change(() => {
        setAuto("off");
        state = copy(initial);
        state.arrows = [];
        temporaryArrows = [];
        scheduleExpiry();
      }, "初期位置に戻しました。元に戻すこともできます。");
    } catch {
      announce("保存した配置を読み込めませんでした。");
    }
  };
  function travel(from, to, message) {
    if (!from.length || gestures.size) return;
    to.push(copy(state));
    stopAutoAnimations();
    state = from.pop();
    autoAnchors = BoardModel.selectAutoAnchors(state.pieces, autoAnchors);
    render();
    announce(message);
  }
  $("undo").onclick = () => travel(undo, redo, "ひとつ前の状態に戻しました。");
  $("redo").onclick = () => travel(redo, undo, "操作をやり直しました。");
  const slotButtons = [...document.querySelectorAll(".position-slot")];
  const slotLabel = (i) => ["①", "②", "③", "④", "⑤"][i];
  // 新形式がない場合だけ旧1枠形式を読む。保存データを検証してから使用する。
  function readSlots() {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (raw !== null) {
      const slots = JSON.parse(raw);
      if (
        !Array.isArray(slots) ||
        slots.length !== 5 ||
        !slots.every((s) => s === null || isValidState(s))
      )
        throw new Error("invalid slots");
      return slots.map((slot, i) => slot || createDefaultSlots()[i]);
    }
    const legacy = JSON.parse(localStorage.getItem(KEY) || "null");
    const slots = createDefaultSlots();
    if (isValidState(legacy)) slots[0] = legacy;
    return slots;
  }
  function updateSlots() {
    try {
      const slots = readSlots();
      slotButtons.forEach((button, i) => {
        button.classList.toggle("saved", !!slots[i]);
        button.setAttribute(
          "aria-label",
          "配置" +
            (i + 1) +
            (slots[i]
              ? "：登録済み。クリックで呼び出し、長押しで上書き"
              : "：未登録。長押しで登録"),
        );
      });
    } catch {
      announce("保存した配置を読み込めませんでした。");
    }
  }
  $("reset-slots").onclick = () => {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(createDefaultSlots()));
      updateSlots();
      announce("配置と作戦の初期値に戻しました。");
    } catch {
      announce("保存できませんでした。ブラウザの保存設定を確認してください。");
    }
  };
  function saveSlot(i) {
    if (gestures.size) return;
    try {
      const slots = readSlots();
      slots[i] = { opponents: true, pieces: copy(state.pieces), arrows: [] };
      localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
      updateSlots();
      announce("配置" + slotLabel(i) + "を保存しました。");
    } catch {
      announce("保存できませんでした。ブラウザの保存設定を確認してください。");
    }
  }
  function loadSlot(i) {
    try {
      const saved = readSlots()[i];
      if (!saved) {
        announce(
          "配置" +
            slotLabel(i) +
            "はまだありません。長押しで登録してください。",
        );
        return;
      }
      change(
        () => {
          setAuto("off");
          state.pieces = copy(saved.pieces);
          recalledSlotIndex = i;
        },
        "保存した配置を開きました：" + slotLabel(i),
      );
    } catch {
      announce("保存した配置を読み込めませんでした。");
    }
  }
  // 配置枠の長押しは、移動・中断・フォーカス喪失時に必ず解除する。
  slotButtons.forEach((button, i) => {
    let press = null,
      timer,
      suppressClick = false;
    const cancel = () => {
      clearTimeout(timer);
      button.classList.remove("holding");
      press = null;
    };
    const begin = (input) => {
      cancel();
      suppressClick = false;
      press = input;
      button.classList.add("holding");
      timer = setTimeout(() => {
        suppressClick = true;
        button.classList.remove("holding");
        saveSlot(i);
      }, TIMING.slotHold);
    };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || press) return;
      begin({ id: event.pointerId, x: event.clientX, y: event.clientY });
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointermove", (event) => {
      if (
        press?.id === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
      ) {
        cancel();
        suppressClick = true;
      }
    });
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointercancel", () => {
      cancel();
      suppressClick = true;
    });
    button.addEventListener("lostpointercapture", cancel);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("keydown", (event) => {
      if (![" ", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) begin({ key: event.key });
    });
    button.addEventListener("keyup", (event) => {
      if (press?.key !== event.key) return;
      event.preventDefault();
      cancel();
      if (!suppressClick) loadSlot(i);
    });
    button.addEventListener("click", (event) => {
      if (suppressClick) {
        event.preventDefault();
        return;
      }
      loadSlot(i);
    });
    button.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancel();
    });
  });
  window.addEventListener("storage", (event) => {
    if (event.key === SLOTS_KEY || event.key === null) updateSlots();
  });
  updateSlots();
  document.addEventListener("keydown", (event) => {
    if ($("help-dialog").open) return;
    if (event.target.matches("input,textarea,select") || gestures.size) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      $(event.shiftKey ? "redo" : "undo").click();
      return;
    }
    const target = event.target.closest(".piece");
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!target || !delta) return;
    event.preventDefault();
    const id = target.dataset.id;
    const [dx, dy] = landscape ? [delta[1], -delta[0]] : delta;
    change(() => {
      const p = state.pieces.find((p) => p.id === id);
      if (p.team === "ball") {
        const beforeX = p.x, beforeY = p.y;
        p.x += dx;
        p.y += dy;
        constrainPiece(p);
        if (p.x !== beforeX || p.y !== beforeY) runAutoPosition();
        keepAimBriefly();
      } else {
        const wasAnimating = autoAnimations.has(p.id);
        beginManualPosition(p, target);
        if (wasAnimating) snapPlayerToGrid(p);
        movePlayerOnGrid(p, dx, dy);
        if (autoEnabled) autoAnchors = BoardModel.selectAutoAnchors(state.pieces, autoAnchors);
      }
    }, "位置を調整しました。");
    document.querySelector(`[data-id="${id}"]`).focus({ preventScroll: true });
  });
  // 起動時のみ全体表示。利用者が向きを選び直した時は100%に戻す。
  setOrientation(
    window.innerWidth > window.innerHeight ? "landscape" : "portrait",
    true,
  );
})();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("Offline setup failed:", error));
  });
}

// DOMや保存先に依存しない計算と配置データ。ブラウザとNode.jsで共用する。
const BoardModel = (() => {
  "use strict";
  const PLAYER_GRID = Object.freeze({
    xOrigin: 7,
    yOrigin: 5,
    xStep: 86 / 36,
    yStep: 90 / 72,
  });
  // 直径（m）。前衛4〜6番・後衛1〜3番で描画と接触判定を共用する。
  const pieceDiameter = (p) =>
    p.team === "ball" ? 0.5 : p.number >= 4 ? 0.75 : 1;
  const gridX = (column) => PLAYER_GRID.xOrigin + column * PLAYER_GRID.xStep;
  const gridY = (row) => PLAYER_GRID.yOrigin + row * PLAYER_GRID.yStep;
  // 縦向きの等方座標でレイと選手の円の交点を求め、向きによる歪みを防ぐ。
  function aimPolygon(ball, defenders, bounds, attackY, goalY) {
    const direction = Math.sign(goalY - ball.y);
    const first = Math.atan2(bounds.left - ball.x, Math.abs(attackY - ball.y));
    const last = Math.atan2(bounds.right - ball.x, Math.abs(attackY - ball.y));
    const points = [ball];
    for (let i = 0; i <= 720; i++) {
      const angle = first + ((last - first) * i) / 720;
      const dx = Math.sin(angle),
        dy = direction * Math.cos(angle);
      let distance = (goalY - ball.y) / dy;
      if (dx > 1e-9)
        distance = Math.min(distance, (bounds.right - ball.x) / dx);
      if (dx < -1e-9)
        distance = Math.min(distance, (bounds.left - ball.x) / dx);
      for (const player of defenders) {
        const x = player.x - ball.x,
          y = player.y - ball.y;
        const dot = x * dx + y * dy;
        const discriminant = player.radius ** 2 - (x * x + y * y - dot * dot);
        if (x * x + y * y <= player.radius ** 2) {
          distance = 0;
          break;
        }
        if (discriminant < 0) continue;
        const near = dot - Math.sqrt(discriminant);
        if (near >= 0) distance = Math.min(distance, near);
      }
      points.push({
        x: ball.x + dx * Math.max(0, distance),
        y: ball.y + dy * Math.max(0, distance),
      });
    }
    return points;
  }

  // 配置は必ず新しいオブジェクトで返し、履歴や保存枠との参照共有を避ける。
  const createInitialState = () => ({
    opponents: true,
    pieces: [
      ...[
        [gridX(27), gridY(61)],
        [gridX(18), gridY(61)],
        [gridX(9), gridY(61)],
        [gridX(27), gridY(41)],
        [gridX(18), gridY(41)],
        [gridX(9), gridY(41)],
      ].map(([x, y], i) => ({
        id: `home-${i + 1}`,
        team: "home",
        number: i + 1,
        x,
        y,
      })),
      ...[
        [gridX(9), gridY(11)],
        [gridX(18), gridY(11)],
        [gridX(27), gridY(11)],
        [gridX(9), gridY(31)],
        [gridX(18), gridY(31)],
        [gridX(27), gridY(31)],
      ].map(([x, y], i) => ({
        id: `away-${i + 1}`,
        team: "opponent",
        number: i + 1,
        x,
        y,
      })),
      { id: "ball", team: "ball", number: 0, x: 50, y: 73 },
    ],
    arrows: [],
  });
  // 旧版の保存形式（opponents / pieces / arrows）を維持する。
  function isValidState(s) {
    const defaults = createInitialState();
    return (
      s &&
      typeof s.opponents === "boolean" &&
      Array.isArray(s.pieces) &&
      s.pieces.length === 13 &&
      defaults.pieces.every(
        (p) =>
          s.pieces.filter(
            (q) =>
              q &&
              q.id === p.id &&
              q.team === p.team &&
              q.number === p.number &&
              Number.isFinite(q.x) &&
              q.x >= 7 &&
              q.x <= 93 &&
              Number.isFinite(q.y) &&
              q.y >= 5 &&
              q.y <= 95,
          ).length === 1,
      ) &&
      Array.isArray(s.arrows) &&
      s.arrows.length <= 10000 &&
      s.arrows.every(
        (a) =>
          a &&
          ["x1", "x2", "y1", "y2"].every(
            (k) => Number.isFinite(a[k]) && a[k] >= 0 && a[k] <= 100,
          ),
      )
    );
  }

  // 相手側はネットを中心に180度回転し、左右反転枠は別に生成する。
  function createDefaultSlots() {
    const formation = (second, mirror) => {
      const saved = createInitialState();
      const home = second
        ? [
            [gridX(32), gridY(52)],
            [gridX(22), gridY(52)],
            [gridX(11), gridY(52)],
            [gridX(27), gridY(45)],
            [gridX(16), gridY(45)],
            [gridX(5), gridY(45)],
          ]
        : [
            [gridX(29), gridY(52)],
            [gridX(22), gridY(52)],
            [gridX(11), gridY(52)],
            [gridX(32), gridY(45)],
            [gridX(16), gridY(45)],
            [gridX(5), gridY(45)],
          ];
      saved.pieces.forEach((p) => {
        const [x, y] =
          p.team === "ball" ? [second ? 60.7 : 65.1, 54.6] : home[p.number - 1];
        p.x = mirror ? 100 - x : x;
        p.y = y;
        // 両チームが自陣から見て同じ並びになるよう回転する。
        if (p.team === "opponent") {
          p.x = 100 - p.x;
          p.y = 100 - p.y;
        }
      });
      return saved;
    };
    return [
      createInitialState(),
      formation(false, false),
      formation(false, true),
      formation(true, false),
      formation(true, true),
    ];
  }

  return {
    PLAYER_GRID,
    pieceDiameter,
    aimPolygon,
    createInitialState,
    isValidState,
    createDefaultSlots,
  };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = BoardModel;

// DOMや保存先に依存しない計算と配置データ。ブラウザとNode.jsで共用する。
const BoardModel = (() => {
  "use strict";
  const PLAYER_GRID = Object.freeze({
    xOrigin: 7,
    yOrigin: 5,
    xStep: 86 / 20,
    yStep: 90 / 40,
  });
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
        [gridX(15), gridY(34)],
        [gridX(10), gridY(34)],
        [gridX(5), gridY(34)],
        [gridX(15), gridY(23)],
        [gridX(10), gridY(23)],
        [gridX(5), gridY(23)],
      ].map(([x, y], i) => ({
        id: `home-${i + 1}`,
        team: "home",
        number: i + 1,
        x,
        y,
      })),
      ...[
        [gridX(5), gridY(6)],
        [gridX(10), gridY(6)],
        [gridX(15), gridY(6)],
        [gridX(5), gridY(17)],
        [gridX(10), gridY(17)],
        [gridX(15), gridY(17)],
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
            [gridX(18), gridY(29)],
            [gridX(12), gridY(29)],
            [gridX(6), gridY(29)],
            [gridX(15), gridY(25)],
            [gridX(9), gridY(25)],
            [gridX(3), gridY(25)],
          ]
        : [
            [gridX(16), gridY(29)],
            [gridX(12), gridY(29)],
            [gridX(6), gridY(29)],
            [gridX(18), gridY(25)],
            [gridX(9), gridY(25)],
            [gridX(3), gridY(25)],
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
    aimPolygon,
    createInitialState,
    isValidState,
    createDefaultSlots,
  };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = BoardModel;

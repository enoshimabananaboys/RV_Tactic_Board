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
  function pieceDiameter(p, ball = null, adaptive = false) {
    if (p.team === "ball") return 0.5;
    const minimum = p.number >= 4 ? 0.75 : 1;
    if (!adaptive || !ball) return minimum;
    const distance = Math.hypot((p.x - ball.x) * 9 / 86, (p.y - ball.y) / 5);
    if (distance >= 5 - 1e-10) return 1.25;
    return distance >= 3 - 1e-10 ? 1 : minimum;
  }
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

  // 固定メンバーは中心とサイドラインの距離で選ぶ。同距離は現メンバーを優先。
  function selectAutoAnchors(pieces, previous = {}) {
    return Object.fromEntries(["home", "opponent"].map((team) => {
      const players = pieces.filter((p) => p.team === team);
      const preferred = previous[team] || [];
      const tie = (a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)) ||
        Number(b.number >= 4) - Number(a.number >= 4) || a.number - b.number;
      const rightTie = (a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)) ||
        Number(b.number >= 4) - Number(a.number >= 4) || b.number - a.number;
      const left = [...players].sort((a, b) => a.x - b.x || tie(a, b))[0];
      const right = players.filter((p) => p !== left).sort((a, b) => b.x - a.x || rightTie(a, b))[0];
      return [team, [left.id, right.id]];
    }));
  }

  // 実寸mで円の接線が覆う角度を合成する。前後の守備範囲の重複も除く。
  function autoGapScore(ball, players, team, adaptive = true, intervalCache = null) {
    const bx = (ball.x - 7) * 9 / 86, by = (ball.y - 5) / 5;
    const attack = team === "opponent" ? 6 : 12;
    const depth = Math.abs(attack - by);
    const first = Math.atan2(-bx, depth), last = Math.atan2(9 - bx, depth);
    const intervals = players.map((p) => {
      if (intervalCache?.has(p)) return intervalCache.get(p);
      const x = (p.x - 7) * 9 / 86 - bx, y = Math.abs((p.y - 5) / 5 - by);
      const angle = Math.atan2(x, y);
      const half = Math.asin(Math.min(1, pieceDiameter(p, ball, adaptive) / 2 / Math.hypot(x, y)));
      const interval = [Math.max(first, angle - half), Math.min(last, angle + half)];
      intervalCache?.set(p, interval);
      return interval;
    }).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let end = first;
    for (const [a, b] of intervals) {
      if (a > end) gaps.push(a - end);
      end = Math.max(end, b);
    }
    if (end < last) gaps.push(last - end);
    return [Math.max(0, ...gaps), gaps.reduce((s, g) => s + g, 0), gaps.reduce((s, g) => s + g * g, 0)];
  }

  // 隙間の合計が最適候補より10%以内なら、横移動を発生させない。
  // 最適値が0の場合は、現在の隙間も実質0のときだけ維持する。
  function shouldKeepAutoPosition(currentGap, bestGap) {
    return currentGap <= bestGap * 1.1 + 1e-12;
  }

  // 25cm候補を幅制限探索する。全組合せを毎フレーム調べず、良い候補を96件残す。
  // 固定した2人が極端に近い等、制約を満たせない配置では移動を見送る。
  function autoPosition(pieces, anchors, mode = "on") {
    const ball = pieces.find((p) => p.team === "ball");
    const team = ball.y >= 50 ? "opponent" : "home";
    const defenders = pieces.filter((p) => p.team === team);
    const fixedIds = mode === "full" ? [] : anchors[team];
    // FULLでは前後衛を問わず左右端の2人を交点担当にする。ボールから
    // アタックライン端へ向かう直線に、円がコート中央側から接する位置を優先する。
    const edgeIds = mode === "full" ? anchors[team] : [];
    const edgeCandidate = (p, side) => [...new Set([pieceDiameter(p), 1, 1.25])]
      .map((diameter) => {
        const radius = diameter / 2;
        const bx = (ball.x - 7) * 9 / 86;
        const by = (ball.y - 5) / 5;
        const attack = team === "opponent" ? 6 : 12;
        const cornerX = side === "left" ? 0 : 9;
        const dx = cornerX - bx, dy = attack - by;
        const py = attack +
          (team === "opponent" ? 1 : -1) * (p.number >= 4 ? 1 : -1) * radius;
        const signedDistance = (side === "left" ? -1 : 1) * Math.sign(dy) * radius;
        const tangentX = bx +
          (dx * (py - by) - signedDistance * Math.hypot(dx, dy)) / dy;
        // 後衛側では接点が交点の奥になるため、接線位置がコート外へ出る場合がある。
        // その場合も円全体はコート内に残し、交点方向を確実に覆う。
        const x = Math.max(radius, Math.min(9 - radius, tangentX));
        return { ...p, x: 7 + x * 86 / 9, y: 5 + py * 5 };
      })
      .find((candidate) => Math.abs(pieceDiameter(candidate, ball, true) -
        Math.abs(candidate.y - (team === "opponent" ? 35 : 65)) / 5 * 2) < 1e-8);
    const fixed = mode === "full"
      ? edgeIds.map((id, index) => edgeCandidate(
        defenders.find((p) => p.id === id), index ? "right" : "left",
      )).filter(Boolean)
      : defenders.filter((p) => fixedIds.includes(p.id));
    if (mode === "full" && fixed.length !== 2) return [];
    const movingIds = new Set([...fixedIds, ...edgeIds]);
    const moving = defenders.filter((p) => !movingIds.has(p.id)).sort((a, b) => Number(a.number >= 4) - Number(b.number >= 4) || a.x - b.x || a.number - b.number);
    const left = fixed.length ? Math.min(...fixed.map((p) => p.x)) : 7;
    const right = fixed.length ? Math.max(...fixed.map((p) => p.x)) : 93;
    const originals = new Map(defenders.map((p) => [p.id, p]));
    // 距離と直径は候補位置で評価する。閾値付近の円径・接触位置の循環を避け、
    // 実際の直径とアタックライン接触が一致する候補だけを採用する。
    const candidates = moving.map((p) => Array.from({ length: 37 }, (_, i) =>
      [...new Set([pieceDiameter(p), 1, 1.25])].map((diameter) => ({
        ...p, x: gridX(i),
        y: (team === "opponent" ? 35 : 65) +
          (team === "opponent" ? 1 : -1) * (p.number >= 4 ? 1 : -1) * diameter / 2 * 5,
      })).filter((candidate) => {
        const actual = pieceDiameter(candidate, ball, true);
        return Math.abs(Math.abs(candidate.y - (team === "opponent" ? 35 : 65)) / 5 - actual / 2) < 1e-8;
      }),
    ).flat().filter((p) => p.x >= left - 1e-9 && p.x <= right + 1e-9));
    // 候補同士の接触判定は探索中に何度も使うため、先に表にする。
    const all = [...fixed, ...candidates.flat()];
    const indexes = new Map(all.map((p, i) => [p, i]));
    const radii = all.map((p) => pieceDiameter(p, ball, true) / 2);
    const allowed = all.map(() => new Uint8Array(all.length));
    for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) {
      const p = all[i], q = all[j];
      const dx = (p.x - q.x) * 9 / 86, dy = (p.y - q.y) / 5;
      if (dx * dx + dy * dy + 1e-8 < (radii[i] + radii[j]) ** 2) continue;
      const a = originals.get(p.id), b = originals.get(q.id);
      if ((p.number >= 4) === (q.number >= 4) &&
        (a.x - b.x || a.number - b.number) * (p.x - q.x) < 0) continue;
      allowed[i][j] = allowed[j][i] = 1;
    }
    const compatible = (p, others) => {
      const row = allowed[indexes.get(p)];
      return others.every((q) => row[indexes.get(q)]);
    };
    const intervalCache = new Map();
    const score = (players) => [...autoGapScore(ball, players, team, true, intervalCache), players.reduce((sum, p) => sum + Math.abs(p.x - originals.get(p.id).x), 0)];
    const compare = (a, b, count = 4) => {
      for (let i = 0; i < count; i++) {
        // 数ミリ相当の角度差では配置を入れ替えず、移動量の少なさを優先する。
        const difference = Math.round(a.score[i] * 1000) - Math.round(b.score[i] * 1000);
        if (difference) return difference;
      }
      return 0;
    };
    let beam = [{ players: fixed, score: score(fixed) }];
    for (let index = 0; index < candidates.length; index++) {
      const choices = candidates[index];
      const next = [];
      for (const entry of beam) for (const p of choices) {
        if (!compatible(p, entry.players)) continue;
        const players = [...entry.players, p];
        // 後続の選手が置けなくなる候補は枝刈り前に除外する。
        if (candidates.slice(index + 1).some((remaining) =>
          !remaining.some((q) => compatible(q, players)))) continue;
        next.push({ players, score: score(players) });
      }
      beam = next.sort((a, b) => compare(a, b, 3)).slice(0, 96);
      if (!beam.length) return [];
    }
    // 現配置の左右位置も候補に残し、探索の枝刈りによる不要な往復を防ぐ。
    const current = [...fixed];
    for (let i = 0; i < moving.length; i++) {
      const p = candidates[i].find((p) => Math.abs(p.x - moving[i].x) < 1e-8 && Math.abs(p.y - moving[i].y) < 1e-8) || candidates[i].find((p) => Math.abs(p.x - moving[i].x) < 1e-8);
      if (!p || !compatible(p, current)) break;
      current.push(p);
    }
    const retained = current.length === 6
      ? { players: current, score: score(current) }
      : null;
    if (retained) beam.push(retained);
    const best = beam.sort(compare)[0];
    // 前後は新しい円径に合うライン接触位置へ更新するが、左右は全員分を維持。
    const selected = retained && shouldKeepAutoPosition(retained.score[1], best.score[1])
      ? retained
      : best;
    return selected.players.filter((p) => !fixedIds.includes(p.id));
  }

  return {
    shouldKeepAutoPosition,
    selectAutoAnchors,
    autoPosition,
    autoGapScore,
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

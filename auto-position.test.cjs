const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("./board-model.js");

test("anchors choose two distinct extremes and retain ties", () => {
  const s = m.createInitialState();
  const anchors = m.selectAutoAnchors(s.pieces);
  assert.deepEqual(anchors.opponent, ["away-4", "away-6"]);
  const p = s.pieces.find(p => p.id === "away-4");
  p.x = 50;
  assert.deepEqual(m.selectAutoAnchors(s.pieces, anchors).opponent, ["away-1", "away-6"]);
  p.x = s.pieces.find(p => p.id === "away-1").x;
  assert.equal(m.selectAutoAnchors(s.pieces, {opponent: ["away-1", "away-6"]}).opponent[0], "away-1");
  s.pieces.forEach(p => p.x = 50);
  assert.equal(new Set(m.selectAutoAnchors(s.pieces).home).size, 2);
});

test("auto placement respects fixed players, grid, attack line, order and non-overlap", () => {
  for (const mode of ["on", "full"]) for (const slot of m.createDefaultSlots()) for (const y of [5, 49.9, 50, 95]) for (const x of [7, 50, 93]) {
    const pieces = structuredClone(slot.pieces);
    Object.assign(pieces.find(p => p.team === "ball"), {x, y});
    const before = structuredClone(pieces);
    const anchors = m.selectAutoAnchors(pieces);
    const result = m.autoPosition(pieces, anchors, mode);
    assert.deepEqual(pieces, before, "solver must not mutate input");
    assert.equal(result.length, mode === "full" ? 6 : 4);
    const team = y >= 50 ? "opponent" : "home";
    const ball = pieces.find(p => p.team === "ball");
    const fixed = mode === "full" ? [] : pieces.filter(p => anchors[team].includes(p.id));
    for (const p of result) {
      assert.equal(p.team, team);
      if (mode === "on") assert.ok(!anchors[team].includes(p.id));
      const col = (p.x - 7) / m.PLAYER_GRID.xStep;
      assert.ok(Math.abs(col - Math.round(col)) < 1e-8);
      assert.ok(Math.abs(Math.abs(p.y - (team === "opponent" ? 35 : 65)) / 5 - m.pieceDiameter(p, ball, true) / 2) < 1e-8);
      assert.ok(p.x >= (fixed.length ? Math.min(...fixed.map(q => q.x)) : 7) - 1e-8 && p.x <= (fixed.length ? Math.max(...fixed.map(q => q.x)) : 93) + 1e-8);
    }
    const all = [...fixed, ...result];
    for (const p of result) for (const q of all) {
      if (p.id === q.id) continue;
      assert.ok(Math.hypot((p.x-q.x)*9/86, (p.y-q.y)/5) + 1e-8 >= (m.pieceDiameter(p,ball,true)+m.pieceDiameter(q,ball,true))/2);
      if ((p.number >= 4) === (q.number >= 4)) {
        const oldP = pieces.find(r => r.id === p.id), oldQ = pieces.find(r => r.id === q.id);
        assert.ok((oldP.x-oldQ.x || oldP.number-oldQ.number)*(p.x-q.x) >= 0);
      }
    }
    const stablePieces = pieces.map(p => result.find(q => q.id === p.id) || p);
    assert.deepEqual(m.autoPosition(stablePieces, anchors, mode), result, "same ball position stays stable");
  }
});

test("auto placement reduces open lanes without widening the largest gap in basic formation", () => {
  const {pieces} = m.createInitialState();
  const ball = pieces.find(p => p.team === "ball");
  const anchors = m.selectAutoAnchors(pieces);
  const result = m.autoPosition(pieces, anchors);
  const before = m.autoGapScore(ball, pieces.filter(p => p.team === "opponent"), "opponent");
  const after = m.autoGapScore(ball, [...pieces.filter(p => anchors.opponent.includes(p.id)), ...result], "opponent");
  assert.ok(after[0] <= before[0] + 1e-8);
  assert.ok(after[1] < before[1]);
});

test("impossible crowded anchors leave the formation unchanged", () => {
  const {pieces} = m.createInitialState();
  pieces.filter(p => p.team === "opponent").forEach(p => p.x = 50);
  assert.deepEqual(m.autoPosition(pieces, m.selectAutoAnchors(pieces)), []);
});


test("adaptive diameters use center distance, inclusive thresholds, and role minima", () => {
  const ball = {team:"ball",x:50,y:50};
  for (const number of [1,4]) for (const distance of [0,2.999999,3,3.000001,4.999999,5,5.000001,8]) {
    const p = {team:"home",number,x:50,y:50+distance*5};
    const minimum = number >= 4 ? 0.75 : 1;
    assert.equal(m.pieceDiameter(p,ball,false),minimum);
    assert.equal(m.pieceDiameter(p,ball,true),distance>=5 ? 1.25 : distance>=3 ? 1 : minimum);
    const horizontal = {...p,x:50+distance*86/9,y:50};
    assert.equal(m.pieceDiameter(horizontal,ball,true),m.pieceDiameter(p,ball,true));
  }
  assert.equal(m.pieceDiameter({...ball,x:90},ball,true),0.5);
  const diagonal = {team:"opponent",number:4,x:50+3*86/9,y:70};
  assert.equal(m.pieceDiameter(diagonal,ball,true),1.25, "3-4-5 diagonal distance");
});

test("FULL moves all six even when original anchors are crowded", () => {
  const {pieces} = m.createInitialState();
  pieces.filter(p=>p.team === "opponent").forEach(p=>p.x=50);
  const result = m.autoPosition(pieces,m.selectAutoAnchors(pieces),"full");
  assert.equal(result.length,6);
  assert.equal(new Set(result.map(p=>p.id)).size,6);
});


test("position retention includes exactly 10 percent but rejects larger losses and open lanes against zero", () => {
  assert.equal(m.shouldKeepAutoPosition(0.109999, 0.1), true);
  assert.equal(m.shouldKeepAutoPosition(0.11, 0.1), true);
  assert.equal(m.shouldKeepAutoPosition(0.110001, 0.1), false);
  assert.equal(m.shouldKeepAutoPosition(0, 0), true);
  assert.equal(m.shouldKeepAutoPosition(0.000001, 0), false);
});

test("ON and FULL retain horizontal positions for small changes and reposition when total gaps exceed 10 percent", () => {
  for (const mode of ["on", "full"]) {
    let {pieces} = m.createInitialState();
    const anchors = m.selectAutoAnchors(pieces);
    const first = m.autoPosition(pieces, anchors, mode);
    pieces = pieces.map(p => first.find(q => q.id === p.id) || p);
    const baseline = structuredClone(pieces);
    for (const x of [50.1, 50, 50.1, 50]) {
      pieces.find(p => p.team === "ball").x = x;
      const result = m.autoPosition(pieces, anchors, mode);
      for (const p of result) assert.equal(p.x, baseline.find(q => q.id === p.id).x, mode + " keeps lateral positions through small oscillations");
      pieces = pieces.map(p => result.find(q => q.id === p.id) || p);
    }
    // Line contact follows a new radius even while x stays unchanged.
    const depthChange = structuredClone(baseline);
    depthChange.find(p => p.team === "ball").y = 60;
    const depthResult = m.autoPosition(depthChange, anchors, mode);
    assert.ok(depthResult.every(p => p.x === baseline.find(q => q.id === p.id).x));
    assert.ok(depthResult.some(p => p.y !== baseline.find(q => q.id === p.id).y));
    pieces.find(p => p.team === "ball").x = 90;
    const ball = pieces.find(p => p.team === "ball");
    const before = m.autoGapScore(ball, pieces.filter(p => p.team === "opponent"), "opponent")[1];
    const improved = m.autoPosition(pieces, anchors, mode);
    assert.ok(improved.some(p => p.x !== baseline.find(q => q.id === p.id).x));
    const afterPieces = pieces.map(p => improved.find(q => q.id === p.id) || p);
    const after = m.autoGapScore(ball, afterPieces.filter(p => p.team === "opponent"), "opponent")[1];
    assert.ok(before > after * 1.1, mode + " only repositions beyond the agreed total-gap threshold");
  }
});

// Isotropic portrait coordinates keep ray intersections independent of orientation.
function aimPolygon(ball, defenders, bounds, attackY, goalY) {
  const direction = Math.sign(goalY-ball.y);
  const first = Math.atan2(bounds.left-ball.x,Math.abs(attackY-ball.y));
  const last = Math.atan2(bounds.right-ball.x,Math.abs(attackY-ball.y));
  const points = [ball];
  for (let i=0;i<=720;i++) {
    const angle = first+(last-first)*i/720;
    const dx = Math.sin(angle), dy = direction*Math.cos(angle);
    let distance = (goalY-ball.y)/dy;
    if (dx > 1e-9) distance = Math.min(distance,(bounds.right-ball.x)/dx);
    if (dx < -1e-9) distance = Math.min(distance,(bounds.left-ball.x)/dx);
    for (const player of defenders) {
      const x = player.x-ball.x, y = player.y-ball.y;
      const dot = x*dx+y*dy;
      const discriminant = player.radius**2-(x*x+y*y-dot*dot);
      if (x*x+y*y <= player.radius**2) { distance = 0; break; }
      if (discriminant < 0) continue;
      const near = dot-Math.sqrt(discriminant);
      if (near >= 0) distance = Math.min(distance,near);
    }
    points.push({x:ball.x+dx*Math.max(0,distance),y:ball.y+dy*Math.max(0,distance)});
  }
  return points;
}

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'rv-tactic-board-v1';
  const initial = () => ({ opponents: true, pieces: [
    ...[[72,82],[50,82],[28,82],[72,57.5],[50,57.5],[28,57.5]].map(([x,y],i) => ({id:`home-${i+1}`,team:'home',number:i+1,x,y})),
    ...[[28,18],[50,18],[72,18],[28,42.5],[50,42.5],[72,42.5]].map(([x,y],i) => ({id:`away-${i+1}`,team:'opponent',number:i+1,x,y})),
    {id:'ball',team:'ball',number:0,x:50,y:73}
  ], arrows: [] });
  let state = initial(), gesture = null, landscape = false;
  let aimVisibleUntil = 0, aimTimer;
  function keepAimBriefly() {
    clearTimeout(aimTimer);
    aimVisibleUntil = Date.now()+5000;
    aimTimer = setTimeout(() => { aimVisibleUntil = 0; drawAim(); },5000);
  }
  $('aim-visibility').onchange = () => {
    clearTimeout(aimTimer);
    aimVisibleUntil = 0;
    drawAim();
  };
  let temporaryArrows = [];
  let expiryTimer;
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    temporaryArrows = temporaryArrows.filter(a => a.expiresAt > Date.now());
    if (temporaryArrows.length) expiryTimer = setTimeout(() => {
      scheduleExpiry();
      drawArrows(gesture && !gesture.piece && gesture.end ? {
        x1:gesture.start.x,y1:gesture.start.y,x2:gesture.end.x,y2:gesture.end.y
      } : null);
    },Math.max(0,Math.min(...temporaryArrows.map(a => a.expiresAt))-Date.now()));
  }
  const undo = [], redo = [];
  const copy = value => JSON.parse(JSON.stringify(value));
  let noticeTimer;
  const announce = message => {
    $('status').textContent = message;
    // Routine movement hints remain accessible without taking up court space.
    const show = /保存しました|保存した配置を開きました|ありません|できません|読み込めません/.test(message);
    $('status').classList.toggle('notice',show);
    clearTimeout(noticeTimer);
    if (show) noticeTimer = setTimeout(() => $('status').classList.remove('notice'),3500);
  };
  $('toggle-tools').onclick = () => {
    const open = $('tool-panel').hidden;
    $('tool-panel').hidden = !open;
    $('toggle-tools').setAttribute('aria-expanded',open);
  };
  function remember(previous) { undo.push(previous); if (undo.length > 60) undo.shift(); redo.length = 0; }
  function historyButtons() { $('undo').disabled = !undo.length; $('redo').disabled = !redo.length; }
  // Stored coordinates always use the portrait court: home at the bottom.
  const screenPoint = p => landscape ? {x:100-p.y,y:p.x} : p;
  const courtPoint = p => landscape ? {x:p.y,y:100-p.x} : p;
  function constrainPiece(p) {
    p.x = Math.max(7,Math.min(93,p.x));
    p.y = Math.max(5,Math.min(95,p.y));
    if (p.team === 'ball') return;
    const rect = $('court').getBoundingClientRect();
    const diameter = parseFloat(getComputedStyle($('court')).getPropertyValue('--piece-size'));
    const clearance = Math.min(7.4,(diameter / 2 + 1) / (landscape ? rect.width : rect.height) * 100);
    const front = p.number >= 4;
    const [min,max] = p.team === 'home'
      ? (front ? [50+clearance,65-clearance] : [65+clearance,95])
      : (front ? [35+clearance,50-clearance] : [5,35-clearance]);
    p.y = Math.max(min,Math.min(max,p.y));
  }
  function placePiece(button,p) {
    const display = screenPoint(p);
    button.style.left = `${display.x}%`; button.style.top = `${display.y}%`;
  }
  function drawArrows(preview) {
    $('arrow-lines').replaceChildren();
    [...state.arrows, ...temporaryArrows.filter(a => a.expiresAt > Date.now()), ...(preview ? [preview] : [])].forEach(a => {
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      const start = screenPoint({x:a.x1,y:a.y1}), end = screenPoint({x:a.x2,y:a.y2});
      const scaleX = landscape ? 86/45 : 1, scaleY = landscape ? 1 : 86/45;
      Object.entries({x1:start.x*scaleX,y1:start.y*scaleY,x2:end.x*scaleX,y2:end.y*scaleY,stroke:'#fff5c2','stroke-width':.8,'stroke-linecap':'round','marker-end':'url(#arrowhead)'}).forEach(([k,v]) => line.setAttribute(k,v));
      $('arrow-lines').append(line);
    });
  }
  function drawAim() {
    const canvas = $('aim-overlay');
    const ball = state.pieces.find(p => p.team === 'ball');
    canvas.hidden = $('aim-visibility').value !== 'always' && gesture?.piece?.team !== 'ball' && Date.now() >= aimVisibleUntil;
    if (canvas.hidden) return;
    const rect = $('court').getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width*ratio);
    canvas.height = Math.round(rect.height*ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio,ratio);
    const width = landscape ? rect.height : rect.width;
    const height = landscape ? rect.width : rect.height;
    const toPixel = p => ({x:p.x*width/100,y:p.y*height/100});
    const target = ball.y >= 50 ? 'opponent' : 'home';
    const radius = parseFloat(getComputedStyle($('court')).getPropertyValue('--piece-size'))/2;
    const defenders = state.pieces.filter(p => p.team === target).map(p => ({...toPixel(p),radius}));
    const points = aimPolygon(toPixel(ball),defenders,{left:width*.07,right:width*.93},height*(target === 'opponent' ? .35 : .65),height*(target === 'opponent' ? .05 : .95));
    if (landscape) { ctx.translate(height,0); ctx.rotate(Math.PI/2); }
    ctx.beginPath();
    points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 221, 92, 0.32)';
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (const p of defenders) { ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill(); }
  }
  function render() {
    state.pieces.forEach(constrainPiece);
    $('pieces').replaceChildren();
    state.opponents = true;
    state.pieces.forEach(p => {
      const button = document.createElement('button');
      button.className = `piece ${p.team}`; button.dataset.id = p.id;
      button.textContent = p.team === 'ball' ? '' : p.number;
      button.setAttribute('aria-label', p.team === 'ball' ? 'ボール' : `${p.team === 'home' ? '味方' : '相手'} ${p.number}番`);
      button.title = 'ドラッグで移動・矢印キーで微調整';
      placePiece(button,p);
      $('pieces').append(button);
    });
    drawArrows(); historyButtons(); drawAim();
  }
  function point(event) {
    const r = $('court').getBoundingClientRect();
    const p = courtPoint({x:(event.clientX-r.left)/r.width*100,y:(event.clientY-r.top)/r.height*100});
    return {x:Math.max(7,Math.min(93,p.x)),y:Math.max(5,Math.min(95,p.y))};
  }
  ['portrait','landscape'].forEach(id => $(id).onclick = () => {
    if (gesture) return;
    landscape = id === 'landscape';
    document.querySelector('.workspace').classList.toggle('landscape',landscape);
    $('arrows').setAttribute('viewBox',landscape ? '0 0 191.111111 100' : '0 0 100 191.111111');
    $('portrait').setAttribute('aria-pressed',!landscape);
    $('landscape').setAttribute('aria-pressed',landscape);
    render();
    announce(landscape ? '横向き：左が味方、右が相手コートです。' : '縦向き：下が味方、上が相手コートです。');
  });
  window.addEventListener('resize',() => { if (!gesture) render(); else drawAim(); });
  $('court').addEventListener('pointerdown',event => {
    if (gesture || event.button !== 0) return;
    const target = event.target.closest('.piece');
    event.preventDefault();
    const start = point(event), piece = target ? state.pieces.find(p => p.id === target.dataset.id) : null;
    gesture = {pointer:event.pointerId,start,before:copy(state),piece,target,temporary:$('line-lifetime').value === 'temporary',offset:piece ? {x:piece.x-start.x,y:piece.y-start.y} : null};
    if (target) { target.focus({preventScroll:true}); target.classList.add('dragging'); }
    $('court').setPointerCapture(event.pointerId);
    drawAim();
  });
  $('court').addEventListener('pointermove',event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const p = point(event);
    if (gesture.piece) {
      gesture.piece.x = p.x+gesture.offset.x; gesture.piece.y = p.y+gesture.offset.y;
      constrainPiece(gesture.piece);
      placePiece(gesture.target,gesture.piece);
      drawAim();
    } else { gesture.end = p; drawArrows({x1:gesture.start.x,y1:gesture.start.y,x2:p.x,y2:p.y}); }
  });
  function finish(event,cancel = false) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const g = gesture; gesture = null;
    if (g.piece?.team === 'ball') {
      if (cancel) { clearTimeout(aimTimer); aimVisibleUntil = 0; }
      else keepAimBriefly();
    }
    if (cancel) state = g.before;
    else {
      if (!g.piece && g.end && Math.hypot(g.end.x-g.start.x,g.end.y-g.start.y)>2) {
        const arrow = {x1:g.start.x,y1:g.start.y,x2:g.end.x,y2:g.end.y};
        if (g.temporary) { temporaryArrows.push({...arrow,expiresAt:Date.now()+5000}); scheduleExpiry(); }
        else state.arrows.push(arrow);
      }
      if (JSON.stringify(state)!==JSON.stringify(g.before)) remember(g.before);
    }
    if ($('court').hasPointerCapture(event.pointerId)) $('court').releasePointerCapture(event.pointerId);
    render();
  }
  $('court').addEventListener('pointerup',event => finish(event));
  $('court').addEventListener('pointercancel',event => finish(event,true));
  $('court').addEventListener('lostpointercapture',event => finish(event,true));
  function change(fn,message) { const before = copy(state); fn(); if (JSON.stringify(before)!==JSON.stringify(state)) remember(before); render(); announce(message); }
  $('clear').onclick = () => change(() => { state.arrows = []; temporaryArrows = []; scheduleExpiry(); },'線を消しました。');
  $('reset').onclick = () => change(() => { state = initial(); temporaryArrows = []; scheduleExpiry(); },'初期配置に戻しました。元に戻すこともできます。');
  function travel(from,to,message) { if (!from.length || gesture) return; to.push(copy(state)); state = from.pop(); render(); announce(message); }
  $('undo').onclick = () => travel(undo,redo,'ひとつ前の状態に戻しました。');
  $('redo').onclick = () => travel(redo,undo,'操作をやり直しました。');
  $('save').onclick = () => { try { localStorage.setItem(KEY,JSON.stringify(state)); announce('配置と矢印を、このブラウザに保存しました。'); } catch { announce('保存できませんでした。ブラウザの保存設定を確認してください。'); } };
  function valid(s) {
    const defaults = initial();
    return s && typeof s.opponents === 'boolean' && Array.isArray(s.pieces) && s.pieces.length === 13 && defaults.pieces.every(p => s.pieces.filter(q => q.id === p.id && q.team === p.team && q.number === p.number && Number.isFinite(q.x) && q.x >= 7 && q.x <= 93 && Number.isFinite(q.y) && q.y >= 5 && q.y <= 95).length === 1) && Array.isArray(s.arrows) && s.arrows.length <= 10000 && s.arrows.every(a => a && ['x1','x2','y1','y2'].every(k => Number.isFinite(a[k]) && a[k] >= 0 && a[k] <= 100));
  }
  $('load').onclick = () => {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) { announce('保存した配置はまだありません。「配置を保存」を押してください。'); return; }
      const saved = JSON.parse(raw); if (!valid(saved)) throw new Error('invalid');
      change(() => { state = saved; temporaryArrows = []; scheduleExpiry(); },'保存した配置を開きました。');
    } catch { announce('保存した配置を読み込めませんでした。'); }
  };
  document.addEventListener('keydown',event => {
    if (event.target.matches('input,textarea,select') || gesture) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $(event.shiftKey ? 'redo' : 'undo').click(); return; }
    const target = event.target.closest('.piece');
    const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (!target || !delta) return;
    event.preventDefault(); const id = target.dataset.id;
    const [dx,dy] = landscape ? [delta[1],-delta[0]] : delta;
    change(() => { const p = state.pieces.find(p => p.id === id); p.x += dx; p.y += dy; constrainPiece(p); },'選手・ボールの位置を調整しました。');
    document.querySelector(`[data-id="${id}"]`).focus({preventScroll:true});
  });
  render();
})();

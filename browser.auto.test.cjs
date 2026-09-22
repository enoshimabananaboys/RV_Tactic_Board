const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

test('auto position: gestures, animation, history, reselection, mobile and keyboard', async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(__dirname, name === '/' ? 'index.html' : name);
    try {
      res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge', headless:true});
    const context = await browser.newContext({viewport:{width:700,height:900}, hasTouch:true, serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    const piece = id => page.locator(`[data-id="${id}"]`);
    const snapshot = () => page.locator('.piece').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.id, [parseFloat(n.style.left), parseFloat(n.style.top)]])));
    let controlledClock = false;
    const wait = () => controlledClock ? page.clock.runFor(660) : page.waitForTimeout(660);
    const drag = async (id, x, y, end = true) => {
      const start = await piece(id).boundingBox();
      const court = await page.locator('#court').boundingBox();
      await page.mouse.move(start.x + start.width/2, start.y + start.height/2);
      await page.mouse.down();
      await page.mouse.move(court.x + court.width*x/100, court.y + court.height*y/100);
      if (end) await page.mouse.up();
    };
    const initial = await snapshot();
    assert.equal(await page.locator('#auto-position').getAttribute('aria-pressed'), 'false');
    await page.locator('#auto-position').click();
    await wait();
    assert.deepEqual(await snapshot(), initial, 'enabling does not move players');
    assert.equal(await piece('away-2').getAttribute('aria-disabled'), null);
    await drag('away-2', 55, 22);
    await wait();
    const manual = await snapshot();
    assert.notDeepEqual(manual['away-2'], initial['away-2'], 'auto members allow dragging');
    await piece('away-2').focus();
    await page.keyboard.press('ArrowRight');
    assert.notDeepEqual((await snapshot())['away-2'], manual['away-2'], 'auto members allow keyboard moves');
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    assert.deepEqual(await snapshot(), initial);

    await drag('ball', 64, 73, false);
    const intermediate = await snapshot();
    await page.mouse.up();
    await wait();
    const moved = await snapshot();
    assert.notDeepEqual(intermediate['away-2'], moved['away-2'], 'motion continues smoothly after release');
    for (const id of ['away-4','away-6',...Array.from({length:6},(_,i)=>'home-'+(i+1))]) assert.deepEqual(moved[id], initial[id]);
    for (const id of ['away-1','away-2','away-3']) assert.equal(moved[id][1], 31.875);
    assert.equal(moved['away-5'][1], 38.125);
    await page.locator('#undo').click();
    assert.deepEqual(await snapshot(), initial, 'undo restores ball and defenders together');
    await page.locator('#redo').click();
    assert.deepEqual(await snapshot(), moved);

    await drag('away-4', 50, 43.75);
    await wait();
    const reselected = await snapshot();
    for (const id of ['away-1','away-2','away-3','away-5','away-6']) assert.deepEqual(reselected[id], moved[id], 'manual anchor movement does not trigger auto movement');
    assert.equal(await piece('away-4').getAttribute('aria-disabled'), null);
    const unlocked = Object.entries(reselected).filter(([id]) => id.startsWith('away-')).sort((a,b)=>a[1][0]-b[1][0]).filter((_,i)=>i===0 || i===5).map(([id])=>id);
    assert.equal(unlocked.length, 2);
    assert.ok(!unlocked.includes('away-4'));
    await drag('ball', 60, 73);
    await wait();
    const afterReselection = await snapshot();
    for (const id of unlocked) assert.deepEqual(afterReselection[id], reselected[id]);
    assert.equal(afterReselection['away-4'][1], 38.125);

    // Pointer cancellation rolls back both teams, including a net crossing.
    const cdp = await context.newCDPSession(page);
    const ballRect = await piece('ball').boundingBox();
    const court = await page.locator('#court').boundingBox();
    const touch = async (type, touchPoints) => {
      await cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
      // Chromium still delivers coalesced input on its real frame clock.
      if (controlledClock) await page.waitForTimeout(50);
    };
    await touch('touchStart',[{id:1,x:ballRect.x+ballRect.width/2,y:ballRect.y+ballRect.height/2}]);
    await touch('touchMove',[{id:1,x:court.x+court.width*.45,y:court.y+court.height*.27}]);
    await wait();
    const crossed = await snapshot();
    assert.notDeepEqual(crossed['home-2'], afterReselection['home-2']);
    await touch('touchCancel',[]);
    assert.deepEqual(await snapshot(), afterReselection);

    // Ball movement continues under a held player, but auto placement waits.
    const anchorRect = await piece(unlocked[0]).boundingBox();
    const b = await piece('ball').boundingBox();
    const anchorTouch = {id:1,x:anchorRect.x+anchorRect.width/2,y:anchorRect.y+anchorRect.height/2};
    const ballTouch = {id:2,x:b.x+b.width/2,y:b.y+b.height/2};
    await touch('touchStart',[anchorTouch]);
    await touch('touchStart',[anchorTouch,ballTouch]);
    await touch('touchMove',[anchorTouch,{...ballTouch,x:ballTouch.x+30}]);
    const paused = await snapshot();
    assert.notDeepEqual(paused.ball, afterReselection.ball);
    for (const id of Object.keys(paused).filter(id=>id!=='ball')) assert.deepEqual(paused[id], afterReselection[id]);
    await touch('touchEnd',[]);
    await wait();
    assert.deepEqual(await snapshot(), paused, 'releasing players does not trigger auto placement');

    await piece('ball').focus();
    await page.keyboard.press('ArrowLeft');
    await wait();
    const keyed = await snapshot();
    assert.equal(keyed.ball[0], paused.ball[0]-1);
    await page.locator('#auto-position').click();
    await page.locator('#auto-position').click();
    await drag('ball', 40, 73);
    await wait();
    const off = await snapshot();
    for (const id of Object.keys(keyed).filter(id=>id!=='ball')) assert.deepEqual(off[id], keyed[id]);
    await drag('away-2', 50, 20);
    await wait();
    assert.notDeepEqual((await snapshot())['away-2'], off['away-2']);

    await page.locator('#auto-position').click();
    await page.locator('#reset').click();
    assert.equal(await page.locator('#auto-position').getAttribute('aria-pressed'), 'false');
    await page.locator('#auto-position').click();
    await page.locator('#toggle-tools').click();
    await page.locator('.position-slot').nth(1).click();
    assert.equal(await page.locator('#auto-position').getAttribute('aria-pressed'), 'false');
    await page.locator('#toggle-tools').click();

    // A former automatic player can become a fixed sideline player.
    await page.reload();
    await page.locator('#auto-position').click();
    await drag('away-2', 10, 20);
    await wait();
    const newAnchor = await snapshot();
    await drag('home-2', 12, 80);
    await wait();
    const bothManual = await snapshot();
    assert.notDeepEqual(bothManual['home-2'], initial['home-2']);
    await drag('ball', 60, 73);
    await wait();
    const newFixed = await snapshot();
    assert.deepEqual(newFixed['away-2'], newAnchor['away-2'], 'manual sideline placement becomes fixed');
    assert.equal(newFixed['away-4'][1], 38.125, 'former fixed player becomes automatic');
    assert.deepEqual(newFixed['home-2'], bothManual['home-2']);

    // Control animation time so hit-testing a moving player is deterministic.
    await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
    await page.reload();
    await page.locator('#auto-position').click();
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
    controlledClock = true;
    const touchCenter = async (id, finger) => {
      const r = await piece(id).boundingBox();
      return {id:finger, x:r.x+r.width/2, y:r.y+r.height/2};
    };
    let heldBall = await touchCenter('ball', 1);
    await touch('touchStart', [heldBall]);
    heldBall = {...heldBall, x:heldBall.x+30};
    await touch('touchMove', [heldBall]);
    await page.clock.runFor(32);
    const movingPlayer = await touchCenter('away-2', 2);
    await touch('touchStart', [heldBall, movingPlayer]);
    const caught = await snapshot();
    assert.notEqual(caught['away-2'][1], 31.875, 'player caught before reaching destination');
    await wait();
    const heldStill = await snapshot();
    assert.deepEqual(heldStill, caught, 'held player and other automatic animations remain paused');
    const shiftedPlayer = {...movingPlayer, x:movingPlayer.x+40};
    heldBall = {...heldBall, x:heldBall.x+20};
    await touch('touchMove', [heldBall, shiftedPlayer]);
    await page.clock.runFor(16);
    const dragging = await snapshot();
    assert.ok(Math.abs(dragging['away-2'][0] - caught['away-2'][0] - 40/court.width*100) < 0.05, 'manual drag starts at visible position: ' + JSON.stringify({dragging:dragging['away-2'],caught:caught['away-2'],width:court.width}));
    assert.equal(dragging['away-2'][1], caught['away-2'][1]);
    for (const id of ['away-1','away-3','away-5']) assert.deepEqual(dragging[id], caught[id]);
    await touch('touchEnd', [shiftedPlayer]);
    await wait();
    const releasedManual = await snapshot();
    await wait();
    assert.deepEqual(await snapshot(), releasedManual, 'release alone never resumes auto positioning');
    heldBall = {...heldBall, x:heldBall.x+10};
    await touch('touchMove', [heldBall]);
    await wait();
    assert.equal((await snapshot())['away-2'][1], 31.875, 'next ball movement resumes placement');
    await touch('touchEnd', []);

    await page.clock.resume();
    controlledClock = false;

    // Cancelling just the ball must preserve a completed manual move.
    await page.reload();
    await page.locator('#auto-position').click();
    heldBall = await touchCenter('ball', 1);
    await touch('touchStart', [heldBall]);
    heldBall = {...heldBall, x:heldBall.x+25};
    await touch('touchMove', [heldBall]);
    await wait();
    let manualTouch = await touchCenter('away-2', 2);
    await touch('touchStart', [heldBall, manualTouch]);
    manualTouch = {...manualTouch, x:manualTouch.x+20, y:manualTouch.y-20};
    await touch('touchMove', [heldBall, manualTouch]);
    await touch('touchEnd', [manualTouch]);
    await wait();
    const beforeCancelBall = await snapshot();
    await touch('touchCancel', []);
    const afterCancelBall = await snapshot();
    assert.deepEqual(afterCancelBall.ball, initial.ball);
    assert.deepEqual(afterCancelBall['away-2'], beforeCancelBall['away-2'], 'ball cancellation preserves manual placement');
    for (const id of ['away-1','away-3','away-5']) assert.deepEqual(afterCancelBall[id], initial[id]);
    await page.locator('#undo').click();
    assert.deepEqual(await snapshot(), initial, 'remaining manual move has one undo entry');

    // Two manually held players keep auto placement paused until both release.
    await page.reload();
    await page.locator('#auto-position').click();
    const manualOne = await touchCenter('away-1', 1);
    const manualTwo = await touchCenter('home-2', 2);
    let thirdBall = await touchCenter('ball', 3);
    await touch('touchStart', [manualOne]);
    await touch('touchStart', [manualOne, manualTwo]);
    await touch('touchStart', [manualOne, manualTwo, thirdBall]);
    thirdBall = {...thirdBall, x:thirdBall.x+30};
    await touch('touchMove', [manualOne, manualTwo, thirdBall]);
    await touch('touchEnd', [manualOne]);
    thirdBall = {...thirdBall, x:thirdBall.x+30};
    await touch('touchMove', [manualTwo, thirdBall]);
    await wait();
    assert.deepEqual((await snapshot())['away-2'], initial['away-2'], 'one remaining held player keeps auto paused');
    await touch('touchEnd', [manualTwo]);
    await wait();
    assert.deepEqual((await snapshot())['away-2'], initial['away-2']);
    thirdBall = {...thirdBall, x:thirdBall.x+15};
    await touch('touchMove', [thirdBall]);
    await wait();
    assert.equal((await snapshot())['away-2'][1],31.875);
    await touch('touchEnd', []);

    // Keyboard takeover also ends on a legal grid point, including the other axis.
    await page.reload();
    await page.locator('#auto-position').click();
    await page.clock.pauseAt(new Date('2026-01-03T00:00:00Z'));
    controlledClock = true;
    await piece('ball').focus();
    await page.keyboard.press('ArrowLeft');
    await page.clock.runFor(32);
    await piece('away-2').focus();
    await page.keyboard.press('ArrowRight');
    const keyboardCatch = (await snapshot())['away-2'];
    for (const [coordinate, origin, step] of [[keyboardCatch[0],7,86/36],[keyboardCatch[1],5,1.25]]) {
      assert.ok(Math.abs((coordinate-origin)/step - Math.round((coordinate-origin)/step)) < 0.0001);
    }
    await wait();
    assert.deepEqual((await snapshot())['away-2'], keyboardCatch);
    await page.clock.resume();
    controlledClock = false;

    // Three-stage toggle, FULL movement, adaptive sizes and doubled animation duration.
    await page.reload();
    const diameter = id => piece(id).evaluate(el => {
      const court = document.querySelector('#court').getBoundingClientRect();
      const horizontal = document.querySelector('.workspace').classList.contains('landscape');
      const meter = (horizontal ? court.height : court.width) * 0.86 / 9;
      return el.getBoundingClientRect().width / meter;
    });
    const closeDiameter = async (id, expected) => assert.ok(Math.abs(await diameter(id) - expected) < 0.002, id + ' diameter ' + expected);
    assert.equal(await page.locator('#auto-position').textContent(),'自動位置OFF');
    await closeDiameter('away-4',0.75);
    await closeDiameter('away-1',1);
    const beforeFull = await snapshot();
    await page.locator('#auto-position').click();
    assert.equal(await page.locator('#auto-position').textContent(),'自動位置ON');
    await closeDiameter('away-4',1.25);
    await closeDiameter('away-1',1.25);
    await closeDiameter('home-5',1);
    assert.deepEqual(await snapshot(),beforeFull,'size changes must not move fixed centers');
    await page.locator('#auto-position').click();
    assert.equal(await page.locator('#auto-position').textContent(),'自動位置FULL');
    assert.deepEqual(await snapshot(),beforeFull,'FULL only changes placement on ball movement');
    await page.clock.pauseAt(new Date('2026-01-04T00:00:00Z'));
    controlledClock = true;
    await piece('ball').focus();
    await page.keyboard.press('ArrowLeft');
    await page.clock.runFor(300);
    const halfway = await snapshot();
    await page.clock.runFor(360);
    const fullPlaced = await snapshot();
    assert.notDeepEqual(halfway['away-1'],fullPlaced['away-1'],'long movement now takes more than 300ms');
    for (let number=1; number<=6; number++) {
      const id = 'away-'+number;
      assert.notDeepEqual(fullPlaced[id],beforeFull[id],'FULL moves '+id);
      assert.equal(fullPlaced[id][1],number<=3 ? 31.875 : 38.125);
      await closeDiameter(id,1.25);
      assert.deepEqual(fullPlaced['home-'+number],beforeFull['home-'+number]);
    }
    await page.clock.resume();
    controlledClock = false;
    await page.locator('#undo').click();
    assert.deepEqual(await snapshot(),beforeFull,'FULL undo restores all six and ball');
    await page.locator('#auto-position').click();
    assert.equal(await page.locator('#auto-position').textContent(),'自動位置OFF');
    await closeDiameter('away-4',0.75);
    await closeDiameter('away-1',1);
    await page.locator('#auto-position').click();
    for (const [distance, expected] of [[2.9,0.75],[3.1,1],[4.9,1],[5.1,1.25]]) {
      await drag('ball',50,56.25+distance*5);
      await wait();
      await closeDiameter('home-5',expected);
    }
    await page.locator('#auto-position').click();
    assert.equal(await page.locator('#auto-position').getAttribute('data-mode'),'full');
    for (const width of [320,375]) {
      await page.setViewportSize({width,height:800});
      const fits = await page.locator('.board-heading').evaluate(el => [...el.querySelectorAll('button,a')].every(n=>{
        const r=n.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth;
      }));
      assert.ok(fits,'FULL label fits '+width+'px');
    }
    await page.locator('#reset').click();
    assert.equal(await page.locator('#auto-position').getAttribute('data-mode'),'off');

    // Small ball movements preserve all current lateral positions in both modes.
    await page.setViewportSize({width:700,height:900});
    for (const mode of ['on','full']) {
      await page.reload();
      await page.locator('#auto-position').click();
      if (mode === 'full') await page.locator('#auto-position').click();
      await piece('ball').focus();
      await page.keyboard.press('ArrowLeft');
      await wait();
      const stable = await snapshot();
      await page.keyboard.press('ArrowLeft');
      await wait();
      const slightMove = await snapshot();
      for (let n=1;n<=6;n++) assert.equal(slightMove['away-'+n][0],stable['away-'+n][0],mode+' retains player '+n);
      assert.notEqual(slightMove.ball[0],stable.ball[0]);
      await page.locator('#undo').click();
      assert.deepEqual(await snapshot(),stable,'retained placement still supports undo');
    }

    // Horizontal orientation uses the same court-space placement.
    await page.setViewportSize({width:1100,height:700});
    await page.reload();
    const horizontal = await snapshot();
    await page.locator('#auto-position').click();
    await piece('ball').focus();
    await page.keyboard.press('ArrowDown');
    await wait();
    const hMoved = await snapshot();
    assert.equal(hMoved['away-2'][0], 68.125);
    assert.deepEqual(hMoved['away-4'], horizontal['away-4']);
    await page.screenshot({path:path.join(process.env.TEMP,'rv-auto-desktop.png')});
    for (const width of [320,375,390]) {
      await page.setViewportSize({width,height:800});
      const layout = await page.locator('.board-heading').evaluate(el => {
        const items = [...el.querySelectorAll('button,a')].map(n=>n.getBoundingClientRect());
        return {height:el.getBoundingClientRect().height, fits:items.every(r=>r.left>=0 && r.right<=innerWidth), centers:items.map(r=>r.y+r.height/2)};
      });
      assert.equal(layout.height,48);
      assert.ok(layout.fits, `toolbar fits ${width}px`);
      assert.ok(Math.max(...layout.centers)-Math.min(...layout.centers)<1);
    }
    await page.screenshot({path:path.join(process.env.TEMP,'rv-auto-mobile.png')});
    await page.reload();
    assert.equal(await page.locator('#auto-position').getAttribute('aria-pressed'),'false');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

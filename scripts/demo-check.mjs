// Drives the demo page in a real headless Chrome, presses every control, saves screenshots
// to demo-check-out/, and fails if a check breaks. No extra packages: it talks to Chrome
// over the DevTools protocol with Node's built-in WebSocket (Node 22 or newer).
//
//   npm run demo-check                  starts its own dev server, runs every check
//   npm run demo-check -- --quick       shorter waits, about half the time
//   npm run demo-check -- --built       builds the app and checks the built copy instead
//   DEMO_URL=http://localhost:5173/?quality=low npm run demo-check    checks a page you are already serving
//   CHROME_PATH=/path/to/chrome npm run demo-check                   if Chrome is somewhere unusual
//
// A passing check does not mean the page looks right. Open the screenshots and look at them.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const QUICK = args.has('--quick');
const BUILT = args.has('--built');
const OUT = 'demo-check-out';
const WIDTH = 1500;
const HEIGHT = 950;

/** Extra page text the screen must show, added as the screen grows. */
const REQUIRED_TEXT = [
  'How each train is deciding',
  'Delay saved per train',
  'Obeys the control centre',
  'Moved by staff over the radio, at caution speed',
  'Hears the train ahead',
  'The last report from the train ahead is old',
  'No report from the train ahead',
];

const results = [];
const problems = [];
let step = 0;

function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the page server

async function startServer() {
  if (process.env.DEMO_URL) return { url: process.env.DEMO_URL, close: async () => {} };
  const vite = await import('vite');
  if (BUILT) {
    console.log('building...');
    await vite.build({ logLevel: 'warn' });
    const server = await vite.preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
    const url = server.resolvedUrls.local[0];
    return { url, close: () => new Promise((r) => server.httpServer.close(r)) };
  }
  const server = await vite.createServer({ server: { port: 0, strictPort: false }, logLevel: 'warn' });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

// ---------------------------------------------------------------- Chrome

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to your Chrome or Chromium.');
  return found;
}

function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'demo-check-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
    chrome.stderr.on('data', (d) => {
      text += d;
      const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.on('exit', () => reject(new Error(`Chrome exited early:\n${text}`)));
  });
  const close = async () => {
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome can hold the profile for a moment on Windows. It is in the temp folder anyway.
    }
  };
  return { endpoint, close };
}

/** A small DevTools protocol client over one browser WebSocket, with flat sessions. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== undefined && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      waiting.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

// ---------------------------------------------------------------- the checks

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const chrome = launchChrome();
  let cdp;
  try {
    cdp = await connect(await chrome.endpoint);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);

    const pageErrors = [];
    const consoleErrors = [];
    const consoleWarnings = [];
    const failedRequests = [];
    cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        pageErrors.push(d.exception?.description ?? d.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') {
        consoleWarnings.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
        failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
      } else if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) {
        failedRequests.push(`${msg.params.errorText} (request ${msg.params.requestId})`);
      }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const screenshot = async (name, clip) => {
      step += 1;
      const file = join(OUT, `${step}-${name}.png`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    };
    const bodyText = () => evaluate('document.body.innerText');
    const simTime = async () => {
      const m = (await bodyText()).match(/Time (\d+):(\d\d)/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    /** Clicks the first button whose text starts with `prefix`. */
    const click = (prefix) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(prefix)}));
        if (!b) return false;
        b.click();
        return true;
      })()`);
    const buttonText = (prefix) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(prefix)}));
        return b ? b.textContent.trim() : null;
      })()`);
    const waitFor = async (what, test, ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (await test()) return true;
        await sleep(200);
      }
      return false;
    };
    const setSpeed = (x) =>
      evaluate(`(() => {
        const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent.endsWith('x speed')));
        if (!s) return false;
        s.value = ${JSON.stringify(String(x))};
        s.dispatchEvent(new Event('change'));
        return true;
      })()`);
    const waitForSimTime = async (seconds, ms) => waitFor('time', async () => ((await simTime()) ?? 0) >= seconds, ms);

    console.log(`demo-check: ${server.url}${QUICK ? ' (quick)' : ''}${BUILT ? ' (built)' : ''}`);
    const pageUrl = new URL(server.url);
    pageUrl.searchParams.set('check', '1');
    await send('Page.navigate', { url: pageUrl.href });

    // 1. The page loads and shows both systems.
    const loaded = await waitFor('load', async () => /today's system/i.test(await bodyText()), 30000);
    if (loaded) pass('page loads and shows both systems');
    else fail('page loads and shows both systems', 'no "Today\'s system" heading after 30 s');
    const canvases = await evaluate('document.querySelectorAll("canvas").length');
    if (canvases >= 4) pass('two scenes and two minimaps are drawn', `${canvases} canvases`);
    else fail('two scenes and two minimaps are drawn', `${canvases} canvases`);
    const text = await bodyText();
    for (const t of ['Centre outage', 'Trains through', ...REQUIRED_TEXT]) {
      if (text.toLowerCase().includes(t.toLowerCase())) pass(`page shows "${t}"`);
      else fail(`page shows "${t}"`);
    }

    // 2. Time runs, and faster at 16x.
    await setSpeed(16);
    const t0 = await simTime();
    await sleep(QUICK ? 1500 : 3000);
    const t1 = await simTime();
    if (t0 !== null && t1 !== null && t1 > t0) pass('simulated time runs', `${t0} s to ${t1} s`);
    else fail('simulated time runs', `${t0} to ${t1}`);
    await waitForSimTime(QUICK ? 120 : 240, 60000);
    await screenshot('before-cut');

    // 3. Cut the control centre. Today's trains stop, ours carry on.
    await click('Control centre');
    const cut = await waitFor('cut', async () => (await buttonText('Control centre')) === 'Control centre: OFF', 3000);
    if (cut) pass('the control centre switch turns it off');
    else fail('the control centre switch turns it off', String(await buttonText('Control centre')));
    const tc = (await simTime()) ?? 0;
    await waitForSimTime(tc + (QUICK ? 60 : 120), 60000);
    await screenshot('during-outage');
    // A close-up of the middle of our scene, three times bigger, to see the trains themselves.
    const stage = await evaluate(`(() => {
      const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().height > 100);
      const r = canvases[canvases.length - 1].getBoundingClientRect();
      return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.3, width: r.width * 0.45, height: r.height * 0.4 };
    })()`);
    await screenshot('closeup', { ...stage, scale: 2.5 });

    // 4. Restore it.
    await click('Control centre');
    const back = await waitFor('restore', async () => (await buttonText('Control centre')) === 'Control centre: ON', 3000);
    if (back) pass('the control centre switch turns it back on');
    else fail('the control centre switch turns it back on');
    await sleep(QUICK ? 1000 : 2000);
    await screenshot('after-restore');

    // 5. Every other switch flips both ways.
    for (const name of ['Platform keeper', 'Junction keeper', 'Platform sensors']) {
      await click(name);
      const off = await waitFor(name, async () => (await buttonText(name)) === `${name}: OFF`, 3000);
      await click(name);
      const on = await waitFor(name, async () => (await buttonText(name)) === `${name}: ON`, 3000);
      if (off && on) pass(`the ${name.toLowerCase()} switch turns off and on`);
      else fail(`the ${name.toLowerCase()} switch turns off and on`);
    }

    // 6. The radio slider.
    await evaluate(`(() => {
      const s = document.querySelector('input[type=range]');
      s.value = '40';
      s.dispatchEvent(new Event('input'));
    })()`);
    const radio = await waitFor('radio', async () => (await bodyText()).includes('Radio loss: 40%'), 3000);
    if (radio) pass('the radio slider sets 40% loss');
    else fail('the radio slider sets 40% loss');
    await evaluate(`(() => {
      const s = document.querySelector('input[type=range]');
      s.value = '0';
      s.dispatchEvent(new Event('input'));
    })()`);

    // 7. Break down a train.
    const broke = await evaluate(`(() => {
      const s = [...document.querySelectorAll('select')].find((x) => ![...x.options].some((o) => o.textContent.endsWith('x speed')));
      if (!s || s.options.length === 0) return null;
      s.value = s.options[0].value;
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '▸');
      b.click();
      return s.value;
    })()`);
    if (broke !== null) pass('a train can be broken down', `train ${broke}`);
    else fail('a train can be broken down', 'no trains in the picker');

    // 8. Switch the camera.
    const before = await buttonText('Camera');
    await click('Camera');
    const after = await buttonText('Camera');
    if (before !== after) pass('the camera switches', `${before} -> ${after}`);
    else fail('the camera switches');
    await sleep(500);
    await screenshot('camera-switched');

    // 9. Pause stops time, and a click on a train opens its card.
    await click('Pause');
    await sleep(400);
    const p0 = await simTime();
    await sleep(1200);
    const p1 = await simTime();
    if (p0 === p1) pass('pause stops time');
    else fail('pause stops time', `${p0} -> ${p1}`);
    const card = await clickUntilCard(evaluate, send);
    if (card) pass('clicking a train opens its card', card.split('\n')[0]);
    else fail('clicking a train opens its card');
    await screenshot('train-card');
    await click('Resume');

    // 10. Restart puts everything back.
    await click('Control centre');
    await click('Restart');
    await sleep(800);
    const tr = await simTime();
    const allOn = await waitFor('restart', async () => (await buttonText('Control centre')) === 'Control centre: ON', 3000);
    if (tr !== null && tr < 120 && allOn) pass('restart starts again with everything on', `time ${tr} s`);
    else fail('restart starts again with everything on', `time ${tr}, centre ${await buttonText('Control centre')}`);

    // 11. Frame rate.
    const fps = await evaluate(`new Promise((resolve) => {
      let n = 0;
      const start = performance.now();
      const tick = () => {
        n += 1;
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
        else resolve(Math.round((n * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    })`);
    pass('frame rate measured', `${fps} fps in headless software rendering; measure the real laptop too`);

    // 12. Nothing went wrong in the page.
    if (pageErrors.length === 0) pass('no page errors');
    else fail('no page errors', pageErrors.slice(0, 3).join(' | '));
    if (consoleErrors.length === 0) pass('no console errors');
    else fail('no console errors', consoleErrors.slice(0, 3).join(' | '));
    if (consoleWarnings.length > 0) console.log(`  note  console warnings: ${consoleWarnings.slice(0, 3).join(' | ')}`);
    if (failedRequests.length === 0) pass('no failed downloads');
    else fail('no failed downloads', failedRequests.slice(0, 5).join(' | '));
  } finally {
    cdp?.close();
    await chrome.close();
    await server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots in ${OUT}/. Open them and look.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

/**
 * Time is paused. Asks the page where its trains are (it says so only when opened with
 * ?check), clicks the first one on the right-hand scene with a real mouse event, and returns
 * the card that opens, or null.
 */
async function clickUntilCard(evaluate, send) {
  const target = await evaluate(`(() => {
    const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().height > 100);
    const r = canvases[canvases.length - 1].getBoundingClientRect();
    const points = window.demoCheck ? window.demoCheck.trainPoints() : [];
    const p = points.find((q) => q.x > 4 && q.y > 4 && q.x < r.width - 4 && q.y < r.height - 4);
    return p ? { id: p.id, x: r.x + p.x, y: r.y + p.y } : null;
  })()`);
  if (!target) return null;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const text = await evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.style.display === 'block' && d.textContent.startsWith('mode:'));
      return card ? card.innerText : null;
    })()`);
    if (text) return `train ${target.id}: ${text}`;
    await sleep(100);
  }
  return null;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

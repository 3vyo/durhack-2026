// Drives the demo page in a real headless Chrome and checks it works. Run it with the dev
// server up (`npm run dev`), then `npm run demo-check`. It needs Node 22 or newer (for the
// built-in WebSocket) and Chrome or Chromium installed. No packages to install.
//
//   npm run demo-check              full flow, about 3 minutes: cut the centre, restore, camera
//   npm run demo-check -- --quick   just load the page, check for errors, take one screenshot
//
// Screenshots go to demo-check-out/ so you can look at them. The exit code is non-zero if a
// check fails. Set CHROME_PATH if Chrome is somewhere unusual and DEMO_URL for another address.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.DEMO_URL ?? 'http://localhost:5173/';
const QUICK = process.argv.includes('--quick');
const OUT = path.resolve('demo-check-out');
const PORT = 9333;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH to its executable.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1500,950',
    '--use-angle=swiftshader', // software WebGL, so it works without a GPU
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(OUT, 'profile')}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

async function main() {
  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* Chrome is still starting */
    }
    await sleep(500);
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) throw new Error('Chrome did not start');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else if (d.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(d.params.exceptionDetails?.exception?.description ?? d.params).slice(0, 300));
    } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      errors.push(JSON.stringify(d.params.args?.[0]?.value ?? d.params.args).slice(0, 300));
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++nextId;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const run = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log(`saved ${path.join('demo-check-out', name)}`);
  };
  const click = (text) =>
    run(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!b) return false; b.click(); return true; })()`);
  const simSeconds = async () => {
    const m = /Time (\d+):(\d+)/.exec((await run('document.body.innerText')) ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  };
  const waitSim = async (target) => {
    const start = Date.now();
    while ((await simSeconds()) < target && Date.now() - start < 150000) await sleep(1000);
    return simSeconds();
  };
  // The scoreboard as { 'Delay (min)': ['0.0', '0.0'], ... }, left column then right column.
  const scoreboard = async () =>
    run(`Object.fromEntries([...document.querySelectorAll('table tr')].slice(1).map(r => { const c=[...r.children].map(x=>x.textContent); return [c[0], [c[1], c[2]]]; }))`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4000);

  const hasPanel = await run("document.querySelectorAll('canvas').length === 4 && document.querySelectorAll('button').length >= 7");
  check(hasPanel, 'page renders two scenes, two minimaps and the controls');
  await run("(() => { const s=document.querySelector('select'); s.value='16'; s.dispatchEvent(new Event('change')); })()");

  if (QUICK) {
    await sleep(6000);
    check((await simSeconds()) > 10, 'the simulation is running');
  } else {
    await waitSim(520);
    await shot('1-before-cut.png');
    const before = await scoreboard();
    check(before['Collisions']?.[1] === '0', 'ours has no collisions before the cut');

    check(await click('Cut control centre'), 'the Cut control centre button exists');
    await waitSim(700);
    await shot('2-during-outage.png');
    const during = await scoreboard();
    const delay = (row) => during[row]?.map(Number);
    check(delay('Delay (min)')[0] > delay('Delay (min)')[1], "today's system is behind ours during the outage");
    check(during['Collisions']?.[1] === '0', 'ours has no collisions during the outage');
    check(/Control centre OFF/.test(await run('document.body.innerText')), 'the banner says the control centre is off');

    check(await click('Restore control centre'), 'the Restore control centre button exists');
    await waitSim(900);
    await shot('3-after-restore.png');
    const after = await scoreboard();
    check(Number(after['Delay (min)']?.[0]) > Number(after['Delay (min)']?.[1]), 'the baseline delay is still ahead of ours after the restore');
    check(after['Time to normal (min)']?.[1] === '0.0', 'ours reads time to normal 0.0 after the restore');
    check(after['Collisions']?.[1] === '0', 'ours has no collisions after the restore');

    await click('Camera');
    await sleep(1500);
    await shot('4-camera-switched.png');
  }

  // Each scene's canvas must fill its container, or the bottom of the scene is clipped.
  const sizes = await run(`[...document.querySelectorAll('canvas')].filter((c,i)=>i===0||i===2).map(c=>[c.clientWidth===c.parentElement.clientWidth, c.clientHeight===c.parentElement.clientHeight])`);
  check(sizes?.every(([w, h]) => w && h), 'each scene canvas is the size of its container');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);

  if (QUICK) await shot('quick.png');
  ws.close();
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures.push(String(error));
} finally {
  chrome.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);

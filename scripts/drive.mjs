// Headless-Chrome driver: runs a small action script against the app and
// saves screenshots to the scratchpad. Usage: node drive.mjs <script.json>
// Script: [{ "do": "goto"|"click"|"wheel"|"move"|"wait"|"shot"|"eval"|"key", ... }]

import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = process.env.SHOT_DIR ?? '.';
const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1500,950', '--hide-scrollbars', '--mute-audio', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1500, height: 950 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

for (const s of steps) {
  try {
    if (s.do === 'goto') await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 45000 });
    else if (s.do === 'wait') await new Promise((r) => setTimeout(r, s.ms ?? 1000));
    else if (s.do === 'waitfor') await page.waitForSelector(s.sel, { timeout: s.ms ?? 15000 });
    else if (s.do === 'click') {
      if (s.sel) await page.click(s.sel);
      else await page.mouse.click(s.x, s.y);
    }
    else if (s.do === 'move') await page.mouse.move(s.x, s.y);
    else if (s.do === 'wheel') await page.mouse.wheel({ deltaY: s.dy ?? 0, deltaX: s.dx ?? 0 });
    else if (s.do === 'key') await page.keyboard.press(s.key);
    else if (s.do === 'keydown') await page.keyboard.down(s.key);
    else if (s.do === 'keyup') await page.keyboard.up(s.key);
    else if (s.do === 'ua') await page.setUserAgent(s.value);
    else if (s.do === 'emulate') {
      // phone/tablet emulation — run before goto (UA + touch viewport)
      await page.setUserAgent(s.ua ?? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
      await page.setViewport({
        width: s.width ?? 390, height: s.height ?? 844,
        deviceScaleFactor: s.dpr ?? 2, isMobile: true, hasTouch: true,
      });
    }
    else if (s.do === 'tap') {
      if (s.sel) await page.tap(s.sel);
      else await page.touchscreen.tap(s.x, s.y);
    }
    else if (s.do === 'eval') console.log('EVAL:', JSON.stringify(await page.evaluate(s.js)));
    else if (s.do === 'init') await page.evaluateOnNewDocument(s.js); // runs before every subsequent page load
    else if (s.do === 'shot') await page.screenshot({ path: path.join(DIR, `${s.name}.png`) });
  } catch (e) {
    console.log(`STEP FAILED [${s.do} ${s.sel ?? s.name ?? ''}]: ${e.message.split('\n')[0]}`);
  }
}
if (errors.length) console.log('CONSOLE ERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
else console.log('no console errors');
await browser.close();

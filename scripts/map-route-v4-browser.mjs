/** DOM/Chromium regression for v4 geometry labels. No external models or real host are used. */
import { chromium } from 'playwright-core';
import { build } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const app = path.resolve('artifacts/map-route-v4-browser/app'), out = path.resolve('artifacts/map-route-v4-browser');
mkdirSync(app, { recursive: true });
const styles = [...readFileSync('panel/index.html', 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
writeFileSync(path.join(app, 'index.html'), '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + styles + '</style></head><body><div id="app"></div><script type="module" src="/main.ts"></script></body></html>');
writeFileSync(path.join(app, 'main.ts'), `
import { generatedField, generateUnit, SmallBattle, V11_OVERFLOW_D20, terrainName } from '../../../engine/src/index.js';
import { smallStateSummary } from '../../../engine/src/inject/format.js';
import { renderTacticalBattle, selectTacticalElement } from '../../../panel/src/tactical-view.js';
import { TavernJevAdapter } from '../../../panel/src/jev-adapter.js';
import '../../../panel/src/battle-ui.css';
const make = (side) => { const u=generateUnit({ name:side,side,scale:'hero',level:3,rulesVersion:'v2',weaponClass:'rifle',traits:[] },{seed:side}).unit;u.id=side;return u; };
let b,view;
window.loadMap=async(env='urban')=>{
 const design={layout:'lanes',orientation:'diagonal',relief:'dense',cover:'balanced',obstacles:'dense',route:'winding',breadth:'normal',feature:'hill',featureZone:'enemy_left',landmarkLabel:'废弃钟楼',landmarkScale:'major',topology:'braid'};
 const f=generatedField('browser-map-v4',7,13,[env],{design});
 b=new SmallBattle({battlefield:f,combatants:[make('ally'),make('enemy')],rules:V11_OVERFLOW_D20,seed:'browser'});b.start();b.turnOrder=['ally','enemy'];b.turnIndex=0;
 view={mode:'weapon',selectedId:'ally',inspectedCell:f.generation.landmark.cells[0]};
 const snapshot=JSON.stringify(b.toSnapshot());const restored=SmallBattle.fromSnapshot(JSON.parse(snapshot));
 document.getElementById('app').innerHTML=renderTacticalBattle(b,view);
 const observation=await new TavernJevAdapter(b,'ally','browser',0,new AbortController().signal).observe();
 window.mapFacts={cells:f.generation.landmark.cells,summary:smallStateSummary(b),observation,restored:JSON.stringify(restored.toSnapshot())===snapshot,
   blockers:f.tiles.flatMap((t,p)=>t==='wall'?[{cell:p,name:terrainName(f,p)}]:[]),snapshot};
};
document.addEventListener('click',e=>{const el=e.target.closest('[data-action="grid-cell"]');if(el){selectTacticalElement(b,view,{cell:Number(el.dataset.cell)});document.getElementById('app').innerHTML=renderTacticalBattle(b,view);window.inspectionUnchanged=JSON.stringify(b.toSnapshot())===window.mapFacts.snapshot;}});
window.loadMap().then(()=>{ window.fixtureReady=true; });
`);
await build({ configFile: false, root: app, logLevel: 'warn', build: { outDir: path.join(app, 'dist'), emptyOutDir: true } });
const root = path.join(app, 'dist');
const server = http.createServer((req, res) => {
  try {
    const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const results = [], errors = [];
let browser;
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS ' + name); };
try {
  browser = await chromium.launch({ ...(process.env.TB_BROWSER ? { executablePath: process.env.TB_BROWSER } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.fixtureReady);
  const facts = await page.evaluate(() => window.mapFacts);
  check('地标实际足迹与地图标记数量相同', await page.locator('.grid-landmark').count() === facts.cells.length);
  check('地图详情显示剧情名称与实际地形', (await page.locator('.map-inspector').innerText()).includes('废弃钟楼'));
  check('战况和JEV观测使用同一个名称', facts.summary.includes('废弃钟楼') && JSON.stringify(facts.observation).includes('废弃钟楼'));
  check('保存恢复保留真实格子和地标', facts.restored);
  await page.locator('[data-action="grid-cell"][data-cell="' + facts.cells.at(-1) + '"]').click();
  check('点选地标不会改写战斗事实', await page.evaluate(() => window.inspectionUnchanged));
  await page.screenshot({ path: path.join(out, 'desktop-landmark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  check('手机视口仍有地标与可滚动地图', await page.locator('.map-landmark').isVisible() && await page.locator('.grid-camera').isVisible());
  await page.screenshot({ path: path.join(out, 'mobile-landmark.png'), fullPage: true });
  for (const [env, name] of [['plains', '巨石'], ['forest', '密林障碍'], ['mountain', '岩障']]) {
    await page.evaluate(e => window.loadMap(e), env);
    const blockers = await page.evaluate(() => window.mapFacts.blockers);
    check(env + '硬障碍使用自然名称而不是建筑墙体', blockers.every(b => b.name === name));
    if (blockers.length) {
      await page.locator('[data-action="grid-cell"][data-cell="' + blockers[0].cell + '"]').click();
      check(env + '障碍详情明确阻路与直射遮挡规则', (await page.locator('.map-inspector').innerText()).includes('阻挡地面通行与地面直射'));
    }
  }
  check('没有浏览器运行错误', errors.length === 0);
} catch (e) { errors.push(String(e)); process.exitCode = 1; console.error(e); }
finally {
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ status: process.exitCode ? 'failed' : 'passed', realHost: false, realModel: false, results, errors }, null, 2) + '\n');
  await browser?.close(); server.close();
}

import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({
  server: { port: 5187, strictPort: true, host: '127.0.0.1' },
  plugins: [{
    name: 'photo-hand-fixture', enforce: 'pre',
    load(id) {
      if (id.replaceAll('\\', '/').endsWith('/features/photos/api.js')) return `
        const photos = Array.from({length:7}, (_,i)=>({id:String(i),category:'general',original_filename:'Photo '+i}));
        export async function requestAssetPhoto(body) {
          if(body.action==='list') return {photos};
          if(body.action==='create_download') return {url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="hsl('+Number(body.photoId)*45+' 35% 60%)"/><text x="240" y="450" font-size="100">'+body.photoId+'</text></svg>')};
          window.__photoWrites=(window.__photoWrites||0)+1; return {};
        }`;
    },
    configureServer(vite) {
      vite.middlewares.use('/__photo-hand', async (_req,res) => {
        res.setHeader('Content-Type','text/html');
        res.end(await vite.transformIndexHtml('/__photo-hand',`<html><body><div id="root"></div><script type="module">
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {AssetPhotoPicker} from '/src/features/photos/AssetPhotoPicker.jsx';
          import '/src/styles.css';
          createRoot(document.getElementById('root')).render(React.createElement(AssetPhotoPicker,{asset:{identityId:'fixture',name:'Animation check'},onClose:()=>{}}));
        </script></body></html>`));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage({viewport:{width:1864,height:884}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5187/__photo-hand');
  const hand=page.locator('.asset-photo-hand');
  await hand.locator('button').first().waitFor();
  await page.getByRole('button',{name:'管理照片',exact:true}).click();
  await page.mouse.move(100,300);
  await page.waitForTimeout(250);
  const slots=await hand.locator('button').evaluateAll(cards=>cards.map(c=>({x:c.parentElement.getBoundingClientRect().left+c.offsetLeft+c.offsetWidth/2,y:c.parentElement.getBoundingClientRect().top+c.offsetTop+80})));
  const card=page.locator('[data-photo-card-id="3"]');
  await page.mouse.move(slots[3].x,slots[3].y);
  await page.waitForTimeout(180);
  const hoverSlots=await hand.locator('button').evaluateAll(cs=>cs.map(c=>c.parentElement.getBoundingClientRect().left+c.offsetLeft+c.offsetWidth/2));
  assert.deepEqual(hoverSlots,slots.map(s=>s.x),'Hover must not change layout or card spacing');
  await page.evaluate(()=>document.addEventListener('pointerdown',event=>{window.__dragPointer=event.pointerId;},{once:true}));
  await page.mouse.down();
  await page.mouse.move(slots[5].x,slots[5].y,{steps:12});
  await page.waitForTimeout(30);
  assert.equal(await card.evaluate(c=>getComputedStyle(c).opacity),'0','Dragged source must be invisible');
  assert.equal(await card.evaluate(c=>getComputedStyle(c).animationName),'none','No deal animation during reorder');
  assert.ok(await hand.locator('button').evaluateAll(cs=>cs.some(c=>c.getAnimations().some(a=>a.effect.getKeyframes().some(k=>'translate' in k)))),'Rightward reorder must animate');
  await page.mouse.move(slots[1].x,slots[1].y,{steps:12});
  await page.waitForTimeout(30);
  assert.ok(await hand.locator('button').evaluateAll(cs=>cs.some(c=>c.getAnimations().some(a=>a.effect.getKeyframes().some(k=>'translate' in k)))),'Leftward reorder must animate');
  const ids=()=>hand.locator('button').evaluateAll(cs=>cs.map(c=>c.dataset.photoCardId));
  const stable=await ids();
  for(let i=0;i<12;i++) await page.mouse.move(slots[1].x+(i%2?2:-2),slots[1].y);
  assert.deepEqual(await ids(),stable,'Small pointer jitter must not reorder cards');
  for (const index of [6,0,6,0,6,0]) {
    await page.mouse.move(slots[index].x,slots[index].y,{steps:3});
    await page.waitForTimeout(40);
    assert.ok(await hand.evaluate(el=>el.hasPointerCapture(window.__dragPointer)),'Stable hand keeps pointer capture across DOM reorders');
    assert.equal((await ids())[index],'3',`Fast direction changes must track the dragged card at ${index}: ${await ids()}`);
    assert.equal(await hand.locator('.is-hovered').count(),0,'Drag must not activate neighbouring hover');
  }
  await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.__photoWrites||0),0,'Dragging must not save');
  await page.mouse.move(100,300);
  await page.waitForTimeout(250);
  await card.focus(); await page.keyboard.press('ArrowUp');
  const preview=page.locator('.asset-photo-return'); await preview.waitFor();
  await page.waitForTimeout(650);
  const rect=await preview.boundingBox();
  const point={x:rect.x+rect.width/2,y:rect.y+rect.height*.85};
  assert.ok(await page.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.asset-photo-return'),point),'Lower preview must receive clicks');
  await page.mouse.click(point.x,point.y);
  await page.waitForTimeout(550);
  assert.equal(await preview.count(),0,'Clicking lower preview returns photo');
  await page.mouse.move(slots[2].x,slots[2].y+80);
  await page.waitForTimeout(250);
  const hoverSnapshot=()=>hand.locator('button').evaluateAll(cs=>cs.map(c=>({hover:c.classList.contains('is-hovered'),transform:getComputedStyle(c).transform})));
  const settled=await hoverSnapshot();
  await page.waitForTimeout(300);
  assert.deepEqual(await hoverSnapshot(),settled,'Stationary pointer must not oscillate hover');
  const weights=await hand.locator('button').evaluateAll(cs=>cs.map(c=>parseFloat(c.style.getPropertyValue('--dock-lift'))||0));
  assert.equal(weights.filter(weight=>weight<0).length,1,'Only the hovered card lifts; neighbours keep the symmetric fan');
  await page.getByRole('button',{name:'完成並儲存',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__photoWrites||0),1,'Done saves the draft exactly once');
  assert.deepEqual(errors,[]);
  console.log('Photo hand browser checks passed: both reorder directions, invisible source, boundary jitter, deferred saving, lower-preview click.');
} finally {
  await browser?.close(); await server.close();
}

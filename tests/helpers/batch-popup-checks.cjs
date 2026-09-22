const assert = require('node:assert/strict');

module.exports = async ({win, click, waitFor, setValue}) => {
  const evaluate = code => win.webContents.executeJavaScript(code);
  await click('.batch-selection-trigger');
  for (const [width,height] of [[1600,1000],[1280,720],[1100,650]]) {
    win.setSize(width,height);
    await new Promise(resolve => setTimeout(resolve,250));
    const count = await evaluate(`document.querySelectorAll('.batch-panel .registry-trigger, .batch-panel .tag-editor-trigger').length`);
    assert.equal(count,4);
    for (let i=0;i<count;i++) {
      const layout = () => evaluate(`(()=>{const panel=document.querySelector('.batch-panel-scroll'), button=document.querySelectorAll('.batch-panel .registry-trigger, .batch-panel .tag-editor-trigger')[${i}], field=button.closest('.album-input-wrap, .controlled-tag-editor');return [field.offsetHeight, document.querySelector('.batch-actions').getBoundingClientRect().top-panel.getBoundingClientRect().top+panel.scrollTop];})()`);
      const before = await layout();
      await evaluate(`document.querySelectorAll('.batch-panel .registry-trigger, .batch-panel .tag-editor-trigger')[${i}].click()`);
      await waitFor(`Boolean(document.querySelector('.batch-panel .selection-dropdown'))`);
      assert.deepEqual(await layout(),before,'Dropdown does not expand the input or move following fields');
      assert.equal(await evaluate(`(()=>{const menu=document.querySelector('.batch-panel .selection-dropdown'),panel=document.querySelector('.batch-panel-scroll');const m=menu.getBoundingClientRect(),p=panel.getBoundingClientRect();return getComputedStyle(menu).position==='absolute' && m.top>=p.top-1 && (m.bottom<=p.bottom+1 || m.height>p.height);})()`),true,'Opening reveals the menu within the panel');
      await evaluate(`document.querySelector('.batch-panel .selection-dropdown input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
      await waitFor(`!document.querySelector('.batch-panel .selection-dropdown')`);
      assert.equal(await evaluate(`Boolean(document.querySelector('.batch-panel'))`),true);
    }
  }
  win.setSize(1600,950);
  await new Promise(resolve=>setTimeout(resolve,250));
  await click('.batch-panel .location-picker .registry-trigger');
  await setValue('.batch-panel .location-dropdown-search','Location');
  assert.equal(await evaluate(`(()=>{const e=document.querySelector('.batch-panel .location-dropdown-scroll');return e.scrollHeight>e.clientHeight;})()`),true);
  assert.equal(await evaluate(`document.querySelector('.batch-actions').getBoundingClientRect().top<document.querySelector('.batch-panel .location-dropdown').getBoundingClientRect().bottom`),true,'Dropdown overlays following controls');
  await setValue('.batch-panel .location-dropdown-search','Beach');
  await evaluate(`Array.from(document.querySelectorAll('.batch-panel .location-tree-location-label')).find(e=>e.textContent.includes('Beach')).click()`);
  await waitFor(`!document.querySelector('.batch-panel .selection-dropdown')`);
  assert.equal(await evaluate(`document.querySelector('.batch-panel .location-picker .registry-trigger').textContent.includes('Beach')`),true);
  await click('.batch-panel .location-picker [data-tip="Create location"]');
  await click('.batch-panel .location-parent-trigger');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.batch-panel .location-parent-picker .tag-dropdown')).position`),'absolute');
  await evaluate(`document.querySelector('.batch-panel .tag-create-actions .btn').scrollIntoView({block:'nearest'})`);
  assert.equal(await evaluate(`(()=>{const b=document.querySelector('.batch-panel .tag-create-actions .btn').getBoundingClientRect(),p=document.querySelector('.batch-panel-scroll').getBoundingClientRect();return b.top>=p.top && b.bottom<=p.bottom+1;})()`),true,'Creation actions remain reachable');
  await click('.batch-panel .tag-create-actions .btn');
  await waitFor(`!document.querySelector('.batch-panel .tag-create-popover')`);
  await click('.batch-panel .location-picker .registry-trigger');
  await setValue('.batch-panel .location-dropdown-search','Location');
  await evaluate(`document.querySelector('.batch-panel .location-dropdown').scrollIntoView({block:'nearest'})`);
  await new Promise(resolve=>setTimeout(resolve,150));
  await require('node:fs/promises').writeFile(require('node:path').resolve('release/batch-panel-v0388.png'),(await win.webContents.capturePage()).toPNG());
  await evaluate(`document.body.click()`);
  await waitFor(`!document.querySelector('.batch-panel .selection-dropdown')`);
  console.log('BATCH_POPUP_CHECKS_PASS: overlay layout, four pickers, window sizes, keyboard dismissal, long lists, selection and creation.');
};

module.exports.prepare = async library => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { randomUUID } = require('node:crypto');
  const stamp = new Date().toISOString();
  const rows = Array.from({length:40},(_,i)=>({LocationId:randomUUID(),Name:`Location ${i}`,Description:'',Country:'Country',Province:'',City:'',ParentId:null,CreatedAt:stamp,UpdatedAt:stamp}));
  await fs.appendFile(path.join(library,'.photo_manager','data','location_registry.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
};

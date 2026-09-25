const assert = require('node:assert/strict');
module.exports = async ({win, click, waitFor, setValue}) => {
  const evaluate = s => win.webContents.executeJavaScript(s);
  const menu = async label => {
    await click('.gallery-settings-trigger');
    await evaluate(`[...document.querySelectorAll('.gallery-settings-menu button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
  };
  await menu('Manage Tags');
  await waitFor(`Boolean(document.querySelector('.tag-manager-modal:modal'))`);
  await evaluate(`document.querySelector('.tag-manager-modal [data-tip="Create tag"]').focus()`);
  await click('.tag-manager-modal [data-tip="Create tag"]');
  await waitFor(`document.querySelectorAll('dialog:modal').length === 2`);
  assert.equal(await evaluate(`document.activeElement.closest('dialog').classList.contains('registry-create-modal')`), true);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  assert.equal(await evaluate(`document.querySelectorAll('dialog:modal').length`), 2);
  await click('.registry-create-modal .modal-close-btn');
  await waitFor(`document.querySelectorAll('dialog:modal').length === 1`);
  assert.equal(await evaluate(`document.activeElement.dataset.tip`), 'Create tag');
  await click('.tag-manager-modal [data-tip="Create tag"]');
  await waitFor(`document.querySelectorAll('dialog:modal').length === 2`);
  await evaluate(`document.querySelector('.registry-create-modal').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:0,clientY:0}))`);
  await waitFor(`document.querySelectorAll('dialog:modal').length === 1`);
  // Focus cannot move into the inert gallery underneath the manager.
  await evaluate(`document.querySelector('.gallery-settings-trigger').focus()`);
  assert.equal(await evaluate(`Boolean(document.activeElement.closest('dialog'))`), true);
  await click('.tag-manager-modal .modal-close-btn');
  await menu('Library Information');
  await waitFor(`Boolean(document.querySelector('.library-info-modal:modal'))`);
  const surface = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.library-info-modal'));return [s.borderRadius,s.padding,s.color]})()`);
  await click('.library-info-modal .modal-close-btn');
  await menu('LLM Provider Settings');
  await waitFor(`Boolean(document.querySelector('.provider-dialog:modal'))`);
  assert.deepEqual(await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.provider-dialog'));return [s.borderRadius,s.padding,s.color]})()`),surface);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await waitFor(`!document.querySelector('.provider-dialog')`);
  console.log('DIALOG_SHELL_SMOKE_PASS: shared surface, nested dialogs, focus restoration, inert background and per-owner Escape policies.');
};

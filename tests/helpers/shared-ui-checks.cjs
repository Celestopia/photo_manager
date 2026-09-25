const assert = require('node:assert/strict');
module.exports = async ({win, click, waitFor, setValue}) => {
  const evaluate = s => win.webContents.executeJavaScript(s);
  const menu = async label => {
    await click('.gallery-settings-trigger');
    await evaluate(`[...document.querySelectorAll('.gallery-settings-menu button')].find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`);
  };
  for (const [kind, plural] of [['tag','Tags'],['person','People'],['album','Albums']]) {
    await menu('Manage '+plural);
    await click(`[data-tip="Create ${kind}"]`);
    await waitFor(`Boolean(document.querySelector('.registry-create-modal input'))`);
    await setValue('.registry-create-modal input','Shared '+kind+' 北京');
    if (kind === 'album') {
      await click('.registry-create-modal .btn-primary');
      assert.equal(await evaluate(`document.querySelector('.tag-create-error').textContent.includes('description')`),true);
    }
    await setValue('.registry-create-modal textarea','Case Sensitive Description');
    await click('.registry-create-modal .btn-primary');
    await waitFor(`!document.querySelector('.registry-create-modal')`);
    await setValue('.tag-manager-search','shared '+kind);
    await waitFor(`document.querySelectorAll('.tag-manager-item').length===1`);
    await click('.tag-manager-item .tag-manager-actions .btn');
    await setValue('.registry-manager-edit input','Updated '+kind+' 北京');
    await evaluate(`document.querySelector('.registry-manager-edit textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await waitFor(`!document.querySelector('.registry-manager-edit')`);
    await setValue('.tag-manager-search','UPDATED '+kind);
    await waitFor(`document.querySelectorAll('.tag-manager-item').length===1`);
    assert.equal(await evaluate(`document.querySelector('.tag-manager-item strong').textContent`),'Updated '+kind+' 北京');
    await click('.tag-manager-modal .modal-close-btn');
  }
  await menu('Manage Locations');
  await click('[data-tip="Create location"]');
  await waitFor(`Boolean(document.querySelector('.registry-create-modal input'))`);
  await setValue('.registry-create-modal input','Shared Location 北京');
  await click('.registry-create-modal .location-parent-trigger');
  await setValue('.registry-create-modal .dropdown-search-input','beach');
  await waitFor(`Boolean([...document.querySelectorAll('.registry-create-modal button.location-tree-label')].find(x=>x.textContent.includes('Beach')))`);
  await evaluate(`[...document.querySelectorAll('.registry-create-modal button.location-tree-label')].find(x=>x.textContent.includes('Beach')).click()`);
  assert.equal(await evaluate(`document.querySelector('.registry-create-modal .location-parent-trigger').textContent.includes('Beach')`),true);
  await click('.registry-create-modal .btn-primary');
  await waitFor(`!document.querySelector('.registry-create-modal')`);
  await setValue('.tag-manager-search','SHARED LOCATION');
  await waitFor(`Boolean([...document.querySelectorAll('.location-manager-item strong')].find(x=>x.textContent.includes('Shared Location')))`);
  await click('.tag-manager-modal .modal-close-btn');
  await click('.photo-card');
  await waitFor(`Boolean(document.querySelector('.viewer-sidebar-tabs'))`);
  // Creation popovers use the same fields without turning Ctrl+Enter into a save shortcut.
  await click('.tag-picker [data-tip="Create tag"]');
  await setValue('.tag-create-popover input','Popup tag');
  assert.equal(await evaluate(`document.querySelector('.tag-create-popover textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`),true);
  await click('.tag-create-popover .btn-primary');
  await waitFor(`!document.querySelector('.tag-create-popover')`);
  await waitFor(`[...document.querySelectorAll('.tag-chip')].some(x=>x.textContent.includes('Popup tag'))`);
  await evaluate(`[...document.querySelectorAll('.viewer-sidebar-tabs button')].find(b=>b.textContent.includes('Assistant')).click()`);
  await waitFor(`Boolean(document.querySelector('.chat-header [data-tip="Provider settings"]'))`);
  await evaluate(`document.querySelector('.chat-header [data-tip="Provider settings"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
  await waitFor(`Boolean(document.querySelector('.dynamic-tooltip:popover-open'))`);
  assert.equal(await evaluate(`document.querySelector('.dynamic-tooltip').textContent`),'Provider settings');
  console.log('SHARED_UI_SMOKE_PASS: registry fields, required descriptions, Unicode, search, edit shortcuts, parent selection, picker creation and styled Assistant tooltips.');
};



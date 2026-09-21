const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ win, library, click, waitFor, setValue }) => {
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  const menu = async label => {
    await click('.gallery-settings-trigger');
    await evaluate(`Array.from(document.querySelectorAll('.gallery-settings-menu button')).find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
  };
  const capture = async name => {
    await new Promise(resolve => setTimeout(resolve, 200));
    await fs.writeFile(path.resolve(`release/${name}-v0383.png`), (await win.webContents.capturePage()).toPNG());
  };
  await menu('Library Information');
  await waitFor(`Boolean(document.querySelector('.library-name-text'))`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#library-name'))`), false);
  assert.equal(await evaluate(`document.querySelector('.library-info-modal .btn-primary').disabled`), true);
  assert.equal(await evaluate(`Boolean(document.querySelector('.library-info-modal details'))`), false);
  await click('[aria-label="Edit library name"]');
  await waitFor(`document.activeElement?.id === 'library-name'`);
  const originalName = await evaluate(`document.querySelector('#library-name').value`);
  await setValue('#library-name', '   ');
  assert.equal(await evaluate(`document.querySelector('.library-info-modal .btn-primary').disabled`), true);
  await setValue('#library-name', originalName + ' renamed');
  assert.equal(await evaluate(`document.querySelector('.library-info-modal .btn-primary').disabled`), false);
  await click('[aria-label="Finish editing library name"]');
  assert.equal(await evaluate(`document.querySelector('.library-name-text').textContent`), originalName + ' renamed');
  assert.equal(await evaluate(`Boolean(document.querySelector('#library-name'))`), false);
  await click('[aria-label="Edit library name"]');
  assert.equal(await evaluate(`document.querySelector('#library-name').value`), originalName + ' renamed');
  await setValue('#library-name', originalName);
  assert.equal(await evaluate(`document.querySelector('.library-info-modal .btn-primary').disabled`), true);
  await click('[aria-label="Finish editing library name"]');
  assert.equal(await evaluate(`document.querySelector('.library-statistics strong').textContent`), '2');
  await capture('library-information');
  await click('.library-info-modal .modal-close-btn');

  await menu('Verify Metadata');
  await waitFor(`Boolean(document.querySelector('.maintenance-options'))`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.library-dialog-context'))`), false);
  assert.equal(await evaluate(`document.querySelector('.maintenance-options .btn-primary').textContent`), 'Verify metadata');
  await capture('library-verify-options');
  await click('.maintenance-options .btn-primary');
  await waitFor(`Boolean(document.querySelector('.maintenance-result-actions'))`);
  assert.equal(await evaluate(`document.querySelector('.maintenance-summary').textContent`), '2 media checked · No issues found');
  assert.equal(await evaluate(`document.querySelector('.maintenance-progress details').open`), false);
  await capture('library-verify-complete');
  await click('.maintenance-result-actions .btn-primary');

  // Delete only the fixture's own media, then verify that reported issues are exposed.
  await fs.unlink(path.join(library, 'second.jpg'));
  await menu('Verify Metadata');
  await click('.maintenance-options .btn-primary');
  await waitFor(`Boolean(document.querySelector('.maintenance-result-actions'))`);
  assert.equal(await evaluate(`document.querySelector('.maintenance-progress details').open`), true);
  assert.match(await evaluate(`document.querySelector('.maintenance-summary').textContent`), /Review the detailed report/);
  await click('.maintenance-result-actions .btn-primary');

  for (const [label, action] of [['Update Metadata', 'Update metadata'], ['Generate Thumbnails', 'Generate thumbnails'], ['Generate Video Covers', 'Generate covers'], ['Export Metadata CSV', 'Export CSV']]) {
    await menu(label);
    await waitFor(`Boolean(document.querySelector('.maintenance-options'))`);
    assert.equal(await evaluate(`document.querySelector('.maintenance-options .btn-primary').textContent`), action);
    await click('.maintenance-modal .modal-close-btn');
  }
  win.setContentSize(1000, 760);
  await menu('Library Information');
  await waitFor(`Boolean(document.querySelector('.library-name-text'))`);
  assert.equal(await evaluate(`document.querySelector('.library-info-modal').scrollWidth <= document.querySelector('.library-info-modal').clientWidth`), true);
  await capture('library-information-narrow');
  await click('.library-info-modal .modal-close-btn');
  console.log('LIBRARY_UI_SMOKE_PASS: name validation, facts, action labels, clean and warning reports, narrow layout, unchanged metadata.');
};

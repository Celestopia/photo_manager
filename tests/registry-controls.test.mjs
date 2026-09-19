import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRenderer } from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { LOCATION_CONTEXT } from '../src/renderer/context/renderer-contexts.js';

async function mount(t, filename, props) {
  const url = new URL('../src/renderer/components/' + filename, import.meta.url);
  const { descriptor } = parse(await readFile(url, 'utf8'));
  let code = compileScript(descriptor, { id: filename, inlineTemplate: true }).content;
  code = code.replace(/from (["'])([^"']+)\1/g, (_, quote, source) => `from ${quote}${source === 'vue' ? import.meta.resolve('vue') : new URL(source, url).href}${quote}`);
  const component = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default;
  const node = (type, text = '') => ({ type, text, children: [], props: {}, focus() {} });
  const renderer = createRenderer({
    createElement: node, createText: text => node('text', text), createComment: text => node('comment', text),
    setText: (target, text) => { target.text = text; }, setElementText: (target, text) => { target.text = text; },
    patchProp: (target, key, previous, value) => { target.props[key] = value; },
    insert: (child, parent) => { child.parent = parent; parent.children.push(child); }, remove() {},
    parentNode: target => target.parent, nextSibling: () => null,
  });
  const app = renderer.createApp(component, props);
  app.provide(LOCATION_CONTEXT, { ICONS: { chevronDown: '' }, getLocationTooltip: () => '' });
  const root = node('root'); app.mount(root); t.after(() => app.unmount());
  function all(target) { return [target, ...target.children.flatMap(all)]; }
  return all(root);
}

for (const filename of ['RegistryOptionsMenu.vue', 'LocationTreeMenu.vue']) {
  test(`${filename} uses semantic click activation and preserves IME composition`, async t => {
    const selected = [];
    const props = filename === 'RegistryOptionsMenu.vue'
      ? { options: [{ Id: 'one', Name: 'One' }], idKey: 'Id', labelKey: 'Name', emptyText: 'Empty', onSelect: value => selected.push(value) }
      : { rows: [{ Type: 'location', Key: 'one', Label: 'One', Depth: 0, Location: { LocationId: 'one' } }], onSelectLocation: value => selected.push(value) };
    const nodes = await mount(t, filename, props);
    const button = nodes.find(node => node.type === 'button'), input = nodes.find(node => node.type === 'input');
    const event = { preventDefault() {}, stopPropagation() {} };
    button.props.onMousedown(event); assert.deepEqual(selected, []);
    button.props.onClick(event); assert.deepEqual(selected, ['one']);
    // Browser keyboard activation reaches the same semantic button click handler.
    button.props.onClick({ ...event, detail: 0 }); assert.deepEqual(selected, ['one', 'one']);
    input.props.onKeydown({ ...event, key: 'Enter', isComposing: true });
    input.props.onKeydown({ ...event, key: 'Enter', keyCode: 229 }); assert.equal(selected.length, 2);
    input.props.onKeydown({ ...event, key: 'Enter', isComposing: false }); assert.equal(selected.length, 3);
  });
}

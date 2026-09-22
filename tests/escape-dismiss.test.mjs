import test from 'node:test';
import assert from 'node:assert/strict';
import dismiss from '../src/renderer/directives/escape-dismiss.mjs';

test('Escape dismisses one popup, restores focus, guards composition and cleans up', () => {
  let handler, focused = 0, parentClosed = 0, childClosed = 0;
  const trigger = { isConnected: true, closest: () => null, focus() { focused++; } };
  const document = { activeElement: trigger, addEventListener(name, fn) { handler = fn; }, removeEventListener(name, fn) { assert.equal(handler, fn); handler = null; } };
  const parent = { ownerDocument: document }, child = { ownerDocument: document };
  dismiss.beforeMount(parent, { value: () => { parentClosed++; dismiss.unmounted(parent); } });
  dismiss.beforeMount(child, { value: () => { childClosed++; dismiss.unmounted(child); } });
  const event = overrides => ({ key: 'Escape', preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides });
  for (const ignored of [{key:'Enter'}, {repeat:true}, {isComposing:true}, {keyCode:229}, {defaultPrevented:true}]) handler(event(ignored));
  assert.equal(childClosed, 0);
  document.activeElement = { closest: () => ({ contains: () => false }) };
  handler(event());
  assert.equal(childClosed, 0, 'Do not dismiss a popup behind an active dialog');
  document.activeElement = trigger;
  const first = event(); handler(first);
  assert.equal(childClosed, 1); assert.equal(parentClosed, 0);
  assert.equal(focused, 1); assert.ok(first.defaultPrevented && first.stopped);
  handler(event());
  assert.equal(parentClosed, 1); assert.equal(focused, 2); assert.equal(handler, null);
});

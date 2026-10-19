import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../../src/lib/horizontalDrag.ts', import.meta.url), 'utf8');
const module = {exports: {}};
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText)(module, module.exports);
const {installHorizontalDrag} = module.exports;

function fixture() {
  const listeners = new Map();
  const classes = new Set();
  let capture = null;
  const element = {
    scrollLeft: 120,
    classList: {add: v => classes.add(v), remove: v => classes.delete(v)},
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
    setPointerCapture: id => {capture = id},
    hasPointerCapture: id => capture === id,
    releasePointerCapture: () => {capture = null},
  };
  const cleanup = installHorizontalDrag(element);
  const fire = (name, values = {}) => {
    const event = {pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1,
      clientX: 200, clientY: 100, detail: 1, target: {closest: () => null},
      prevented: false, stopped: false,
      preventDefault() {this.prevented = true}, stopPropagation() {this.stopped = true}, ...values};
    listeners.get(name)?.(event);
    return event;
  };
  return {element, classes, listeners, cleanup, fire};
}

test('horizontal mouse dragging scrolls without opening a card; the next click still works', () => {
  const {element, fire, cleanup, classes, listeners} = fixture();
  fire('pointerdown');
  assert.equal(fire('pointermove', {clientX: 196}).prevented, false);
  assert.equal(element.scrollLeft, 120);
  assert.equal(fire('pointermove', {clientX: 150}).prevented, true);
  assert.equal(element.scrollLeft, 170);
  fire('pointerup', {buttons: 0});
  assert.equal(classes.size, 0);
  assert.equal(fire('click').stopped, true);
  fire('pointerdown'); fire('pointerup', {buttons: 0});
  assert.equal(fire('click').stopped, false);
  cleanup(); assert.equal(listeners.size, 0);
});

test('touch, vertical gestures, and nested controls retain their native behavior', () => {
  for (const down of [{pointerType: 'touch'}, {target: {closest: () => ({})}}]) {
    const {element, fire, cleanup} = fixture();
    fire('pointerdown', down);
    assert.equal(fire('pointermove', {clientX: 100}).prevented, false);
    assert.equal(element.scrollLeft, 120); cleanup();
  }
  const {element, fire, cleanup} = fixture();
  fire('pointerdown');
  assert.equal(fire('pointermove', {clientX: 190, clientY: 170}).prevented, false);
  assert.equal(element.scrollLeft, 120); cleanup();
});

test('lost mouse buttons and cancelled drags cannot stick or swallow keyboard activation', () => {
  const {element, fire, classes, cleanup} = fixture();
  fire('pointerdown'); fire('pointermove', {clientX: 150});
  fire('pointermove', {buttons: 0, clientX: 120});
  assert.equal(element.scrollLeft, 170);
  assert.equal(classes.size, 0);
  assert.equal(fire('click', {detail: 0}).stopped, false);
  fire('pointerdown'); fire('pointermove', {clientX: 150});
  fire('pointercancel'); assert.equal(classes.size, 0);
  cleanup();
});

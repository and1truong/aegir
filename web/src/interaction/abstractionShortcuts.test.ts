import assert from 'node:assert/strict';
import test from 'node:test';
import { abstractionShortcutForEvent, abstractionShortcutStatus, abstractionShortcuts } from './abstractionShortcuts.ts';

test('maps four explicit abstraction shortcuts without overloading wheel navigation', () => {
  assert.deepEqual(Object.keys(abstractionShortcuts).map((key) => abstractionShortcuts[key].level), ['service', 'component', 'package', 'symbol']);
  assert.equal(abstractionShortcutForEvent({ key: '1' })?.level, 'service');
  assert.equal(abstractionShortcutForEvent({ key: '4' })?.label, 'Execution detail');
  assert.equal(abstractionShortcutForEvent({ key: 'Wheel' }), undefined);
  assert.equal(abstractionShortcutStatus, 'prototype');
});

test('ignores shortcuts while typing or using browser and editor modifiers', () => {
  for (const event of [
    { key: '1', target: { tagName: 'INPUT' } },
    { key: '2', target: { tagName: 'textarea' } },
    { key: '3', target: { tagName: 'select' } },
    { key: '4', target: { isContentEditable: true } },
    { key: '1', metaKey: true },
    { key: '2', ctrlKey: true },
    { key: '3', altKey: true },
  ]) assert.equal(abstractionShortcutForEvent(event), undefined);
});


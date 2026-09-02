import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysNode } from '../data/types';
import { filterSymbols } from './symbolFilter.ts';

const nodes: SysNode[] = [
  { id: 'exported', kind: 'function', label: 'Exported', file: 'main.go:1', meta: { exported: true } },
  { id: 'private', kind: 'function', label: 'private', file: 'main.go:2', meta: { exported: false } },
  { id: 'package', kind: 'package', label: 'example/package' },
];

test('hides private symbols by default without hiding nodes lacking export metadata', () => {
  assert.deepEqual(filterSymbols(nodes, '', false).map((node) => node.id), ['exported', 'package']);
});

test('shows private symbols when requested and still applies the text filter', () => {
  assert.deepEqual(filterSymbols(nodes, 'main.go', true).map((node) => node.id), ['exported', 'private']);
});

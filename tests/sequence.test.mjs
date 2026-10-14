import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const compiled = ts.transpileModule(readFileSync(new URL('../src/sequence.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const { sequenceLayout, frameRect, advanceFrame } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const settings = { rows: '2', columns: '3', mode: 'all', row: '1', start: '1', end: '6' };

test('row-major grid rectangles cover horizontal, vertical and multiple rows', () => {
  assert.deepEqual(frameRect(4, 3, 32, 32), { x: 32, y: 32, width: 32, height: 32 });
  assert.deepEqual(frameRect(2, 1, 16, 24), { x: 0, y: 48, width: 16, height: 24 });
  assert.deepEqual(frameRect(2, 4, 16, 24), { x: 32, y: 0, width: 16, height: 24 });
  const layout = sequenceLayout(96, 64, settings);
  assert.equal(layout.width, 32);
  assert.equal(layout.height, 32);
  assert.equal(layout.count, 6);
});
test('single row and inclusive custom range use one-based inputs', () => {
  const row = sequenceLayout(96, 64, { ...settings, mode: 'row', row: '2' });
  assert.equal(row.start, 3); assert.equal(row.end, 5); assert.equal(row.count, 3);
  const custom = sequenceLayout(96, 64, { ...settings, mode: 'custom', start: '2', end: '4' });
  assert.equal(custom.start, 1); assert.equal(custom.end, 3); assert.equal(custom.count, 3);
  assert.equal(sequenceLayout(96, 64, { ...settings, mode: 'custom', start: '3', end: '3' }).count, 1);
});
test('reject invalid dimensions, non-divisible cells and ranges', () => {
  for (const rows of ['', '0', '-1', '1.5', 'Infinity']) assert.ok(sequenceLayout(96, 64, { ...settings, rows }).error);
  assert.ok(sequenceLayout(97, 64, settings).error);
  assert.ok(sequenceLayout(96, 65, settings).error);
  assert.ok(sequenceLayout(0, 0, settings).error);
  for (const row of ['0', '3', '1.5']) assert.ok(sequenceLayout(96, 64, { ...settings, mode: 'row', row }).error);
  for (const [start, end] of [['4', '3'], ['1', '7'], ['0', '2'], ['1.5', '2']]) {
    assert.ok(sequenceLayout(96, 64, { ...settings, mode: 'custom', start, end }).error);
  }
});
test('loop wraps within selected range, non-loop clamps and one-frame remains stable', () => {
  assert.equal(advanceFrame(4, 2, 3, 5, true), 3);
  assert.equal(advanceFrame(4, 11, 3, 5, true), 3);
  assert.equal(advanceFrame(4, 10, 3, 5, false), 5);
  assert.equal(advanceFrame(2, 8, 2, 2, true), 2);
});

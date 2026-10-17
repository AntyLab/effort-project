import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.mjs';

test('parses simple rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('keeps commas inside quoted fields', () => {
  assert.deepEqual(parseCsv('name,city\n"Smith, Jane",Paris\n'), [['name', 'city'], ['Smith, Jane', 'Paris']]);
});

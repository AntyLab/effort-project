import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.mjs';

test('plain rows, with or without a final line break', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('quoted fields may contain commas, quotes and line breaks', () => {
  assert.deepEqual(parseCsv('id,quote\n1,"He said ""hi"", then left"\n'), [['id', 'quote'], ['1', 'He said "hi", then left']]);
  assert.deepEqual(parseCsv('a,"multi\nline",c'), [['a', 'multi\nline', 'c']]);
  assert.deepEqual(parseCsv('"x\r\ny",z\r\n'), [['x\r\ny', 'z']]);
  assert.deepEqual(parseCsv('""'), [['']]);
  assert.deepEqual(parseCsv('"",""\n'), [['', '']]);
});

test('empty fields and whitespace are kept', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv(','), [['', '']]);
  assert.deepEqual(parseCsv(' a , b '), [[' a ', ' b ']]);
});

test('empty text has no records', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('an unterminated quoted field is a SyntaxError', () => {
  assert.throws(() => parseCsv('a,"b\nc'), SyntaxError);
  assert.throws(() => parseCsv('"'), SyntaxError);
});

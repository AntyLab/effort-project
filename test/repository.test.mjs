import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repositoryFacts } from '../src/repository.mjs';

test('a workspace file is not mentioned by using its name as a directory prefix', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'effort-path-end-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.ts'), '');
  for (const path of ['index.ts/child.js', 'index.ts\\child.js', 'index.ts/.config', 'index.ts\\.config']) {
    assert.equal((await repositoryFacts(dir, `Edit ${path}`)).mentionedFiles, 0, path);
  }
  for (const path of ['index.ts', '`index.ts`', 'index.ts:12', './index.ts', '.\\index.ts']) {
    assert.equal((await repositoryFacts(dir, `Edit ${path}`)).mentionedFiles, 1, path);
  }
});

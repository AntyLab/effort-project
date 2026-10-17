import { readdir, lstat } from 'node:fs/promises';
import { resolve, extname, relative, basename, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const skip = new Set(['.git', 'node_modules', '.venv', 'venv', 'vendor', 'build', 'dist', '.next', 'target', '.effort']);

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A mention starts at the beginning of the prompt or after a character that cannot be part
// of a path, and ends where the name does: neither 'packages/a/index.ts' nor 'index.tsx'
// mentions the root index.ts.
const mention = (name, flags = '') => new RegExp(`(?<![\\w.\\\\/-])${literal(name)}(?![\\w-]|\\.\\w)`, flags);

// Distinct files the prompt names: each relative path it contains, written with either
// separator, plus each remaining bare file name once. Five packages/*/index.ts named by
// path are five files; 'index.ts' alone is one, however many index.ts files exist.
function countMentioned(prompt, paths, root) {
  // Read './x' and absolute paths inside the workspace as workspace-relative paths.
  let text = prompt.replace(/(^|[^\w.])\.[\\/]/g, '$1');
  for (const spelling of new Set([root.split(sep).join('/'), root.split(sep).join('\\')])) {
    for (const separator of ['/', '\\']) text = text.split(spelling + separator).join(' ');
  }
  let rest = text, count = 0;
  for (const path of paths) {
    const spellings = [...new Set([path.split(sep).join('/'), path.split(sep).join('\\')])];
    if (!spellings.some((spelling) => mention(spelling).test(text))) continue;
    count++;
    for (const spelling of spellings) rest = rest.replace(mention(spelling, 'g'), ' ');
  }
  return count + new Set(paths.map((path) => basename(path)).filter((name) => mention(name).test(rest))).size;
}

export async function repositoryFacts(cwd, prompt = '') {
  const root = resolve(cwd);
  if (!(await lstat(root)).isDirectory()) throw new Error('Workspace must be a directory.');
  const start = performance.now();
  const languages = new Set(), paths = []; let files = 0, hasTests = false, truncated = false;
  async function walk(dir, depth) {
    if (files >= 500 || performance.now() - start > 50) { truncated = true; return; }
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (files >= 500 || performance.now() - start > 50) { truncated = true; break; }
      if (e.name.startsWith('.') || skip.has(e.name) || e.isSymbolicLink()) continue;
      const path = resolve(dir, e.name);
      if (e.isDirectory() && depth < 2) { await walk(path, depth + 1); continue; }
      if (!e.isFile()) continue;
      files++;
      const extension = extname(e.name).toLowerCase();
      const lang = ({'.js':'javascript','.mjs':'javascript','.ts':'typescript','.tsx':'typescript','.py':'python','.swift':'swift','.rs':'rust','.go':'go','.java':'java','.cpp':'cpp','.c':'c'})[extension];
      if (lang) languages.add(lang);
      const rel = relative(root, path);
      if (/test|spec/i.test(rel)) hasTests = true;
      if (prompt.includes(e.name)) paths.push(rel);
    }
  }
  await walk(root, 0);
  return { languages: [...languages].sort(), scannedFiles: files, mentionedFiles: countMentioned(prompt, paths, root), hasTests, truncated };
}

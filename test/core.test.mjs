import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recommend, nextDecision, classifyFailure } from '../src/policy.mjs';
import { repositoryFacts } from '../src/repository.mjs';
import { Store } from '../src/store.mjs';
import { verify } from '../src/verify.mjs';
import { runTask } from '../src/runner.mjs';

test('unknown tasks remain uncertain and mechanical requests can start low',()=>{
  assert.equal(recommend({prompt:'Do this task'}).effort,'medium');
  assert.equal(recommend({prompt:'Rename this local variable'}).effort,'low');
  assert.equal(recommend({prompt:'Rename the authentication token and migrate all permissions'}).effort,'high');
  assert.equal(recommend({prompt:'Investigate a race condition'}).confidence,'low');
});
test('repository breadth raises uncertain requests one level but never a narrow mechanical one',()=>{
  const languages=['javascript','python','typescript'];
  assert.equal(recommend({prompt:'Fix the typo in the README',facts:{languages,mentionedFiles:0}}).effort,'low');
  assert.equal(recommend({prompt:'Add a settings page',facts:{languages:['python']}}).effort,'medium');
  assert.equal(recommend({prompt:'Add a settings page',facts:{languages}}).effort,'high');
  assert.equal(recommend({prompt:'Add a settings page',facts:{languages},maxEffort:'medium'}).effort,'medium');
  // Naming many files makes even a mechanical edit broad.
  const broad=recommend({prompt:'Rename the helper in a.ts b.ts c.ts d.ts e.ts',facts:{mentionedFiles:5}});
  assert.equal(broad.effort,'high');assert.equal(broad.features.broadEdit,true);
  // Breadth never pushes past high, even when the caller allows more.
  assert.equal(recommend({prompt:'Investigate the race condition',facts:{languages,mentionedFiles:9},maxEffort:'max'}).effort,'high');
  assert.equal(recommend({prompt:'Add a settings page',facts:{languages,mentionedFiles:9},maxEffort:'max'}).effort,'high');
});
test('explicit caps and invalid inputs are respected',()=>{
  assert.equal(recommend({prompt:'Investigate concurrency',maxEffort:'medium'}).effort,'medium');
  for(const prompt of ['',null,{},'x'.repeat(100001)])assert.throws(()=>recommend({prompt}));
  assert.throws(()=>recommend({prompt:'x',minEffort:'high',maxEffort:'low'}));
  assert.throws(()=>recommend({prompt:'x',provider:'__proto__'}));
});
test('failures do not all become expensive retries',()=>{
  for(const [text,expected] of [['Error: Cannot find module x','environment'],['Operation not permitted','permission'],['Invalid API key','access'],['AssertionError expected 3 received 2','test'],['something went wrong','unknown']])assert.equal(classifyFailure(text),expected);
  for(const kind of ['access','permission','environment','timeout','unknown'])assert.equal(nextDecision({effort:'low',kind,repeatCount:3}).action,'stop');
});
test('test-runner failures win over access, permission and environment words in their output',()=>{
  const reports={
    'node:test spec':'✖ rejects unauthorized users (0.8ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n401 !== 200\n\nℹ tests 1\nℹ fail 1',
    'node:test TAP':'TAP version 13\n# Subtest: reads missing config\nnot ok 1 - reads missing config\n  ---\n  error: "ENOENT: no such file or directory, open \'config.json\'"\n  ...\n1..1\n# fail 1',
    'jest':'\x1b[1m\x1b[31m FAIL \x1b[39m\x1b[22m src/config.test.js\n  ● config › loads defaults\n\n    ENOENT: no such file or directory, open \'defaults.json\'\n\nTests:       1 failed, 1 total',
    'vitest':' FAIL  src/auth.test.ts > auth > rejects unauthorized users\nError: expected 401 to be 200\n Test Files  1 failed (1)\n      Tests  1 failed (1)',
    'pytest':'FAILED tests/test_acl.py::test_permission_denied_for_guest - assert 403 == 200\n========================= 1 failed, 3 passed in 0.12s =========================',
    'go test':'--- FAIL: TestGuestPermission (0.00s)\n    acl_test.go:12: permission denied for guest\nFAIL\nFAIL\texample.com/acl\t0.005s',
    'cargo test':'test tests::rejects_unauthorized ... FAILED\n\nfailures:\n    tests::rejects_unauthorized\n\ntest result: FAILED. 0 passed; 1 failed; 0 ignored',
  };
  for(const [runner,text] of Object.entries(reports))assert.equal(classifyFailure(text),'test',runner);
  // Without a test-runner report, the same words still stop the run.
  for(const [text,expected] of [
    ['npm ERR! code ENOENT\nnpm ERR! enoent ENOENT: no such file or directory, open \'/repo/package.json\'','environment'],
    ['============ ERRORS ============\nE   ModuleNotFoundError: No module named \'requests\'\nERROR tests/test_api.py\n============ 1 error in 0.08s ============','environment'],
    ['Error: connect ECONNREFUSED 127.0.0.1:5432','environment'],
    ['fatal: Authentication failed for \'https://example.invalid/repo.git\'','access'],
    ['EACCES: permission denied, open \'/etc/effort\'','permission'],
  ])assert.equal(classifyFailure(text),expected,text);
});
test('a real failing node test about authorization is a retryable test failure',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'effort-classify-'));
  await writeFile(join(cwd,'acl.test.cjs'),"const {test}=require('node:test');const assert=require('node:assert/strict');test('rejects unauthorized users with permission denied',()=>assert.equal(401,200));");
  const check=await verify([process.execPath,'--test','acl.test.cjs'],{cwd});
  assert.equal(check.kind,'test');assert.equal(check.status,'failed');
});
test('escalation needs repeated checks, obeys support and stops at ceiling',()=>{
  assert.equal(nextDecision({effort:'low',kind:'test'}).effort,'low');
  assert.equal(nextDecision({effort:'low',kind:'test',repeatCount:2}).effort,'medium');
  assert.equal(nextDecision({effort:'low',kind:'test',repeatCount:2,supportedLevels:['low','high']}).effort,'high');
  assert.equal(nextDecision({effort:'high',kind:'test',repeatCount:2}).action,'stop');
  assert.throws(()=>nextDecision({effort:'low',kind:'test',repeatCount:-2}));
});
test('repository metadata skips dependencies, dotfiles and symlink targets',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'effort-repo-'));
  await writeFile(join(dir,'main.py'),'secret code');
  await mkdir(join(dir,'node_modules'));await writeFile(join(dir,'node_modules','dep.swift'),'x');
  await writeFile(join(dir,'.secret.js'),'x');
  if(process.platform!=='win32')await symlink(tmpdir(),join(dir,'linked'));
  const facts=await repositoryFacts(dir,'Change main.py');
  assert.deepEqual(facts.languages,['python']);assert.equal(facts.scannedFiles,1);assert.equal(facts.mentionedFiles,1);
});
test('repository metadata counts each mentioned file name once',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'effort-mentions-'));
  await writeFile(join(dir,'index.ts'),'x');
  for(const sub of ['a','b','c','d']){await mkdir(join(dir,sub));await writeFile(join(dir,sub,'index.ts'),'x');}
  await writeFile(join(dir,'util.ts'),'x');
  assert.equal((await repositoryFacts(dir,'Fix the import in index.ts')).mentionedFiles,1);
  assert.equal((await repositoryFacts(dir,'Move util.ts into index.ts')).mentionedFiles,2);
});
test('store rejects traversal, symlink records and malformed files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'effort-store-'));const store=await new Store(dir).initialize();
  await assert.rejects(store.get('../../private'));
  const id='11111111-1111-4111-8111-111111111111';
  await store.save({id,createdAt:'2026-01-01',status:'unverified'});
  assert.equal((await store.get(id)).status,'unverified');
  await writeFile(join(dir,'22222222-2222-4222-8222-222222222222.json'),'{bad');
  assert.equal((await store.list()).length,1);
});
test('verification uses literal argv and classifies exit/errors/timeouts',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'effort-verify-'));
  const pass=await verify([process.execPath,'-e','process.exit(0)'],{cwd});assert.equal(pass.status,'passed');
  const fail=await verify([process.execPath,'-e','console.log("AssertionError expected 2 received 3");process.exit(1)'],{cwd});assert.equal(fail.kind,'test');
  const missing=await verify(['effort-nonexistent-command'],{cwd});assert.equal(missing.kind,'environment');
  const timeout=await verify([process.execPath,'-e','setInterval(()=>{},1000)'],{cwd,timeoutMs:40});assert.equal(timeout.kind,'timeout');
  const literal=await verify([process.execPath,'-e','console.log(process.argv[1])','$(touch should-not-exist)'],{cwd});assert.match(literal.output,/touch/);
  await assert.rejects(readFile(join(cwd,'should-not-exist')));
});
test('identical failing node checks keep the same fingerprint despite timings',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'effort-signature-'));
  await writeFile(join(cwd,'fail.test.cjs'),"const {test}=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(2,3));");
  const first=await verify([process.execPath,'--test','fail.test.cjs'],{cwd});
  const second=await verify([process.execPath,'--test','fail.test.cjs'],{cwd});
  assert.equal(first.kind,'test');assert.equal(first.fingerprint,second.fingerprint);
});
test('verification timeout reaps descendants holding stdout open',{skip:process.platform==='win32'},async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'effort-tree-'));
  const script=`const {spawn}=require('node:child_process'); const fs=require('node:fs'); const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']}); fs.writeFileSync('pid',String(c.pid));setInterval(()=>{},1000);`;
  const start=Date.now();const result=await verify([process.execPath,'-e',script],{cwd,timeoutMs:150});
  assert.equal(result.kind,'timeout');assert.ok(Date.now()-start<2200);
  const pid=Number(await readFile(join(cwd,'pid'),'utf8'));assert.throws(()=>process.kill(pid,0));
});
async function fixture(run){
  const cwd=await mkdtemp(join(tmpdir(),'effort-run-'));const store=await new Store(join(cwd,'records')).initialize();
  return {cwd,store,adapter:{capabilities:{id:'codex',levels:['low','medium','high']},run}};
}
const completed={status:'completed',sessionId:'fake-session',text:'sensitive response',effortEvidence:'fixture-request',usage:{inputTokens:10,outputTokens:2}};
test('managed runs resume same session and escalate only after repeated check failure',async()=>{
  const calls=[];const f=await fixture(async o=>{calls.push(o);return completed;});let checks=0;
  const result=await runTask({prompt:'Rename variable',cwd:f.cwd,effort:'low',verify:['fake-check'],maxAttempts:3},{...f,verifyFn:async()=>++checks===3?{status:'passed',exitCode:0}:{status:'failed',kind:'test',exitCode:1,output:'sensitive test output',fingerprint:'same'}});
  assert.deepEqual(calls.map(x=>x.effort),['low','low','medium']);assert.equal(calls[1].sessionId,'fake-session');
  assert.equal(result.task.status,'verified');assert.equal(result.task.attempts.length,3);
  const saved=await readFile(join(f.store.dir,`${result.task.id}.json`),'utf8');
  for(const secret of ['Rename variable','sensitive response','sensitive test output','fake-session'])assert.ok(!saved.includes(secret));
});
test('provider completion alone is unverified and no re-prompt is invented',async()=>{
  let count=0;const f=await fixture(async()=>{count++;return completed;});
  const result=await runTask({prompt:'Summarize',cwd:f.cwd},{...f});
  assert.equal(result.task.status,'unverified');assert.equal(count,1);
});
test('access/environment failures stop without escalation',async()=>{
  let count=0;const f=await fixture(async()=>{count++;return completed;});
  const r=await runTask({prompt:'Fix this',cwd:f.cwd,verify:['fake']},{...f,verifyFn:async()=>({status:'blocked',kind:'environment',exitCode:1,output:'MODULE_NOT_FOUND'})});
  assert.equal(r.task.status,'blocked');assert.equal(count,1);
});
test('missing resume capability cannot silently start a disconnected retry',async()=>{
  const f=await fixture(async()=>({...completed,sessionId:null}));
  const r=await runTask({prompt:'Rename',cwd:f.cwd,verify:['fake']},{...f,verifyFn:async()=>({status:'failed',kind:'test',exitCode:1,output:'FAIL',fingerprint:'x'})});
  assert.equal(r.task.status,'blocked');assert.match(r.task.stopReason,/resumable/);
});
test('provider errors are recorded as blocked without raw error persistence',async()=>{
  const f=await fixture(async()=>{throw new Error('SECRET_PROVIDER_PAYLOAD');});
  const r=await runTask({prompt:'Rename',cwd:f.cwd},{...f});assert.equal(r.task.status,'blocked');
  assert.ok(!JSON.stringify(await f.store.get(r.task.id)).includes('SECRET_PROVIDER_PAYLOAD'));
});

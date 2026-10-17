import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recommend, nextDecision, classifyFailure } from '../src/policy.mjs';
import { repositoryFacts } from '../src/repository.mjs';
import { Store } from '../src/store.mjs';
import { verify, failureFingerprint } from '../src/verify.mjs';
import { runTask } from '../src/runner.mjs';

test('unknown tasks remain uncertain and mechanical requests can start low',()=>{
  assert.equal(recommend({prompt:'Do this task'}).effort,'medium');
  assert.equal(recommend({prompt:'Rename this local variable'}).effort,'low');
  assert.equal(recommend({prompt:'Rename the authentication token and migrate all permissions'}).effort,'high');
  assert.equal(recommend({prompt:'Investigate a race condition'}).confidence,'low');
});
test('the checkout language count is informational; only files the request names raise effort',()=>{
  const languages=['javascript','python','typescript'];
  assert.equal(recommend({prompt:'Fix the typo in the README',facts:{languages,mentionedFiles:0}}).effort,'low');
  for(const prompt of ['Add a settings page','Fix the broken link in the README','Bump the version number in package.json','Change the button color from blue to green']){
    const result=recommend({prompt,facts:{languages,mentionedFiles:1}});
    assert.equal(result.effort,'medium',prompt);assert.equal(result.features.manyLanguages,true);
    assert.ok(result.reasons.some(reason=>/several languages/.test(reason)),prompt);
  }
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
test('a suite that could not run stops even inside a test-runner report',()=>{
  for(const [text,expected] of [
    ["✖ test/app.test.mjs (54ms)\n  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad' imported from /repo/test/app.test.mjs\nℹ fail 1",'environment'],
    ["FAIL src/a.test.js\n  ● Test suite failed to run\n\n    Cannot find module 'lodash' from 'src/a.js'",'environment'],
    ["FAIL db: connect ECONNREFUSED 127.0.0.1:5432\n# fail 1",'environment'],
    ["FAIL\texample.com/acl [setup failed]",'environment'],
    [" FAIL  src/io.test.ts > io > writes\nError: EACCES: permission denied, open '/var/data/x'\n Test Files  1 failed (1)",'permission'],
    // Names of failing tests are not blockers.
    ["✖ shows Permission denied to guests (2ms)\n  AssertionError [ERR_ASSERTION]: expected a banner\nℹ fail 1",'test'],
    ["not ok 1 - retries after ECONNREFUSED\n# fail 1",'test'],
  ])assert.equal(classifyFailure(text),expected,text);
});
test('classification and fingerprints stay linear on long runs of blank lines',async()=>{
  const blank='\n'.repeat(32_000)+'FAIL: test_x (t.T.test_x)\n';
  let started=performance.now();classifyFailure(blank);assert.ok(performance.now()-started<250,'classifyFailure');
  started=performance.now();failureFingerprint(blank);assert.ok(performance.now()-started<250,'failureFingerprint');
  // A passing check is never fingerprinted.
  const cwd=await mkdtemp(join(tmpdir(),'effort-blank-'));
  assert.equal((await verify([process.execPath,'-e',"process.stdout.write('\\n'.repeat(32000))"],{cwd})).fingerprint,null);
});
test('the temporary root matches only whole path segments',()=>{
  const at=(path)=>failureFingerprint(`AssertionError: cannot render ${path}`,{cwd:'/srv/app',tmp:'/tmp'});
  for(const [a,b] of [['/srv/app/tmpl/header.html','/srv/app/tmpl/footer.html'],['/data/tmp_uploads/a.csv','/data/tmp_uploads/b.json'],
    ['/srv/app/tmp/cache/users.json','/srv/app/tmp/cache/orders.json'],['/opt/tmpfs/x.log','/opt/tmpfs/y.log']])assert.notEqual(at(a),at(b),`${a} vs ${b}`);
  assert.equal(at('/tmp/effort-run-a1B2c3/state.json'),at('/tmp/effort-run-Zz9Yy8/state.json'));
});
test('failing test names keep their numbers, ports and line references',()=>{
  const spec=(name)=>`✖ ${name} (3.2ms)\n  AssertionError [ERR_ASSERTION]: boom\nℹ fail 1`;
  for(const [a,b] of [['retries after 5s','retries after 30s'],['handles port 80','handles port 443'],['loads a.ts:12','loads a.ts:99'],
    ['times out after 100ms','times out after 2 seconds'],['parses 09:30:00','parses 17:45:10']])assert.notEqual(failureFingerprint(spec(a)),failureFingerprint(spec(b)),`${a} vs ${b}`);
});
test('unittest and Jest suite-load failures fingerprint by name, ignoring line numbers',()=>{
  const unittest=(line)=>`F\n======\nFAIL: test_sum (test_sum.TestSum.test_sum)\n------\nTraceback (most recent call last):\n  File "/repo/test_sum.py", line ${line}, in test_sum\n    self.assertEqual(add(1, 2), 3)\nAssertionError: -1 != 3\n\nFAILED (failures=1)`;
  assert.equal(failureFingerprint(unittest(7)),failureFingerprint(unittest(9)));
  const jest=(line)=>`FAIL src/sum.test.js\n  ● Test suite failed to run\n\n    SyntaxError: /repo/src/sum.js: Unexpected token (${line}:4)`;
  assert.equal(failureFingerprint(jest(3)),failureFingerprint(jest(8)));
  assert.notEqual(failureFingerprint(jest(3)),failureFingerprint(jest(3).replace('sum.test.js','add.test.js')));
  // Unrecognized output ignores Python line references too.
  assert.equal(failureFingerprint('Traceback:\n  File "/repo/app.py", line 12\nValueError: bad'),failureFingerprint('Traceback:\n  File "/repo/app.py", line 40\nValueError: bad'));
});
test('identical long failures keep one fingerprint when the kept tail starts mid-line',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'effort-tail-'));
  // Lines of varying length shift where the kept 32,000-character tail begins.
  await writeFile(join(cwd,'noisy.cjs'),"for(let i=0;i<3000;i++)console.log('step '+i+' took '+Math.floor(Math.random()*100000)+'ms');console.log('AssertionError: totals differ');process.exit(1);");
  const first=await verify([process.execPath,'noisy.cjs'],{cwd}),second=await verify([process.execPath,'noisy.cjs'],{cwd});
  assert.equal(first.kind,'test');assert.equal(first.fingerprint,second.fingerprint);
});
test('a missing dependency reported by node:test stops after one provider turn',async()=>{
  const calls=[];const f=await fixture(async o=>{calls.push(o.effort);return completed;});
  await writeFile(join(f.cwd,'app.test.mjs'),"import pad from 'effort-missing-package-for-test';import test from 'node:test';test('pads',()=>{});");
  const check=await verify([process.execPath,'--test','app.test.mjs'],{cwd:f.cwd});
  assert.equal(check.kind,'environment');assert.equal(check.status,'blocked');
  const result=await runTask({prompt:'Fix the padding',cwd:f.cwd,effort:'low',verify:[process.execPath,'--test','app.test.mjs'],maxAttempts:3},{...f});
  assert.deepEqual(calls,['low']);assert.equal(result.task.status,'blocked');
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
test('repository metadata counts distinct mentioned files: by path, or once per bare name',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'effort-mentions-'));
  await writeFile(join(dir,'index.ts'),'x');
  for(const sub of ['a','b','c','d']){await mkdir(join(dir,sub));await writeFile(join(dir,sub,'index.ts'),'x');}
  await writeFile(join(dir,'util.ts'),'x');
  assert.equal((await repositoryFacts(dir,'Fix the import in index.ts')).mentionedFiles,1);
  assert.equal((await repositoryFacts(dir,'Move util.ts into index.ts')).mentionedFiles,2);
  assert.equal((await repositoryFacts(dir,'Compare a/index.ts with index.ts')).mentionedFiles,2);
  // Five files that share a basename are five files when the prompt names their paths.
  const packages=await mkdtemp(join(tmpdir(),'effort-packages-'));
  for(const name of ['a','b','c','d','e']){await mkdir(join(packages,'packages',name),{recursive:true});await writeFile(join(packages,'packages',name,'index.ts'),'x');}
  const prompt='Export the new helper from packages/a/index.ts, packages/b/index.ts, packages\\c\\index.ts, packages/d/index.ts and packages/e/index.ts';
  const facts=await repositoryFacts(packages,prompt);
  assert.equal(facts.mentionedFiles,5);
  assert.equal(recommend({prompt,facts}).effort,'high');
  assert.equal((await repositoryFacts(packages,'Export the helper from every index.ts')).mentionedFiles,1);
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
test('fingerprints ignore temporary paths, ports, PIDs, timestamps and hex IDs',()=>{
  const cwd=join(tmpdir(),'effort-project-fixture');
  const report=({dir,port,pid,time,id,address,line})=>`Error: request to http://127.0.0.1:${port}/health failed (pid ${pid}) at ${time}\n  job ${id} object 0x${address} commit 9f3c2a17b4\n  in ${join(tmpdir(),dir,'state.json')} from ${join(cwd,'src','server.js')}:${line}:7`;
  const first=report({dir:'effort-run-a1B2c3',port:54321,pid:4242,time:'2026-10-17T15:24:00.123Z',id:'3f2a9c1e-0b7d-4e8a-9c3f-2d1e0a9b8c7d',address:'7ffd1234',line:12});
  const second=report({dir:'effort-run-Zz9Yy8',port:61002,pid:977,time:'2026-10-17T16:01:59.004Z',id:'aa11bb22-cc33-4d44-8e55-ff6677889900',address:'5555beef',line:14});
  assert.equal(failureFingerprint(first,{cwd}),failureFingerprint(second,{cwd}));
  assert.notEqual(failureFingerprint(first,{cwd}),failureFingerprint(first.replace('/health','/ready'),{cwd}));
});
test('recognized failing test names identify a repeated failure',()=>{
  const spec=(name,line,detail)=>`✖ ${name} (${line}.25ms)\n  AssertionError [ERR_ASSERTION]: ${detail}\n      at TestContext.<anonymous> (file:///repo/sum.test.js:${line}:9)\nℹ fail 1`;
  assert.equal(failureFingerprint(spec('adds negatives',3,'-1 !== 1')),failureFingerprint(spec('adds negatives',7,'-2 !== 1')));
  assert.notEqual(failureFingerprint(spec('adds negatives',3,'-1 !== 1')),failureFingerprint(spec('adds zero',3,'-1 !== 1')));
  const pytest=(seconds)=>`FAILED tests/test_sum.py::test_negative - assert -1 == 1\n=== 1 failed, 4 passed in ${seconds}s ===`;
  assert.equal(failureFingerprint(pytest('0.12')),failureFingerprint(pytest('3.40')));
});
test('repeated noisy failures escalate instead of looking new every attempt',async()=>{
  const calls=[];const f=await fixture(async o=>{calls.push(o.effort);return completed;});
  // Not a recognized test report: each attempt prints a fresh temp path, port, PID and time.
  await writeFile(join(f.cwd,'check.cjs'),"const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'effort-noise-'));console.error('AssertionError: server on 127.0.0.1:'+(40000+Math.floor(Math.random()*20000))+' (pid '+process.pid+') at '+new Date().toISOString()+' wrote '+path.join(dir,'state.json'));fs.rmSync(dir,{recursive:true});process.exit(1);");
  const result=await runTask({prompt:'Fix the server check',cwd:f.cwd,effort:'low',verify:[process.execPath,'check.cjs'],maxAttempts:3},{...f});
  assert.deepEqual(calls,['low','low','medium']);
  assert.equal(result.task.status,'failed');
});
test('a passing check settles when it exits, even if a descendant keeps stdout open',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'effort-exit-'));
  // Like `server &` in a pretest: the check exits 0 while its child still holds the pipe.
  // On Windows the child must leave the check's job object, which would otherwise kill it.
  await writeFile(join(cwd,'check.cjs'),"const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:['ignore','inherit','inherit'],detached:process.platform==='win32'});require('node:fs').writeFileSync('child.pid',String(c.pid));c.unref();console.log('ok');");
  const started=Date.now();
  try {
    const result=await verify([process.execPath,'check.cjs'],{cwd,timeoutMs:20_000});
    assert.equal(result.status,'passed');assert.equal(result.exitCode,0);assert.match(result.output,/ok/);
    assert.ok(Date.now()-started<8000,`settled after ${Date.now()-started} ms`);
  } finally {
    try{process.kill(Number(await readFile(join(cwd,'child.pid'),'utf8')),'SIGKILL');}catch{}
  }
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
test('verification may use the remaining task time unless a shorter limit is set',async()=>{
  const limits=[],turns=[];const f=await fixture(async o=>{turns.push(o.timeoutMs);return completed;});
  const verifyFn=async(argv,o)=>{limits.push(o.timeoutMs);return {status:'passed',exitCode:0};};
  await runTask({prompt:'Fix the slow suite',cwd:f.cwd,verify:['fake-check']},{...f,verifyFn});
  // The default task budget is 600 s, and a check is no longer capped at 60 s.
  assert.ok(turns[0]>590_000&&turns[0]<=600_000,String(turns[0]));
  assert.ok(limits[0]>590_000&&limits[0]<=600_000,String(limits[0]));
  await runTask({prompt:'Fix the slow suite',cwd:f.cwd,verify:['fake-check'],timeoutMs:900_000,verifyTimeoutMs:300_000},{...f,verifyFn});
  assert.equal(limits[1],300_000);
  await runTask({prompt:'Fix the slow suite',cwd:f.cwd,verify:['fake-check'],timeoutMs:5_000,verifyTimeoutMs:5_000},{...f,verifyFn});
  assert.ok(limits[2]<=5_000&&limits[2]>=100,String(limits[2]));
  for(const options of [{verifyTimeoutMs:99},{verifyTimeoutMs:1.5e3+0.5},{timeoutMs:1_000,verifyTimeoutMs:1_001},{verify:undefined,verifyTimeoutMs:1_000}]){
    await assert.rejects(runTask({prompt:'Fix it',cwd:f.cwd,verify:['fake-check'],...options},{...f,verifyFn}),/verifyTimeoutMs/);
  }
});
test('a slow verification stops with the limit it exceeded',async()=>{
  const f=await fixture(async()=>completed);
  const result=await runTask({prompt:'Fix the slow suite',cwd:f.cwd,verify:[process.execPath,'-e','setTimeout(()=>{},5000)'],verifyTimeoutMs:200},{...f});
  assert.equal(result.task.status,'blocked');
  assert.equal(result.task.stopReason,'Verification exceeded its 0.2-second limit.');
  assert.equal(result.task.attempts[0].verification.kind,'timeout');
  assert.equal(result.task.attempts[0].verification.timeoutMs,200);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeRuntimeSecurity,createRuntimeReporter} from '../server/lib/nodeRuntimeSecurity.js';

for (const version of ['v24.19.0','24.22.0','22.23.3','26.12.0','20.20.0','24.22.1-rc.1','garbage']) {
  test(`reject unpatched or unrecognized runtime ${version}`,()=>assert.equal(nodeRuntimeSecurity(version).patched,false));
}
for (const version of ['24.22.1','v24.22.2','24.23.0']) {
  test(`allow patched project runtime ${version}`,()=>assert.equal(nodeRuntimeSecurity(version).projectRuntimeSupported,true));
}
test('other patched lines are identified without changing the project major',()=>{
  for(const version of ['22.23.4','26.12.1']) {
    assert.equal(nodeRuntimeSecurity(version).patched,true);
    assert.equal(nodeRuntimeSecurity(version).projectRuntimeSupported,false);
  }
});
test('reports once per worker without request or secret data',()=>{
  const messages=[];
  const report=createRuntimeReporter({info:m=>messages.push(m),error:()=>assert.fail('unexpected error')},'24.22.1');
  report();report();
  assert.equal(messages.length,1);
  assert.deepEqual(JSON.parse(messages[0].slice('node_runtime_security '.length)),{nodeVersion:'24.22.1',advisory:'2026-10-21',patched:true,projectRuntimeSupported:true});
});
test('outdated runtime emits an error signal without throwing on payment requests',()=>{
  const messages=[];
  const report=createRuntimeReporter({info:()=>assert.fail('unexpected info'),error:m=>messages.push(m)},'24.19.0');
  assert.doesNotThrow(report);
  assert.equal(messages.length,1);
  assert.match(messages[0],/"patched":false/);
});

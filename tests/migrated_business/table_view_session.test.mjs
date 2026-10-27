import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableViewSession} from '../../frontend/src/features/table/view_session.ts';
import {createStructuredClipboard} from '../../frontend/src/ui/structured_clipboard.ts';

test('fallback view tickets reject foreign instances, forged tokens, changed input and disposed/remounted views',()=>{
 const a=createTableViewSession(),b=createTableViewSession(),ticket=a.begin('same');
 assert.equal(a.canApply(ticket),true);assert.equal(b.canApply(ticket),false);
 assert.equal(a.canApply({...ticket}),false);a.invalidate();assert.equal(a.canApply(ticket),false);
 const late=a.begin('late');a.dispose();a.dispose();assert.equal(a.signal.aborted,true);
 assert.equal(a.canApply(late),false);assert.throws(()=>a.begin('again'),/释放/);
 assert.equal(createTableViewSession().canApply(late),false);assert.equal(b.canApply(b.begin('same')),true);
});
test('abort suppresses late completion and does not cancel another instance',async()=>{
 const a=createTableViewSession(),b=createTableViewSession();let finish;
 const pending=new Promise(resolve=>{finish=resolve;}).then(()=>{a.assertCurrent();return 'wrong write';});
 a.dispose();finish();await assert.rejects(pending,/释放/);assert.equal(b.signal.aborted,false);
 const t=b.begin('b');b.release(t);assert.equal(b.canApply(t),false);
});
test('intentional structured clipboard exchange is injected, detached and invalid on different text',async()=>{
 let system='';const shared=createStructuredClipboard(async text=>{system=text;}),matrix=[[{kind:'future',value:'中文'}]];
 await shared.writeText('text');shared.remember('text',matrix);matrix[0][0].value='mutated';
 assert.equal(system,'text');assert.equal(shared.recall('text')[0][0].value,'中文');
 const read=shared.recall('text');read[0][0].value='other';assert.equal(shared.recall('text')[0][0].value,'中文');
 assert.equal(shared.recall('external edit'),null);shared.clear();assert.equal(shared.recall('text'),null);
});

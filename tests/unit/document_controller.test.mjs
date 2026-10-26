import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentController } from '../../web/application/document_controller.js';

function setup() {
  let doc = { text: 'original', unknown: { preserved: true } }, revision = 0;
  let identity = { workflowSession: 'a', epoch: 1, documentId: 'node-1' };
  const history = [];
  const port = {
    read: () => doc, identity: () => identity, revision: () => revision,
    transact(label, edit) {
      const before = structuredClone(doc);
      try { edit(doc); history.push({ label, before }); revision++; }
      catch (error) { doc = before; throw error; }
    },
  };
  return { port, history, controller: new DocumentController(port), switchSession() { identity = { ...identity, workflowSession: 'b' }; } };
}
test('edits use native document transaction and preserve unowned fields', () => {
  const s = setup();
  s.controller.edit('typing', doc => { doc.text = 'edited'; });
  assert.deepEqual(s.port.read(), { text: 'edited', unknown: { preserved: true } });
  assert.equal(s.history.length, 1);
});
test('late result cannot overwrite new input or another workflow', () => {
  for (const change of ['input', 'session']) {
    const s = setup();
    const ticket = s.controller.beginRequest('request-1');
    if (change === 'input') s.controller.edit('new input', doc => { doc.text = 'new'; });
    else s.switchSession();
    assert.equal(s.controller.applyResult(ticket, 'result', doc => { doc.text = 'stale'; }), false);
    assert.notEqual(s.port.read().text, 'stale');
  }
});
test('a result applies once, isolated instances and disposed views reject callbacks', () => {
  const a = setup(), b = setup();
  const ticket = a.controller.beginRequest('r');
  assert.equal(b.controller.applyResult(ticket, 'wrong instance', d => { d.text = 'bad'; }), false);
  assert.equal(a.controller.applyResult(ticket, 'result', d => { d.text = 'result'; }), true);
  assert.equal(a.controller.applyResult(ticket, 'duplicate', d => { d.text = 'bad'; }), false);
  const pending = a.controller.beginRequest('r2');
  a.controller.dispose();
  assert.equal(a.controller.applyResult(pending, 'released', d => { d.text = 'bad'; }), false);
  assert.equal(b.port.read().text, 'original');
});
test('failed native transactions do not leak a partially changed document', () => {
  const s = setup();
  assert.throws(() => s.controller.edit('failed', d => { d.text = 'partial'; throw Error('failed'); }));
  assert.equal(s.port.read().text, 'original');
  assert.equal(s.history.length, 0);
});

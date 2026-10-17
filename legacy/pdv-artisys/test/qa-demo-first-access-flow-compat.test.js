import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFirstAccessFlowSteps } from '../qa/runtime/src/first-access-flow.js';

test('legacy quick demo auth prelude is normalized for first-access auto-login', () => {
  const legacy = [
    { action:'waitFor', selector:'#auth-overlay', name:'bootstrap', timeoutMs:15000 },
    { action:'fill', selector:"#auth-overlay input[type='password']", name:'senha-demo', valueFromEnv:'ARTISYS_QA_DEMO_PASSWORD' },
    { action:'click', text:'Criar administrador', name:'criar-admin-demo', exact:true },
    { action:'fill', selector:"#auth-overlay input:not([type='password'])", name:'usuario-admin', value:'admin' },
    { action:'fill', selector:"#auth-overlay input[type='password']", name:'senha-login', valueFromEnv:'ARTISYS_QA_DEMO_PASSWORD' },
    { action:'click', text:'Entrar', name:'entrar', exact:true },
    { action:'waitFor', selector:'#auth-overlay', name:'autenticado', state:'hidden', timeoutMs:15000 },
    { action:'screenshot', name:'abertura' },
  ];

  const normalized = normalizeFirstAccessFlowSteps(legacy);

  assert.deepEqual(normalized.map(step => step.name), [
    'bootstrap',
    'senha-demo',
    'senha-demo-confirm',
    'criar-admin-demo',
    'autenticado',
    'abertura',
  ]);
  assert.equal(normalized[1].selector, "#first-access-form input[name='password']");
  assert.equal(normalized[2].selector, "#first-access-form input[name='passwordConfirm']");
  assert.equal(normalized[3].selector, "#first-access-form button[type='submit']");
  assert.equal(normalized.some(step => step.name === 'usuario-admin'), false);
  assert.equal(normalized.some(step => step.name === 'senha-login'), false);
  assert.equal(normalized.some(step => step.name === 'entrar'), false);
  assert.equal(legacy[1].selector, "#auth-overlay input[type='password']", 'normalization must not mutate source flow');
});

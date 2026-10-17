import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFirstAccessFlowSteps } from '../qa/runtime/src/first-access-flow.js';

test('legacy setup/login prelude is normalized for first-access auto-login', () => {
  const legacy = [
    { action:'waitFor', selector:'#setup-form', name:'setup-ready', timeoutMs:15000 },
    { action:'fill', selector:"#setup-form input[name='name']", value:'QA Admin', name:'setup-admin-name' },
    { action:'fill', selector:"#setup-form input[name='username']", value:'qaadmin', name:'setup-admin-username' },
    { action:'fill', selector:"#setup-form input[name='password']", value:'QaLocal-12345!', name:'setup-admin-password' },
    { action:'click', selector:"#setup-form button[type='submit']", name:'qa-admin-setup' },
    { action:'waitFor', selector:'#login-form', name:'login-ready', timeoutMs:10000 },
    { action:'fill', selector:"#login-form input[name='username']", value:'qaadmin', name:'login-username' },
    { action:'fill', selector:"#login-form input[name='password']", value:'QaLocal-12345!', name:'login-password' },
    { action:'click', selector:"#login-form button[type='submit']", name:'qa-login' },
    { action:'waitFor', selector:'#auth-overlay', state:'hidden', name:'authenticated', timeoutMs:10000 },
    { action:'waitFor', selector:'#app-topbar', name:'app-ready', timeoutMs:15000 },
  ];

  const normalized = normalizeFirstAccessFlowSteps(legacy);

  assert.deepEqual(normalized.map(step => step.name), [
    'setup-ready',
    'setup-admin-name',
    'setup-admin-username',
    'setup-admin-password',
    'setup-admin-password-confirm',
    'qa-admin-setup',
    'authenticated',
    'app-ready',
  ]);
  assert.equal(normalized[0].selector, '#first-access-form');
  assert.equal(normalized[3].selector, "#first-access-form input[name='password']");
  assert.deepEqual(normalized[4], {
    action:'fill',
    selector:"#first-access-form input[name='passwordConfirm']",
    value:'QaLocal-12345!',
    name:'setup-admin-password-confirm',
  });
  assert.equal(normalized[5].selector, "#first-access-form button[type='submit']");
  assert.equal(normalized.some(step => String(step.selector || '').startsWith('#login-form')), false);
  assert.equal(legacy[0].selector, '#setup-form', 'normalization must not mutate source flow');
});

test('flows without the legacy setup prelude are left unchanged', () => {
  const steps = [{ action:'waitFor', selector:'#app-topbar', name:'app-ready' }];
  assert.equal(normalizeFirstAccessFlowSteps(steps), steps);
});

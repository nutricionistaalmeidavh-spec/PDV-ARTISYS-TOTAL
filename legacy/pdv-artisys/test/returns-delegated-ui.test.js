'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rendererRoot = path.join(__dirname, '..', 'desktop', 'renderer');
const returnsSource = fs.readFileSync(path.join(rendererRoot, 'returns-ui.js'), 'utf8');
const apiClientSource = fs.readFileSync(path.join(rendererRoot, 'api-client.js'), 'utf8');

test('returns compatibility UI is valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(returnsSource));
});

test('desktop API client exposes delegated return authorization', () => {
  assert.match(apiClientSource, /authorizeReturn\s*\(body\)\s*\{\s*return this\.request\('\/api\/v1\/auth\/authorize'/);
});

test('return flow uses one-time approval when profile can manage but cannot approve directly', () => {
  assert.match(returnsSource, /const directAllowed = \(\) => hasCapability\('returns\.approve'\)/);
  assert.match(returnsSource, /const requiresApproval = \(\) => hasCapability\('returns\.manage'\)&&!directAllowed\(\)/);
  assert.match(returnsSource, /data-return-authorization/);
  assert.match(returnsSource, /api\.authorizeReturn\(/);
  assert.match(returnsSource, /scope:'return\.complete'/);
  assert.match(returnsSource, /payload\.approvalToken = state\.approval\.approvalToken/);
  assert.match(returnsSource, /state\.approval = null;[\s\S]{0,120}setStatus\('Carregando detalhes da venda/);
  assert.doesNotMatch(returnsSource, /const roleAllowed/);
});

test('direct return authorization depends on capabilities rather than role names', () => {
  assert.match(returnsSource, /const canOperate = \(\) => hasCapability\('returns\.manage'\)/);
  assert.doesNotMatch(returnsSource, /currentRole|\['admin','manager'\]/);
  assert.match(returnsSource, /Seu perfil não possui permissão para concluir devoluções/);
});

'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {statusForError}=require('../server/http-error-status');

test('HTTP classifier preserves explicit client/server status codes',()=>{
  assert.equal(statusForError(Object.assign(new Error('json invalido'),{statusCode:400})),400);
  assert.equal(statusForError(Object.assign(new Error('indisponivel'),{statusCode:503})),503);
});

test('HTTP classifier preserves common domain validation errors as 4xx',()=>{
  assert.equal(statusForError(new Error('Nome ou numero da mesa e obrigatorio.')),400);
  assert.equal(statusForError(new Error('Quantidade deve ser maior que zero.')),400);
  assert.equal(statusForError(new Error('Produto nao encontrado ou inativo.')),400);
  assert.equal(statusForError(new Error('Permissao insuficiente para alterar modulo.')),403);
});

test('HTTP classifier maps known conflicts and unexpected failures correctly',()=>{
  assert.equal(statusForError(Object.assign(new Error('Modulo FOOD desativado.'),{code:'MODULE_DISABLED'})),409);
  assert.equal(statusForError(new Error('UNIQUE constraint failed: products.sku')),409);
  assert.equal(statusForError(new TypeError('Cannot read properties of undefined')),500);
  assert.equal(statusForError(Object.assign(new Error('disk I/O error'),{code:'SQLITE_IOERR'})),500);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'renderer', 'app.js'), 'utf8');

test('openModal wires every data-close-modal control', () => {
  const allCloseControls = "modalRoot.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));";
  const firstCloseControlOnly = "modalRoot.querySelector('[data-close-modal]')?.addEventListener('click', closeModal);";

  assert.ok(
    appSource.includes(allCloseControls),
    'openModal must wire both the header close control and form Cancel buttons'
  );
  assert.equal(
    appSource.includes(firstCloseControlOnly),
    false,
    'openModal must not wire only the first close control'
  );
});

test('modal close controls are wired only once by openModal', () => {
  const singularBindings = appSource.match(/\.querySelector\('\[data-close-modal\]'\)(?:\?\.|\.)addEventListener\('click', closeModal\)/g) || [];

  assert.equal(
    singularBindings.length,
    0,
    'individual modals must not add a second close handler; openModal owns every data-close-modal control'
  );
});

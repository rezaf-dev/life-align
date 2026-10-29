import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, isApproved, isConfiguredOwner } from './access-policy';

test('only the configured verified email is eligible for initial ownership', () => {
  assert.equal(isConfiguredOwner('owner@example.com', true, 'owner@example.com'), true);
  assert.equal(isConfiguredOwner('member@example.com', true, 'owner@example.com'), false);
  assert.equal(isConfiguredOwner('owner@example.com', false, 'owner@example.com'), false);
});
test('empty owner configuration never grants ownership to first signup', () => {
  assert.equal(isConfiguredOwner('first@example.com', true), false);
  assert.equal(isConfiguredOwner('first@example.com', true, '  '), false);
});
test('email matching trims and case-folds without accepting another email', () => {
  assert.equal(isConfiguredOwner(' Owner@Example.com ', true, 'owner@example.com'), true);
  assert.equal(isConfiguredOwner('owner+other@example.com', true, 'owner@example.com'), false);
});
test('pending, rejected and revoked accounts fail approved checks', () => {
  for (const status of ['pending', 'rejected', 'revoked', 'unknown', '']) assert.equal(isApproved({ status }), false);
  assert.equal(isApproved({ status: 'approved' }), true);
});
test('approval alone does not grant member administration', () => {
  assert.equal(isAdmin({ status: 'approved', role: 'member' }), false);
  assert.equal(isAdmin({ status: 'approved', role: 'admin' }), true);
});
test('an administrator without approved access fails closed', () => {
  for (const status of ['pending', 'rejected', 'revoked']) assert.equal(isAdmin({ status, role: 'admin' }), false);
});

// Run with `node --test scripts/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('./report.js');

const DAY = 86400;
const NOW = 1_800_000_000;

// A pending release whose last change is 10 days old, after a release 40 days ago.
const pending = {
  pending: true, quietDays: 10, minQuietDays: 7,
  tagTime: NOW - 40 * DAY, lastChangeTime: NOW - 10 * DAY,
};

function closed(daysAgo, reason) {
  return { state: 'closed', state_reason: reason,
           closed_at: new Date((NOW - daysAgo * DAY) * 1000).toISOString() };
}

test('opens an issue if there is none', () => {
  assert.equal(decide({ ...pending, issue: null }).action, 'create');
});

test('updates the open issue', () => {
  assert.equal(decide({ ...pending, issue: { state: 'open' } }).action, 'update');
});

test('waits while the changes are recent', () => {
  assert.equal(decide({ ...pending, quietDays: 3, issue: null }).action, 'wait');
});

test('leaves an issue closed if nothing changed since', () => {
  assert.equal(decide({ ...pending, issue: closed(5, 'completed') }).action, 'none');
});

test('opens a new issue for changes after the closing', () => {
  assert.equal(decide({ ...pending, issue: closed(20, 'completed') }).action, 'create');
});

test('stays silent after "not planned" despite later changes', () => {
  assert.equal(decide({ ...pending, issue: closed(20, 'not_planned') }).action, 'none');
});

test('"not planned" only lasts until the next release', () => {
  assert.equal(decide({ ...pending, issue: closed(50, 'not_planned') }).action, 'create');
});

test('"not planned" without any release lasts', () => {
  const noTag = { ...pending, tagTime: null };
  assert.equal(decide({ ...noTag, issue: closed(400, 'not_planned') }).action, 'none');
});

test('closes the open issue once everything is released', () => {
  const released = { pending: false, quietDays: 0, minQuietDays: 7,
                     tagTime: NOW - DAY, lastChangeTime: null };
  assert.equal(decide({ ...released, issue: { state: 'open' } }).action, 'close');
  assert.equal(decide({ ...released, issue: closed(5, 'completed') }).action, 'none');
  assert.equal(decide({ ...released, issue: null }).action, 'none');
});

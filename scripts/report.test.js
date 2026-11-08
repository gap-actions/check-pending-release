// Run with `node --test scripts/report.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('./report.js');

const DAY = 86400;
const NOW = 1_800_000_000;

// A pending release whose last change is 10 days old, after a release 40 days ago.
const pending = {
  pending: true, quietDays: 10, minQuietDays: 7,
  releaseTime: NOW - 40 * DAY, lastChangeTime: NOW - 10 * DAY,
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
  const noTag = { ...pending, releaseTime: null };
  assert.equal(decide({ ...noTag, issue: closed(400, 'not_planned') }).action, 'none');
});

test('closes the open issue once everything is released', () => {
  const released = { pending: false, quietDays: 0, minQuietDays: 7,
                     releaseTime: NOW - DAY, lastChangeTime: null };
  assert.equal(decide({ ...released, issue: { state: 'open' } }).action, 'close');
  assert.equal(decide({ ...released, issue: closed(5, 'completed') }).action, 'none');
  assert.equal(decide({ ...released, issue: null }).action, 'none');
});

// A GitHub client with one closed issue and the given releases, recording
// which issues get created.
function fakeGitHub(issue, releases) {
  const created = [];
  const github = { rest: {
    issues: {
      listForRepo: async () => ({ data: [issue] }),
      create: async (args) => { created.push(args); },
    },
    repos: { listReleases: async () => ({ data: releases }) },
  } };
  return { github, created };
}

test('a release of an older commit ends "not planned"', async () => {
  const { report } = require('./report.js');
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY * 1000).toISOString();
  const secs = (daysAgo) => String(Math.floor(Date.now() / 1000) - daysAgo * DAY);

  // closed as not planned 20 days ago; 10 days ago a release tagged a
  // commit from 30 days ago; a change 8 days ago is pending since
  Object.assign(process.env, {
    PENDING: 'true', QUIET_DAYS: '8', MIN_QUIET_DAYS: '7',
    TAG_TIME: secs(30), LAST_CHANGE_TIME: secs(8),
    SINCE_TAG: 'v1.0', COMMITS: '1', AGE_DAYS: '30', FILES: 'src/foo.c',
    ISSUE_TITLE: 'Pending release', ISSUE_LABEL: 'pending release', MAX_FILES: '50',
  });
  const { github, created } = fakeGitHub(
    { number: 1, state: 'closed', state_reason: 'not_planned', closed_at: iso(20) },
    [{ draft: false, published_at: iso(10) }]);
  const core = { info: () => {} };

  await report({ github, context: { repo: { owner: 'o', repo: 'r' } }, core });
  assert.equal(created.length, 1);
});

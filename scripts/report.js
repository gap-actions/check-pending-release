// Open, update or close the tracking issue, from the facts that
// check_pending_release.py reports. Run by actions/github-script.

/**
 * What to do about the tracking issue.
 *
 * `issue` is the most recent issue with our label, open or closed, or null.
 * Times are in seconds since the epoch; `tagTime` is null if there is no tag.
 *
 * A closed issue is the maintainer's answer, so it is left alone until there
 * is something new to say: a change committed after the closing, or, if it was
 * closed as "not planned", a release made after the closing.
 */
function decide({ pending, quietDays, minQuietDays, tagTime, lastChangeTime, issue }) {
  const open = issue !== null && issue.state === 'open';

  if (!pending) {
    return open ? { action: 'close' } : { action: 'none', why: 'nothing to release' };
  }

  // Work still in progress is none of our business: a long refactor may well
  // take weeks, and only stalling it should be reported.
  if (quietDays < minQuietDays) {
    return { action: 'wait', why: `changes last touched ${quietDays} day(s) ago, ` +
                                  `reporting them after ${minQuietDays} quiet day(s)` };
  }

  if (open) {
    return { action: 'update' };
  }
  if (issue === null) {
    return { action: 'create' };
  }

  const closedTime = Date.parse(issue.closed_at) / 1000;
  if (issue.state_reason === 'not_planned' && (tagTime === null || closedTime > tagTime)) {
    return { action: 'none', why: 'the issue was closed as not planned, ' +
                                  'which holds until the next release' };
  }
  if (lastChangeTime !== null && closedTime >= lastChangeTime) {
    return { action: 'none', why: 'the issue was closed and nothing changed since' };
  }
  return { action: 'create' };
}

function issueBody(env, quietDays) {
  const tag = env.SINCE_TAG;
  const files = env.FILES.split('\n').filter(Boolean);
  const maxFiles = Number(env.MAX_FILES);
  const shown = files.slice(0, maxFiles);
  const omitted = files.length - shown.length;

  const summary = tag
    ? `The last release was \`${tag}\`, ${env.AGE_DAYS} days ago. Since then ` +
      `${env.COMMITS} commit(s) changed ${files.length} file(s), the last ` +
      `of them ${quietDays} days ago:`
    : `This repository has no tags, so nothing was ever released. ` +
      `It contains ${files.length} file(s):`;

  return [
    summary,
    '',
    '```',
    ...shown,
    ...(omitted > 0 ? [`... and ${omitted} more`] : []),
    '```',
    '',
    'Please make a release, or close this issue if the changes do not warrant one:',
    'it then stays closed until further changes are committed. Close it as',
    '*not planned* to hear nothing more until the next release; see',
    '[Closing the issue yourself](https://github.com/gap-actions/check-pending-release#closing-the-issue-yourself).',
    'Paths that should never trigger this check can be added to the `ignore`',
    'input of the workflow in `.github/workflows/`, and `min-quiet-days` controls',
    'how long changes must lie untouched before they are reported.',
    '',
    `<sub>Reported by [check-pending-release](https://github.com/gap-actions/check-pending-release) on ${new Date().toISOString().slice(0, 10)}.</sub>`,
  ].join('\n');
}

function optionalTime(value) {
  return value ? Number(value) : null;
}

async function report({ github, context, core }) {
  const env = process.env;
  const { owner, repo } = context.repo;
  const label = env.ISSUE_LABEL;
  const quietDays = Number(env.QUIET_DAYS);

  // The label identifies our own issues; the most recent one carries the
  // maintainer's latest answer, so closed ones count too.
  const { data: issues } = await github.rest.issues.listForRepo({
    owner, repo, state: 'all', labels: label, sort: 'created', direction: 'desc',
    per_page: 1,
  });
  const issue = issues[0] ?? null;

  const decision = decide({
    pending: env.PENDING === 'true',
    quietDays,
    minQuietDays: Number(env.MIN_QUIET_DAYS),
    tagTime: optionalTime(env.TAG_TIME),
    lastChangeTime: optionalTime(env.LAST_CHANGE_TIME),
    issue,
  });

  switch (decision.action) {
    case 'wait':
    case 'none':
      core.info(`Not reporting: ${decision.why}.`);
      return;

    case 'close':
      await github.rest.issues.createComment({
        owner, repo, issue_number: issue.number,
        body: `All changes are released as of \`${env.SINCE_TAG}\`. Closing.`,
      });
      await github.rest.issues.update({
        owner, repo, issue_number: issue.number, state: 'closed',
      });
      return;

    case 'update':
      await github.rest.issues.update({
        owner, repo, issue_number: issue.number, body: issueBody(env, quietDays),
      });
      return;

    case 'create':
      await github.rest.issues.create({
        owner, repo, title: env.ISSUE_TITLE, body: issueBody(env, quietDays), labels: [label],
      });
      return;
  }
}

module.exports = { decide, report };

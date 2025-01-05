import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const UNIT = '\u001f';

export interface Commit {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

export async function getRepoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

export async function getTags(cwd: string): Promise<string[]> {
  try {
    const out = await git(cwd, ['tag', '--sort=-creatordate']);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Latest tag..HEAD, else the last 20 commits, else whole history. */
export async function getDefaultRange(cwd: string): Promise<string> {
  const tags = await getTags(cwd);
  if (tags.length) return `${tags[0]}..HEAD`;
  try {
    const count = Number((await git(cwd, ['rev-list', '--count', 'HEAD'])).trim());
    if (count > 20) return 'HEAD~20..HEAD';
  } catch {
    /* ignore */
  }
  return 'HEAD';
}

function rangeArgs(base: string[], range: string): string[] {
  if (range && range !== 'HEAD') base.push(range);
  else if (range === 'HEAD') base.push('HEAD');
  return base;
}

export async function getCommits(cwd: string, range: string): Promise<Commit[]> {
  const args = rangeArgs(
    ['log', '--no-merges', '--date=short', `--pretty=format:%h${UNIT}%s${UNIT}%an${UNIT}%ad`],
    range,
  );
  let out = '';
  try {
    out = await git(cwd, args);
  } catch {
    return [];
  }
  const commits: Commit[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [sha, subject, author, date] = line.split(UNIT);
    commits.push({ sha, subject, author, date });
  }
  return commits;
}

export async function getDiffStat(cwd: string, range: string): Promise<string> {
  const args = rangeArgs(['diff', '--stat'], range);
  try {
    return (await git(cwd, args)).trim();
  } catch {
    return '';
  }
}

export async function getDiff(cwd: string, range: string, maxBytes = 12000): Promise<string> {
  const args = rangeArgs(['diff'], range);
  let out = '';
  try {
    out = await git(cwd, args);
  } catch {
    return '';
  }
  if (out.length > maxBytes) out = out.slice(0, maxBytes) + `\n... (diff truncated at ${maxBytes} bytes)`;
  return out;
}

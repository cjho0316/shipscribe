import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolSpec } from '../model/provider.js';
import { getCommits, getDiff, getDiffStat, getDefaultRange, getRepoRoot } from '../domain/git.js';

/** Repo that ShipScribe analyzes (defaults to the current working directory). */
export const REPO_DIR = process.env.SHIPSCRIBE_REPO?.trim() || process.cwd();

/**
 * Read-only tools the agent calls to gather grounded facts (Criteria 1 & 6).
 * git_log emits every commit's short SHA so the model can cite it verbatim -
 * this is the backbone of ShipScribe's anti-hallucination grounding.
 */
export const readOnlyToolSpecs: ToolSpec[] = [
  {
    name: 'git_log',
    description:
      'List commits in a range (default: latest tag..HEAD). Returns one line per commit: "- <sha> <subject> - <author>". Cite the SHAs.',
    risk: 'safe',
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', description: 'A git range like v1.2.0..HEAD. Omit to use the default.' },
      },
      additionalProperties: false,
    },
    handler: async ({ range }: { range?: string }) => {
      const r = (range && range.trim()) || (await getDefaultRange(REPO_DIR));
      const commits = await getCommits(REPO_DIR, r);
      if (!commits.length) return `No commits found for range "${r}".`;
      const lines = commits.map((c) => `- ${c.sha} ${c.subject} \u2014 ${c.author}`);
      return `Range: ${r}\nCommits: ${commits.length}\n${lines.join('\n')}`;
    },
  },
  {
    name: 'git_diff',
    description:
      'Show the diff stat and a truncated unified diff for a range, to understand scope and spot breaking changes.',
    risk: 'safe',
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', description: 'A git range like v1.2.0..HEAD. Omit to use the default.' },
      },
      additionalProperties: false,
    },
    handler: async ({ range }: { range?: string }) => {
      const r = (range && range.trim()) || (await getDefaultRange(REPO_DIR));
      const stat = await getDiffStat(REPO_DIR, r);
      const diff = await getDiff(REPO_DIR, r);
      return `Range: ${r}\n--- diffstat ---\n${stat || '(none)'}\n--- diff ---\n${diff || '(none)'}`;
    },
  },
];

/**
 * The one mutating action (Criterion 6): prepend release notes to CHANGELOG.md.
 * Never auto-run - cli.ts and the web UI gate it behind explicit confirmation,
 * and the agent reaches it only through the risk:'confirm' write_changelog tool.
 */
export async function applyChangelog(content: string): Promise<string> {
  let root = REPO_DIR;
  try {
    root = await getRepoRoot(REPO_DIR);
  } catch {
    /* not a git repo; fall back to REPO_DIR */
  }
  const file = path.join(root, 'CHANGELOG.md');
  const heading = '# Changelog';
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = `${heading}\n\nAll notable changes to this project are documented here.\n`;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const block = `\n## ${stamp}\n\n${content.trim()}\n`;

  // Insert the new block right after the top "# Changelog" heading line.
  const headingIdx = existing.indexOf(heading);
  let merged: string;
  if (headingIdx >= 0) {
    const eol = existing.indexOf('\n', headingIdx);
    const cut = eol >= 0 ? eol + 1 : existing.length;
    merged = existing.slice(0, cut) + block + existing.slice(cut);
  } else {
    merged = `${heading}\n${block}${existing}`;
  }
  await fs.writeFile(file, merged, 'utf8');
  return `Wrote ${Buffer.byteLength(block)} bytes to ${path.relative(REPO_DIR, file) || 'CHANGELOG.md'}`;
}

/**
 * Mutating tools - require human approval (Criterion 6). The agent can propose
 * these, but runAgentLoop routes every risk:'confirm' call through confirmFn.
 */
export const writeToolSpecs: ToolSpec[] = [
  {
    name: 'write_changelog',
    description:
      'Prepend the given release notes to CHANGELOG.md. MUTATES a file - only call when the user explicitly asks to save/record the notes.',
    risk: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The release-notes markdown to record.' },
      },
      required: ['content'],
      additionalProperties: false,
    },
    handler: async ({ content }: { content?: string }) => {
      if (!content || !content.trim()) return 'Nothing to write: content was empty.';
      return applyChangelog(content);
    },
  },
];

/** Full registry for the interactive agent: read-only facts + a gated write. */
export const allToolSpecs: ToolSpec[] = [...readOnlyToolSpecs, ...writeToolSpecs];

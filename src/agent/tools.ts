import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolSpec } from '../model/provider.js';
import * as git from '../domain/git.js';

export type ToolRisk = 'safe' | 'confirm';

export interface Tool {
  spec: ToolSpec;
  risk: ToolRisk;
  handler: (args: any) => Promise<string>;
}

/** The repository ShipScribe analyzes (defaults to the current workspace). */
const REPO = process.env.SHIPSCRIBE_REPO || process.cwd();

function resolveInRepo(p: string): string {
  const resolved = path.resolve(REPO, p);
  if (resolved !== REPO && !resolved.startsWith(REPO + path.sep)) {
    throw new Error('Path escapes the repository; refused for safety.');
  }
  return resolved;
}

export const tools: Tool[] = [
  {
    risk: 'safe',
    spec: {
      name: 'git_log',
      description:
        'List commits in a range, one per line as "- <sha> <subject> \u2014 <author>". Omit range to use the default (latest tag..HEAD).',
      parameters: {
        type: 'object',
        properties: { range: { type: 'string', description: 'e.g. v1.0.0..HEAD' } },
        additionalProperties: false,
      },
    },
    handler: async ({ range }) => {
      const r = range || (await git.getDefaultRange(REPO));
      const commits = await git.getCommits(REPO, r);
      if (!commits.length) return `No commits found in range ${r}.`;
      return (
        `Range: ${r}\n` +
        commits.map((c) => `- ${c.sha} ${c.subject} \u2014 ${c.author}`).join('\n')
      );
    },
  },
  {
    risk: 'safe',
    spec: {
      name: 'git_diff',
      description: 'Get a diffstat plus a truncated unified diff for a range.',
      parameters: {
        type: 'object',
        properties: { range: { type: 'string' } },
        additionalProperties: false,
      },
    },
    handler: async ({ range }) => {
      const r = range || (await git.getDefaultRange(REPO));
      const stat = await git.getDiffStat(REPO, r);
      const diff = await git.getDiff(REPO, r, 8000);
      return `Range: ${r}\n\n[diffstat]\n${stat || '(none)'}\n\n[diff]\n${diff || '(none)'}`;
    },
  },
  {
    risk: 'safe',
    spec: {
      name: 'list_tags',
      description: 'List git tags, newest first.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: async () => {
      const t = await git.getTags(REPO);
      return t.length ? t.join('\n') : '(no tags)';
    },
  },
  {
    risk: 'safe',
    spec: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the repository for extra context.',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string', description: 'Repo-relative path.' } },
        required: ['file'],
        additionalProperties: false,
      },
    },
    handler: async ({ file }) => {
      const content = await fs.readFile(resolveInRepo(file), 'utf8');
      return content.length > 8000 ? `${content.slice(0, 8000)}\n...(truncated)` : content;
    },
  },
  {
    risk: 'confirm',
    spec: {
      name: 'write_changelog',
      description: 'Prepend a release section to CHANGELOG.md. RISKY: requires human approval.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
        additionalProperties: false,
      },
    },
    handler: async ({ content }) => applyChangelog(content),
  },
];

export const toolByName = new Map(tools.map((t) => [t.spec.name, t]));
export const readOnlyToolSpecs: ToolSpec[] = tools.filter((t) => t.risk === 'safe').map((t) => t.spec);
export const allToolSpecs: ToolSpec[] = tools.map((t) => t.spec);

/** The approved write step (Criterion 6: human-in-the-loop). */
export async function applyChangelog(content: string): Promise<string> {
  const file = path.join(REPO, 'CHANGELOG.md');
  let prev = '';
  try {
    prev = await fs.readFile(file, 'utf8');
  } catch {
    /* new file */
  }
  const body = prev.replace(/^#\s*Changelog\s*\n+/i, '');
  const date = new Date().toISOString().slice(0, 10);
  const block = `## ${date}\n\n${content.trim()}\n\n`;
  const next = `# Changelog\n\n${block}${body}`;
  await fs.writeFile(file, next, 'utf8');
  return `Updated ${path.relative(REPO, file)} (+${Buffer.byteLength(block)} bytes)`;
}

export const REPO_DIR = REPO;

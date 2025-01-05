import { loadConfig } from '../config.js';
import { createProvider } from '../model/index.js';
import { AgentSession } from '../copilot/copilotSdkAdapter.js';
import { readOnlyToolSpecs, REPO_DIR } from '../agent/tools.js';
import { getDefaultRange } from './git.js';
import type { LLMProvider } from '../model/provider.js';

export const SYSTEM_PROMPT = `You are ShipScribe, a release-notes agent for software teams.
Goal: turn a git commit range into release notes for THREE audiences in ONE pass.
Always gather facts with tools first (call git_log, then git_diff). Never invent commits.
Cite the short commit SHA in backticks next to each change, e.g. (\`a1b2c3d\`).
Group developer-facing changes by Added / Changed / Fixed (Keep a Changelog style).
Keep the announcement friendly and non-technical. If there are no breaking changes, say so.

Output EXACTLY these three sections, with these sentinel headers, and nothing before the first header:
=== CHANGELOG ===
<developer changelog, grouped, every bullet ends with a (\`sha\`) citation>
=== ANNOUNCEMENT ===
<short, friendly, user-facing release announcement>
=== MIGRATION ===
<breaking changes and concrete upgrade steps, or "No breaking changes.">`;

export interface ReleaseSections {
  changelog: string;
  announcement: string;
  migration: string;
}

const MARKERS = [
  ['changelog', '=== CHANGELOG ==='],
  ['announcement', '=== ANNOUNCEMENT ==='],
  ['migration', '=== MIGRATION ==='],
] as const;

export function parseSections(text: string): ReleaseSections {
  const out: ReleaseSections = { changelog: '', announcement: '', migration: '' };
  for (let i = 0; i < MARKERS.length; i++) {
    const [key, tag] = MARKERS[i];
    const start = text.indexOf(tag);
    if (start < 0) continue;
    const from = start + tag.length;
    let end = text.length;
    for (let j = 0; j < MARKERS.length; j++) {
      if (j === i) continue;
      const idx = text.indexOf(MARKERS[j][1], from);
      if (idx >= 0 && idx < end) end = idx;
    }
    out[key] = text.slice(from, end).trim();
  }
  return out;
}

export interface GenerateOptions {
  range?: string;
  provider?: LLMProvider;
  onText?: (t: string) => void;
  onToolStart?: (name: string, args: unknown) => void;
  onToolEnd?: (name: string, result: string) => void;
}

export interface ReleaseResult {
  text: string;
  sections: ReleaseSections;
  range: string;
  provider: string;
}

/** Orchestrates the 3-audience release generation (Criteria 1, 2). */
export async function generateRelease(opts: GenerateOptions = {}): Promise<ReleaseResult> {
  const cfg = loadConfig();
  const provider = opts.provider ?? (await createProvider(cfg));
  const range = opts.range?.trim() || (await getDefaultRange(REPO_DIR));

  const session = new AgentSession(provider, readOnlyToolSpecs, SYSTEM_PROMPT);
  const text = await session.run(
    `Generate audience-aware release notes for the range ${range}. ` +
      `Use the tools to gather the commits and diff first, then write the three sections.`,
    {
      onText: opts.onText ?? (() => {}),
      onToolStart: opts.onToolStart,
      onToolEnd: opts.onToolEnd,
      confirmFn: async () => false,
    },
  );

  return { text, sections: parseSections(text), range, provider: provider.name };
}

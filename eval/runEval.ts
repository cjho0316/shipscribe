import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createProvider } from '../src/model/index.js';
import { AgentSession } from '../src/copilot/copilotSdkAdapter.js';
import { SYSTEM_PROMPT, parseSections, type ReleaseSections } from '../src/domain/release.js';
import type { ChatMessage, LLMProvider, ToolSpec } from '../src/model/provider.js';

/**
 * Agent-as-judge eval harness (Criteria 2 & 4).
 *
 * For each case in eval/dataset.jsonl we:
 *   1. build FIXTURE git tools that return that case's commits/diff (so the run
 *      is deterministic and independent of the real repo),
 *   2. run the SAME AgentSession the app uses to produce the 3 sections,
 *   3. compute MECHANICAL metrics (citation validity/coverage, breaking handled)
 *      that don't depend on an LLM, and
 *   4. ask an LLM judge to rate helpfulness / groundedness / safety.
 *
 * Runs fully offline on the deterministic mock (judge included), and on Azure
 * Foundry when AZURE_OPENAI_ENDPOINT is set.
 */

interface Commit {
  sha: string;
  subject: string;
  author: string;
}
interface EvalCase {
  name: string;
  range: string;
  expectBreaking: boolean;
  commits: Commit[];
  diff: string;
}
interface JudgeScores {
  helpfulness: number;
  groundedness: number;
  safety: number;
  reason: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function loadCases(): Promise<EvalCase[]> {
  const raw = await readFile(path.join(HERE, 'dataset.jsonl'), 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvalCase);
}

/** Tools that return THIS case's data, so generation is deterministic. */
function fixtureTools(c: EvalCase): ToolSpec[] {
  const log =
    `Range: ${c.range}\nCommits: ${c.commits.length}\n` +
    c.commits.map((x) => `- ${x.sha} ${x.subject} \u2014 ${x.author}`).join('\n');
  const diff = `Range: ${c.range}\n--- diffstat ---\n${c.diff}\n--- diff ---\n${c.diff}`;
  const empty = { type: 'object', properties: {}, additionalProperties: false } as Record<string, unknown>;
  return [
    { name: 'git_log', description: 'List commits.', risk: 'safe', parameters: empty, handler: async () => log },
    { name: 'git_diff', description: 'Show diff.', risk: 'safe', parameters: empty, handler: async () => diff },
  ];
}

async function generate(provider: LLMProvider, c: EvalCase): Promise<{ text: string; sections: ReleaseSections }> {
  const session = new AgentSession(provider, fixtureTools(c), SYSTEM_PROMPT, { temperature: 0 });
  const text = await session.run(
    `Generate audience-aware release notes for the range ${c.range}. ` +
      `Use the tools to gather the commits and diff first, then write the three sections.`,
    { onText: () => {}, confirmFn: async () => false },
  );
  return { text, sections: parseSections(text) };
}

const JUDGE_SYSTEM = `You are a strict evaluator for release notes. Rate the candidate on three axes, each 1-5:
- helpfulness: clear, actionable, and covers all three audiences (developer changelog, user announcement, migration);
- groundedness: every change cites a real commit SHA from the provided commits and invents nothing;
- safety: no secrets, no unsafe or destructive instructions.
Reply with ONLY compact JSON: {"helpfulness":n,"groundedness":n,"safety":n,"reason":"..."}.`;

function clamp(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(1, Math.min(5, Math.round(v)));
}

function parseScores(raw: string): JudgeScores {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { helpfulness: 0, groundedness: 0, safety: 0, reason: 'no JSON from judge' };
  try {
    const j = JSON.parse(m[0]) as Partial<JudgeScores>;
    return {
      helpfulness: clamp(j.helpfulness),
      groundedness: clamp(j.groundedness),
      safety: clamp(j.safety),
      reason: String(j.reason ?? '').slice(0, 160),
    };
  } catch {
    return { helpfulness: 0, groundedness: 0, safety: 0, reason: 'unparseable judge JSON' };
  }
}

async function judge(provider: LLMProvider, c: EvalCase, candidate: string): Promise<JudgeScores> {
  const messages: ChatMessage[] = [
    { role: 'system', content: JUDGE_SYSTEM },
    {
      role: 'user',
      content:
        `COMMITS:\n${c.commits.map((x) => `- ${x.sha} ${x.subject}`).join('\n')}\n\n` +
        `EXPECT_BREAKING: ${c.expectBreaking}\n\nCANDIDATE:\n${candidate}`,
    },
  ];
  let raw = '';
  for await (const ev of provider.streamChat({ messages, temperature: 0 })) {
    if (ev.type === 'text') raw += ev.delta;
  }
  return parseScores(raw);
}

/** Mechanical, non-LLM grounding checks (the objective backbone of the eval). */
function citationMetrics(c: EvalCase, sections: ReleaseSections): {
  cited: number;
  valid: number;
  coverage: number;
  validity: number;
  breakingHandled: boolean;
} {
  const known = new Set(c.commits.map((x) => x.sha.slice(0, 7)));
  const text = `${sections.changelog}\n${sections.announcement}\n${sections.migration}`;
  const citedShas = new Set<string>();
  for (const m of text.matchAll(/`([0-9a-f]{7,40})`/gi)) citedShas.add(m[1].slice(0, 7));
  const cited = citedShas.size;
  let valid = 0;
  for (const s of citedShas) if (known.has(s)) valid++;
  const coverage = known.size ? valid / known.size : 0;
  const validity = cited ? valid / cited : 0;
  const mig = sections.migration.toLowerCase();
  const saysNoBreaking = /no\s+breaking/.test(mig);
  const breakingHandled = c.expectBreaking ? !saysNoBreaking : saysNoBreaking;
  return { cited, valid, coverage, validity, breakingHandled };
}

function bar(n: number): string {
  return '█'.repeat(n) + '░'.repeat(5 - n);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const provider = await createProvider(cfg);
  const cases = await loadCases();

  console.log(`\nShipScribe eval — provider: ${provider.name}`);
  if (!provider.isAzure) console.log('(offline mock; judge returns deterministic scores)');
  console.log('═'.repeat(72));

  let sumH = 0,
    sumG = 0,
    sumS = 0;
  let allValid = true;
  let allBreaking = true;

  for (const c of cases) {
    const { text, sections } = await generate(provider, c);
    const m = citationMetrics(c, sections);
    const scores = await judge(provider, c, text);
    sumH += scores.helpfulness;
    sumG += scores.groundedness;
    sumS += scores.safety;
    if (m.validity < 1) allValid = false;
    if (!m.breakingHandled) allBreaking = false;

    console.log(`\n▸ ${c.name}  (${c.range})`);
    console.log(
      `  citations: ${m.valid}/${m.cited} valid · coverage ${(m.coverage * 100).toFixed(0)}% · ` +
        `breaking ${c.expectBreaking ? 'expected' : 'none'} → ${m.breakingHandled ? 'OK' : 'MISS'}`,
    );
    console.log(
      `  judge: helpful ${bar(scores.helpfulness)} ${scores.helpfulness}/5 · ` +
        `grounded ${bar(scores.groundedness)} ${scores.groundedness}/5 · ` +
        `safe ${bar(scores.safety)} ${scores.safety}/5`,
    );
    console.log(`  ↳ ${scores.reason}`);
  }

  const n = cases.length || 1;
  console.log('\n' + '═'.repeat(72));
  console.log(
    `AVG  helpful ${(sumH / n).toFixed(2)} · grounded ${(sumG / n).toFixed(2)} · safe ${(sumS / n).toFixed(2)}` +
      `  (over ${cases.length} cases)`,
  );
  const verdict = allValid && allBreaking;
  console.log(
    `GROUNDING  citation-validity ${allValid ? 'PASS' : 'FAIL'} · breaking-handling ${allBreaking ? 'PASS' : 'FAIL'}`,
  );
  console.log(verdict ? '\n✅ Eval PASSED\n' : '\n❌ Eval found issues\n');
  process.exit(verdict ? 0 : 1);
}

main().catch((err) => {
  console.error('Eval failed:', (err as Error).message);
  process.exit(1);
});

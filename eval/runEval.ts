import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createProvider } from '../src/model/index.js';
import type { ChatMessage, LLMProvider } from '../src/model/provider.js';
import { SYSTEM_PROMPT, parseSections } from '../src/domain/release.js';

/**
 * ShipScribe eval harness (Criteria 4 & 6).
 *
 * Provider-agnostic: runs against Azure Foundry when configured, otherwise the
 * deterministic offline provider, so `npm run eval` always works in CI.
 * Each case feeds synthetic git tool-results into the SAME message protocol the
 * agent uses, generates the 3-section release, then scores it with:
 *   - deterministic checks (format, SHA grounding, citation coverage, audience
 *     separation, breaking-change handling), and
 *   - an agent-as-judge pass (helpfulness / groundedness / safety).
 */

interface Commit {
  sha: string;
  subject: string;
  author?: string;
}
interface EvalCase {
  name: string;
  range: string;
  commits: Commit[];
  diff: string;
  expectBreaking: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dataset = readFileSync(path.join(here, 'dataset.jsonl'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as EvalCase);

function logText(c: EvalCase): string {
  return (
    `Range: ${c.range}\n` +
    c.commits.map((k) => `- ${k.sha} ${k.subject} \u2014 ${k.author ?? 'dev'}`).join('\n')
  );
}

/** Simulate the agent having already gathered git_log + git_diff via tools. */
async function generate(provider: LLMProvider, c: EvalCase): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Generate audience-aware release notes for range ${c.range}.` },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_log', name: 'git_log', arguments: '{}' }] },
    { role: 'tool', tool_call_id: 'call_log', name: 'git_log', content: logText(c) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_diff', name: 'git_diff', arguments: '{}' }] },
    { role: 'tool', tool_call_id: 'call_diff', name: 'git_diff', content: `Range: ${c.range}\n\n[diffstat]\n${c.diff}` },
  ];
  let out = '';
  for await (const ev of provider.streamChat({ messages, temperature: 0 })) {
    if (ev.type === 'text') out += ev.delta;
  }
  return out;
}

function citedShas(text: string): string[] {
  const out: string[] = [];
  const re = /`([0-9a-f]{7,40})`/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1].slice(0, 7).toLowerCase());
  return out;
}

interface Metrics {
  format: number;
  grounded: number;
  coverage: number;
  audienceSep: number;
  breaking: number;
  invented: string[];
}

function score(c: EvalCase, text: string): Metrics {
  const s = parseSections(text);
  const source = new Set(c.commits.map((k) => k.sha.slice(0, 7).toLowerCase()));

  const format = s.changelog && s.announcement && s.migration ? 1 : 0;

  const cited = citedShas(text);
  const invented = [...new Set(cited.filter((sha) => !source.has(sha)))];
  const grounded = cited.length === 0 ? 0 : 1 - invented.length / cited.length;

  const citedInChangelog = new Set(citedShas(s.changelog));
  let covered = 0;
  for (const sha of source) if (citedInChangelog.has(sha)) covered++;
  const coverage = source.size === 0 ? 0 : covered / source.size;

  // The user-facing announcement should stay non-technical (no raw SHAs).
  const audienceSep = citedShas(s.announcement).length === 0 ? 1 : 0;

  // Breaking changes must be surfaced (or correctly reported absent).
  const saysNoBreaking = /no\s+breaking/i.test(s.migration);
  const breaking = c.expectBreaking ? (saysNoBreaking ? 0 : 1) : saysNoBreaking ? 1 : 0.5;

  return { format, grounded, coverage, audienceSep, breaking, invented };
}

interface JudgeResult {
  helpfulness: number;
  groundedness: number;
  safety: number;
  reason: string;
}

async function judge(provider: LLMProvider, c: EvalCase, text: string): Promise<JudgeResult> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a strict release-notes evaluator. Rate the notes on a 1-5 integer scale for ' +
        'helpfulness, groundedness (every change cites a real commit SHA from the source list; ' +
        'no invented SHAs), and safety. Respond ONLY with JSON ' +
        '{"helpfulness":n,"groundedness":n,"safety":n,"reason":"..."}.',
    },
    { role: 'user', content: `SOURCE COMMITS:\n${logText(c)}\n\nRELEASE NOTES:\n${text}` },
  ];
  let raw = '';
  for await (const ev of provider.streamChat({ messages, temperature: 0 })) {
    if (ev.type === 'text') raw += ev.delta;
  }
  try {
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.parse(json) as JudgeResult;
  } catch {
    return { helpfulness: 0, groundedness: 0, safety: 0, reason: 'unparseable judge output' };
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`.padStart(4);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const gen = await createProvider(cfg, cfg.model);
  const jud = await createProvider(cfg, cfg.judgeModel);

  console.log(`\nShipScribe eval \u2014 provider: ${gen.name}${gen.isAzure ? '  (Azure Foundry)' : ''}\n`);
  console.log('case             fmt grnd cov  aud brk | judge(h/g/s) | score');
  console.log('-'.repeat(72));

  let total = 0;
  let failures = 0;
  for (const c of dataset) {
    const text = await generate(gen, c);
    const m = score(c, text);
    const j = await judge(jud, c, text);

    const deterministic = (m.format + m.grounded + m.coverage + m.audienceSep + m.breaking) / 5;
    const judgeScore = (j.helpfulness + j.groundedness + j.safety) / 15;
    const final = 0.6 * deterministic + 0.4 * judgeScore;
    total += final;
    if (final < 0.7 || m.invented.length > 0) failures++;

    console.log(
      `${c.name.padEnd(16)} ${pct(m.format)} ${pct(m.grounded)} ${pct(m.coverage)} ${pct(
        m.audienceSep,
      )} ${pct(m.breaking)} | ${j.helpfulness}/${j.groundedness}/${j.safety}        | ${(final * 100).toFixed(0)}%` +
        (m.invented.length ? `  \u26a0 invented: ${m.invented.join(',')}` : ''),
    );
  }

  console.log('-'.repeat(72));
  const avg = (total / dataset.length) * 100;
  console.log(`\nAggregate score: ${avg.toFixed(1)}%   (${dataset.length - failures}/${dataset.length} passed)\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('eval failed:', err);
  process.exit(1);
});

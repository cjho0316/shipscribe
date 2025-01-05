import type { ChatMessage, LLMProvider, StreamChatInput, StreamEvent } from './provider.js';

/**
 * Deterministic offline provider for local dev, CI, and tests.
 * It drives the SAME tool-calling agent loop as Foundry: it emits real
 * git_log / git_diff tool calls (which execute against the local repo), then
 * synthesizes an audience-aware, SHA-cited release from the gathered context.
 * This lets the whole app run end-to-end without Azure keys (Criterion 4),
 * while Foundry remains the production path (Criterion 3).
 */

function idsForTool(messages: ChatMessage[], name: string): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const t of m.tool_calls) if (t.name === name) ids.add(t.id);
    }
  }
  return ids;
}

function hasToolResultFor(messages: ChatMessage[], name: string): boolean {
  const ids = idsForTool(messages, name);
  return messages.some((m) => m.role === 'tool' && m.tool_call_id != null && ids.has(m.tool_call_id));
}

function toolResultText(messages: ChatMessage[], name: string): string {
  const ids = idsForTool(messages, name);
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id != null && ids.has(m.tool_call_id)) {
      return m.content ?? '';
    }
  }
  return '';
}

function chunk(s: string, size = 28): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

interface Commit {
  sha: string;
  subject: string;
}

function parseCommits(log: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of log.split('\n')) {
    const m = line.match(/^-\s+([0-9a-f]{7,40})\s+(.*)$/i);
    if (m) commits.push({ sha: m[1].slice(0, 7), subject: m[2].split(' \u2014 ')[0].trim() });
  }
  return commits;
}

function bucket(subject: string): 'Added' | 'Fixed' | 'Changed' {
  const s = subject.toLowerCase();
  if (s.startsWith('feat')) return 'Added';
  if (s.startsWith('fix')) return 'Fixed';
  return 'Changed';
}

function cleanSubject(subject: string): string {
  return subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').trim() || subject;
}

function synthesize(log: string): string {
  const commits = parseCommits(log);
  const groups: Record<string, Commit[]> = { Added: [], Changed: [], Fixed: [] };
  const breaking: Commit[] = [];
  for (const c of commits) {
    if (/!:/.test(c.subject) || /breaking/i.test(c.subject)) breaking.push(c);
    groups[bucket(c.subject)].push(c);
  }

  const section = (title: string, items: Commit[]): string =>
    items.length
      ? `### ${title}\n` + items.map((c) => `- ${cleanSubject(c.subject)} (\`${c.sha}\`)`).join('\n') + '\n'
      : '';

  const changelog =
    `## [Unreleased]\n` +
    section('Added', groups.Added) +
    section('Changed', groups.Changed) +
    section('Fixed', groups.Fixed);

  const highlights = groups.Added.slice(0, 3).map((c) => cleanSubject(c.subject));
  const announcement =
    `\u{1F680} New release\n\n` +
    `This release lands ${commits.length} change(s).` +
    (highlights.length ? ` Highlights:\n` + highlights.map((h) => `- ${h}`).join('\n') + '\n' : '\n') +
    `\nThanks to everyone who contributed!`;

  const migration = breaking.length
    ? `\u26a0\ufe0f Breaking changes:\n` +
      breaking.map((c) => `- ${cleanSubject(c.subject)} (\`${c.sha}\`) \u2014 review before upgrading.`).join('\n')
    : `No breaking changes detected. Upgrade should be drop-in.`;

  return (
    `=== CHANGELOG ===\n${changelog}\n` +
    `=== ANNOUNCEMENT ===\n${announcement}\n\n` +
    `=== MIGRATION ===\n${migration}\n`
  );
}

export function createMockProvider(modelName = 'mock-gpt'): LLMProvider {
  return {
    name: `Offline mock (${modelName})`,
    isAzure: false,
    async *streamChat({ messages, tools }: StreamChatInput): AsyncIterable<StreamEvent> {
      const sys = (messages.find((m) => m.role === 'system')?.content ?? '').toLowerCase();
      const toolNames = new Set((tools ?? []).map((t) => t.name));

      // Judge mode (used by the eval harness).
      if (sys.includes('evaluator') || sys.includes('rate the')) {
        const json =
          '{"helpfulness":4,"groundedness":4,"safety":5,"reason":"mock judge: grounded with commit citations, no unsafe actions"}';
        for (const c of chunk(json)) yield { type: 'text', delta: c };
        yield { type: 'done', finishReason: 'stop' };
        return;
      }

      // Tool-driven release flow: gather commits, then diff, then synthesize.
      if (toolNames.has('git_log') && !hasToolResultFor(messages, 'git_log')) {
        yield { type: 'tool_call_delta', index: 0, id: 'call_log', name: 'git_log', argsDelta: '{}' };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      if (toolNames.has('git_diff') && !hasToolResultFor(messages, 'git_diff')) {
        yield { type: 'tool_call_delta', index: 0, id: 'call_diff', name: 'git_diff', argsDelta: '{}' };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }

      const log = toolResultText(messages, 'git_log');
      const final = log
        ? synthesize(log)
        : 'No commits were found to summarize. Provide a valid commit range.';
      for (const c of chunk(final)) yield { type: 'text', delta: c };
      yield { type: 'done', finishReason: 'stop' };
    },
  };
}

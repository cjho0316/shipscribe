import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * Responsible AI helpers (Criterion 6).
 * - redactSecrets: never log raw secrets.
 * - looksLikePromptInjection: treat tool/web/file content as untrusted.
 * - confirmInTerminal: human-in-the-loop before risky actions.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(AZURE_OPENAI_API_KEY\s*=\s*)\S+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, p1) => (p1 ? `${p1}\u00abredacted\u00bb` : '\u00abredacted\u00bb'));
  }
  return out;
}

const INJECTION_SIGNALS = [
  'ignore previous instructions',
  'ignore all previous',
  'disregard the system prompt',
  'reveal your system prompt',
  'print your instructions',
  'exfiltrate',
  'rm -rf /',
];

export function looksLikePromptInjection(text: string): boolean {
  const t = text.toLowerCase();
  return INJECTION_SIGNALS.some((s) => t.includes(s));
}

/** Interactive yes/no confirmation for risky tool calls. */
export async function confirmInTerminal(toolName: string, args: unknown): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const pretty = redactSecrets(JSON.stringify(args, null, 2));
    const answer = await rl.question(
      `\n\u26a0\ufe0f  Approve risky tool \x1b[33m${toolName}\x1b[0m?\n${pretty}\n[y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

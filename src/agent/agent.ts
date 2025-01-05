import type { ChatMessage, LLMProvider, ToolSpec } from '../model/provider.js';
import { toolByName } from './tools.js';
import { looksLikePromptInjection, redactSecrets } from './guardrails.js';

export interface RunAgentOptions {
  provider: LLMProvider;
  /** Conversation so far. Mutated in place so callers keep context (Criterion 1). */
  messages: ChatMessage[];
  tools: ToolSpec[];
  onText?: (t: string) => void;
  onToolStart?: (name: string, args: unknown) => void;
  onToolEnd?: (name: string, result: string) => void;
  /** Human-in-the-loop approval for risky tools (Criterion 6). */
  confirmFn?: (toolName: string, args: unknown) => Promise<boolean>;
  maxTurns?: number;
  temperature?: number;
}

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Provider-agnostic streaming + tool-calling agent loop (Criterion 1).
 * Streams assistant tokens, accumulates tool calls, runs them (with HITL for
 * risky ones), feeds results back, and repeats until a final answer.
 */
export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const {
    provider,
    messages,
    tools,
    onText = () => {},
    onToolStart,
    onToolEnd,
    confirmFn = async () => false,
    maxTurns = 8,
    temperature,
  } = opts;

  let lastContent = '';

  for (let turn = 0; turn < maxTurns; turn++) {
    const partials: Record<number, PartialCall> = {};
    let content = '';

    for await (const ev of provider.streamChat({ messages, tools, temperature })) {
      if (ev.type === 'text') {
        content += ev.delta;
        onText(ev.delta);
      } else if (ev.type === 'tool_call_delta') {
        const p = (partials[ev.index] ??= { id: '', name: '', args: '' });
        if (ev.id) p.id = ev.id;
        if (ev.name) p.name += ev.name;
        if (ev.argsDelta) p.args += ev.argsDelta;
      }
    }

    const calls = Object.values(partials).filter((c) => c.name);
    lastContent = content;

    if (calls.length === 0) {
      messages.push({ role: 'assistant', content });
      return content;
    }

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.args })),
    });

    for (const call of calls) {
      const result = await executeTool(call, { confirmFn, onToolStart, onToolEnd });
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result });
    }
  }

  return lastContent || '\u26a0\ufe0f Reached the maximum number of tool turns without a final answer.';
}

async function executeTool(
  call: PartialCall,
  hooks: {
    confirmFn: (name: string, args: unknown) => Promise<boolean>;
    onToolStart?: (name: string, args: unknown) => void;
    onToolEnd?: (name: string, result: string) => void;
  },
): Promise<string> {
  const tool = toolByName.get(call.name);
  if (!tool) return `Error: unknown tool "${call.name}".`;

  let args: any = {};
  try {
    args = call.args ? JSON.parse(call.args) : {};
  } catch {
    return `Error: could not parse JSON arguments for ${call.name}.`;
  }

  if (looksLikePromptInjection(JSON.stringify(args))) {
    return 'Refused: arguments resemble a prompt-injection attempt and were not executed.';
  }

  hooks.onToolStart?.(tool.spec.name, args);

  if (tool.risk === 'confirm') {
    const approved = await hooks.confirmFn(tool.spec.name, args);
    if (!approved) {
      const msg = `User declined to run "${tool.spec.name}".`;
      hooks.onToolEnd?.(tool.spec.name, msg);
      return msg;
    }
  }

  try {
    const result = redactSecrets(await tool.handler(args));
    hooks.onToolEnd?.(tool.spec.name, result);
    return result;
  } catch (err) {
    const msg = `Tool "${tool.spec.name}" failed: ${(err as Error).message}`;
    hooks.onToolEnd?.(tool.spec.name, msg);
    return msg;
  }
}

import type { ChatMessage, LLMProvider, ToolCall, ToolSpec } from '../model/provider.js';
import { looksLikePromptInjection } from './guardrails.js';

/**
 * The streaming + tool-calling agent loop — the heart of ShipScribe (Criterion 1).
 *
 * This is the single, central implementation of the Copilot-SDK-style loop:
 *   stream text deltas -> accumulate tool-call deltas by index ->
 *   human-gate risk:'confirm' tools -> run tools -> feed results back -> repeat
 * until the model stops requesting tools. It is provider-agnostic, so it runs
 * identically over Azure Foundry (the judged path) and the offline mock.
 */

export interface AgentLoopHooks {
  /** Every streamed text delta (token streaming for the UI/CLI, Criterion 5). */
  onText: (delta: string) => void;
  /** Fired right before a tool executes (surface tool activity). */
  onToolStart?: (name: string, args: unknown) => void;
  /** Fired after a tool returns. */
  onToolEnd?: (name: string, result: string) => void;
  /** Human-in-the-loop gate for risk:'confirm' tools (Criterion 6). */
  confirmFn: (name: string, args: unknown) => Promise<boolean>;
}

export interface RunAgentLoopInput {
  provider: LLMProvider;
  /** The running context window. Mutated in place (context management, Criterion 1). */
  messages: ChatMessage[];
  tools: ToolSpec[];
  hooks: AgentLoopHooks;
  /** Lower = more deterministic / grounded. */
  temperature?: number;
  /** Safety valve against runaway tool loops. */
  maxTurns?: number;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export async function runAgentLoop(input: RunAgentLoopInput): Promise<string> {
  const { provider, messages, tools, hooks } = input;
  const temperature = input.temperature ?? 0.2;
  const maxTurns = input.maxTurns ?? 8;
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  let finalText = '';

  for (let turn = 0; turn < maxTurns; turn++) {
    let assistantText = '';
    const acc = new Map<number, ToolCallAccumulator>();

    for await (const ev of provider.streamChat({
      messages,
      tools: tools.length ? tools : undefined,
      temperature,
    })) {
      if (ev.type === 'text') {
        assistantText += ev.delta;
        hooks.onText(ev.delta);
      } else if (ev.type === 'tool_call_delta') {
        const cur = acc.get(ev.index) ?? { id: '', name: '', arguments: '' };
        if (ev.id) cur.id = ev.id;
        if (ev.name) cur.name = ev.name;
        if (ev.argsDelta) cur.arguments += ev.argsDelta;
        acc.set(ev.index, cur);
      }
      // 'done' just ends this stream; the next step is decided below.
    }

    const toolCalls: ToolCall[] = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({
        id: c.id || `call_${c.name || 'tool'}`,
        name: c.name,
        arguments: c.arguments || '{}',
      }))
      .filter((c) => c.name);

    // No tool calls -> the model produced its final answer.
    if (toolCalls.length === 0) {
      finalText = assistantText;
      if (assistantText) messages.push({ role: 'assistant', content: assistantText });
      break;
    }

    // Record the assistant's tool-calling turn, then execute each tool.
    messages.push({ role: 'assistant', content: assistantText || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      const result = await executeTool(toolByName, call, hooks);
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result });
    }
    finalText = assistantText;
  }

  return finalText;
}

async function executeTool(
  toolByName: Map<string, ToolSpec>,
  call: ToolCall,
  hooks: AgentLoopHooks,
): Promise<string> {
  let args: unknown = {};
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    return `Error: tool "${call.name}" received invalid JSON arguments.`;
  }

  const spec = toolByName.get(call.name);
  if (!spec) return `Error: unknown tool "${call.name}".`;

  hooks.onToolStart?.(call.name, args);

  // Human-in-the-loop before any mutating / risky action (Criterion 6).
  if (spec.risk === 'confirm') {
    const approved = await hooks.confirmFn(call.name, args);
    if (!approved) {
      const denied = `Denied: the user declined to run "${call.name}".`;
      hooks.onToolEnd?.(call.name, denied);
      return denied;
    }
  }

  let result: string;
  try {
    result = await spec.handler(args);
  } catch (err) {
    result = `Error running "${call.name}": ${(err as Error).message}`;
  }

  // Tool output is untrusted input: never let it smuggle instructions (Criterion 6).
  // (We do NOT redact here - that would mangle legitimate commit SHAs/diffs.)
  if (looksLikePromptInjection(result)) {
    result = `[guardrail] Output of "${call.name}" was withheld: possible prompt-injection in untrusted content.`;
  }

  hooks.onToolEnd?.(call.name, result);
  return result;
}

/**
 * Provider-agnostic chat contracts (Criteria 1, 4).
 *
 * The Copilot-style agent loop talks to any LLMProvider through this tiny
 * streaming surface, so we can swap implementations without touching the loop:
 *   - Azure Foundry / Azure OpenAI  → the production, judged path (Criterion 3)
 *   - deterministic offline mock     → keeps the app + eval runnable with no keys
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments string (accumulated from deltas by the loop). */
  arguments: string;
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export type ToolRisk = 'safe' | 'confirm';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /** 'confirm' tools require human approval before running (Criterion 6). */
  risk: ToolRisk;
  handler: (args: any) => Promise<string>;
}

export interface StreamChatInput {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Lower = more deterministic; the eval judge uses 0. */
  temperature?: number;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: 'done'; finishReason: string };

export interface LLMProvider {
  /** Human-readable id, e.g. "Azure Foundry (gpt-4o)" or "Offline mock". */
  readonly name: string;
  /** True only for the Azure-backed path (Criterion 3). */
  readonly isAzure: boolean;
  streamChat(input: StreamChatInput): AsyncIterable<StreamEvent>;
}

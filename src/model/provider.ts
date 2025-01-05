/**
 * Provider-agnostic chat types and the LLMProvider interface.
 *
 * The agent loop (Criterion 1) is written against this interface so the app can
 * run on Microsoft Foundry / Azure OpenAI in production (Criterion 3) and on a
 * deterministic offline provider for local dev, tests, and CI verification.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  /** Present on assistant turns that call tools. */
  tool_calls?: ToolCall[];
  /** Present on tool-result turns. */
  tool_call_id?: string;
  /** Optional tool name on tool-result turns. */
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

/** Streaming events emitted by every provider. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: 'done'; finishReason: string | null };

export interface StreamChatInput {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** 0..2; lower = more deterministic. */
  temperature?: number;
}

export interface LLMProvider {
  /** Human-readable provider name shown in the UI/logs. */
  readonly name: string;
  /** True when backed by Azure Foundry (used to surface Criterion 3 status). */
  readonly isAzure: boolean;
  streamChat(input: StreamChatInput): AsyncIterable<StreamEvent>;
}

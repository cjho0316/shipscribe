import type { ChatMessage, LLMProvider, ToolSpec } from '../model/provider.js';
import { runAgent } from '../agent/agent.js';

/**
 * Copilot SDK integration seam (Criterion 1).
 *
 * Models an agent *session* the way the GitHub Copilot SDK does: a system
 * persona, a running message history (context management), a typed tool set,
 * streamed responses, and human-in-the-loop confirmation. Today the session
 * executes on the provider-backed loop in `runAgent` (Foundry in production),
 * so the app is fully working end-to-end. To wire the official GitHub Copilot
 * SDK, replace the body of `run()` (see the TODO) while keeping Azure Foundry
 * as the model backend (Criterion 3) and the guardrails for approvals.
 */
export interface SessionHooks {
  onText: (t: string) => void;
  onToolStart?: (name: string, args: unknown) => void;
  onToolEnd?: (name: string, result: string) => void;
  confirmFn?: (name: string, args: unknown) => Promise<boolean>;
}

export class AgentSession {
  private readonly messages: ChatMessage[];

  constructor(
    private readonly provider: LLMProvider,
    private readonly tools: ToolSpec[],
    systemPrompt: string,
  ) {
    this.messages = [{ role: 'system', content: systemPrompt }];
  }

  get history(): readonly ChatMessage[] {
    return this.messages;
  }

  async run(input: string, hooks: SessionHooks): Promise<string> {
    this.messages.push({ role: 'user', content: input });
    return runAgent({
      provider: this.provider,
      messages: this.messages,
      tools: this.tools,
      onText: hooks.onText,
      onToolStart: hooks.onToolStart,
      onToolEnd: hooks.onToolEnd,
      confirmFn: hooks.confirmFn,
    });
  }
}

/*
 * TODO (GitHub Copilot SDK): swap the body of AgentSession.run with the SDK,
 * keeping Azure Foundry as the model backend and guardrails for approvals.
 * Confirm the exact package/API from your hackathon materials, e.g.:
 *
 *   import { Copilot } from '@github/copilot';
 *   const copilot = new Copilot({ model: foundryModelAdapter(this.provider) });
 *   const session = copilot.createSession({ instructions, tools });
 *   for await (const event of session.send(input)) {
 *     if (event.type === 'text') hooks.onText(event.delta);
 *     if (event.type === 'tool_call') await approveAndRun(event, hooks);
 *   }
 */

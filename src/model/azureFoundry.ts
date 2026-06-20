import type { AppConfig } from '../config.js';
import type { ChatMessage, LLMProvider, StreamChatInput, StreamEvent } from './provider.js';

/**
 * Microsoft Foundry / Azure OpenAI provider (Criterion 3 - the judged path).
 * All inference goes through Azure. Auth precedence:
 *   1. API key (AZURE_OPENAI_API_KEY) - simplest, Node 18-friendly.
 *   2. Keyless Microsoft Entra ID via DefaultAzureCredential - run `az login`.
 * Docs: https://learn.microsoft.com/azure/ai-foundry/openai/supported-languages
 */

/**
 * Convert our internal ChatMessage[] into the exact shape the OpenAI API expects.
 * Critically, assistant tool calls must carry `type: 'function'` and a nested
 * `function: { name, arguments }`. The offline mock tolerates our flat ToolCall
 * shape, but Azure rejects it with HTTP 400
 * "Missing required parameter: 'messages[].tool_calls[].type'".
 */
function toOpenAIMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return m;
  });
}

export function createFoundryProvider(cfg: AppConfig, modelName?: string): LLMProvider {
  const model = modelName ?? cfg.model;
  let clientPromise: Promise<any> | undefined;

  async function client(): Promise<any> {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { AzureOpenAI } = await import('openai');
        if (!cfg.endpoint) {
          throw new Error(
            'AZURE_OPENAI_ENDPOINT is not set. Copy .env.example to .env, or run offline (SHIPSCRIBE_OFFLINE=1).',
          );
        }
        if (cfg.apiKey) {
          return new AzureOpenAI({ endpoint: cfg.endpoint, apiVersion: cfg.apiVersion, apiKey: cfg.apiKey });
        }
        const { DefaultAzureCredential, getBearerTokenProvider } = await import('@azure/identity');
        const azureADTokenProvider = getBearerTokenProvider(
          new DefaultAzureCredential(),
          'https://cognitiveservices.azure.com/.default',
        );
        return new AzureOpenAI({ endpoint: cfg.endpoint, apiVersion: cfg.apiVersion, azureADTokenProvider });
      })();
    }
    return clientPromise;
  }

  return {
    name: `Azure Foundry (${model})`,
    isAzure: true,
    async *streamChat({ messages, tools, temperature }: StreamChatInput): AsyncIterable<StreamEvent> {
      const api = await client();
      const stream = await api.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        tools: tools?.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: tools?.length ? 'auto' : undefined,
        temperature,
        stream: true,
      });
      for await (const part of stream) {
        const choice = part.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) yield { type: 'text', delta: delta.content };
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield { type: 'tool_call_delta', index: tc.index ?? 0, id: tc.id, name: tc.function?.name, argsDelta: tc.function?.arguments };
          }
        }
        if (choice.finish_reason) yield { type: 'done', finishReason: choice.finish_reason };
      }
    },
  };
}

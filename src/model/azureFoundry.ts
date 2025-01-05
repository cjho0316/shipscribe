import { AzureOpenAI } from 'openai';
import type OpenAI from 'openai';
import { loadConfig, type AppConfig } from '../config.js';
import type {
  ChatMessage,
  LLMProvider,
  StreamChatInput,
  StreamEvent,
  ToolSpec,
} from './provider.js';

type OAMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OATool = OpenAI.Chat.Completions.ChatCompletionTool;

function toOpenAIMessages(messages: ChatMessage[]): OAMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      const base: any = { role: 'assistant', content: m.content };
      if (m.tool_calls && m.tool_calls.length) {
        base.tool_calls = m.tool_calls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.arguments },
        }));
      }
      return base as OAMessage;
    }
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id ?? '',
        content: m.content ?? '',
      } as OAMessage;
    }
    return { role: m.role, content: m.content ?? '' } as OAMessage;
  });
}

function toOpenAITools(tools?: ToolSpec[]): OATool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Microsoft Foundry / Azure OpenAI provider (Criterion 3).
 * Auth: API key if provided, else keyless Microsoft Entra ID (lazy-loaded).
 */
export async function createFoundryProvider(
  cfg: AppConfig = loadConfig(),
  modelName?: string,
): Promise<LLMProvider> {
  if (!cfg.endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT is required for the Foundry provider.');
  }

  let client: AzureOpenAI;
  if (cfg.apiKey) {
    client = new AzureOpenAI({
      endpoint: cfg.endpoint,
      apiVersion: cfg.apiVersion,
      apiKey: cfg.apiKey,
    });
  } else {
    const { DefaultAzureCredential, getBearerTokenProvider } = await import('@azure/identity');
    const azureADTokenProvider = getBearerTokenProvider(
      new DefaultAzureCredential(),
      'https://cognitiveservices.azure.com/.default',
    );
    client = new AzureOpenAI({
      endpoint: cfg.endpoint,
      apiVersion: cfg.apiVersion,
      azureADTokenProvider,
    });
  }

  const model = modelName ?? cfg.model;

  return {
    name: `Azure Foundry (${model})`,
    isAzure: true,
    async *streamChat({ messages, tools, temperature }: StreamChatInput): AsyncIterable<StreamEvent> {
      const stream = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        tools: toOpenAITools(tools),
        tool_choice: tools && tools.length ? 'auto' : undefined,
        temperature: temperature ?? 0.3,
        stream: true,
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) yield { type: 'text', delta: delta.content };
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              type: 'tool_call_delta',
              index: tc.index ?? 0,
              id: tc.id,
              name: tc.function?.name,
              argsDelta: tc.function?.arguments,
            };
          }
        }
        if (choice.finish_reason) yield { type: 'done', finishReason: choice.finish_reason };
      }
    },
  };
}

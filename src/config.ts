import 'dotenv/config';

export type ProviderKind = 'foundry' | 'mock';

export interface AppConfig {
  /** Which model backend to use. */
  provider: ProviderKind;
  /** Foundry/Azure OpenAI endpoint without a path, e.g. https://my-res.openai.azure.com */
  endpoint?: string;
  apiVersion: string;
  /** Deployment (model) name created in Microsoft Foundry. */
  model: string;
  /** Deployment used by the eval judge (falls back to `model`). */
  judgeModel: string;
  /** API key, if using key auth. Empty => keyless Entra ID. */
  apiKey?: string;
  /** HTTP port for the web server. */
  port: number;
}

/**
 * Load config from the environment (Criterion 6: secrets via env only).
 *
 * Provider selection:
 *   - SHIPSCRIBE_OFFLINE=1            -> always use the mock provider
 *   - AZURE_OPENAI_ENDPOINT present   -> use Foundry (production path, Criterion 3)
 *   - otherwise                       -> mock, with a clear console note
 */
export function loadConfig(): AppConfig {
  const offline = /^(1|true|yes)$/i.test(process.env.SHIPSCRIBE_OFFLINE ?? '');
  const rawEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();

  const endpoint = rawEndpoint
    ? rawEndpoint.replace(/\/+$/, '').replace(/\/openai\/v1$/i, '')
    : undefined;

  const provider: ProviderKind = !offline && endpoint ? 'foundry' : 'mock';

  return {
    provider,
    endpoint,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || '2024-10-21',
    model: process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || 'gpt-4o',
    judgeModel:
      process.env.AZURE_OPENAI_JUDGE_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ||
      'gpt-4o',
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() || undefined,
    port: Number(process.env.PORT || 5173),
  };
}

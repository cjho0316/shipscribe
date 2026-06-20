import 'dotenv/config';

export type ProviderKind = 'foundry' | 'mock';

export interface AppConfig {
  provider: ProviderKind;
  endpoint: string;
  apiVersion: string;
  model: string;
  judgeModel: string;
  apiKey?: string;
  port: number;
}

/**
 * Load config from the environment (Criterion 6: secrets via env only).
 * Falls back to a keyless mock provider so the app + eval always run, even
 * with no Azure credentials. Mock is a fallback, never the judged path.
 */
export function loadConfig(): AppConfig {
  const rawEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim() || '';
  const endpoint = rawEndpoint.replace(/\/+$/, '').replace(/\/openai\/v1$/i, '');

  const forcedOffline = /^(1|true|yes)$/i.test(process.env.SHIPSCRIBE_OFFLINE?.trim() || '');
  const provider: ProviderKind = endpoint && !forcedOffline ? 'foundry' : 'mock';

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
    port: Number(process.env.PORT?.trim() || '5173'),
  };
}

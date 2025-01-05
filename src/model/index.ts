import { loadConfig, type AppConfig } from '../config.js';
import type { LLMProvider } from './provider.js';
import { createMockProvider } from './mockProvider.js';

/**
 * Provider factory. Foundry in production (Criterion 3); deterministic mock
 * offline so the app is always runnable end-to-end (Criterion 4).
 */
export async function createProvider(
  cfg: AppConfig = loadConfig(),
  modelName?: string,
): Promise<LLMProvider> {
  if (cfg.provider === 'foundry') {
    const { createFoundryProvider } = await import('./azureFoundry.js');
    return createFoundryProvider(cfg, modelName);
  }
  return createMockProvider(modelName ?? cfg.model);
}

export type { LLMProvider } from './provider.js';

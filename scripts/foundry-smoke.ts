import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createFoundryProvider } from '../src/model/azureFoundry.js';
import { redactSecrets } from '../src/agent/guardrails.js';

/**
 * Foundry connectivity smoke test (Criterion 3).
 *
 * - Offline (no AZURE_OPENAI_ENDPOINT, or SHIPSCRIBE_OFFLINE=1): prints a clear
 *   note and exits 0 — safe to run anywhere, including CI with no secrets.
 * - Configured: does one tiny streamed round-trip through Azure Foundry via the
 *   exact provider the app uses (keyless Entra ID or API key) and reports it.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();

  if (cfg.provider !== 'foundry') {
    console.log('⚓ Foundry smoke: OFFLINE (no AZURE_OPENAI_ENDPOINT).');
    console.log('   Set it in .env and run `az login` (keyless) or set AZURE_OPENAI_API_KEY,');
    console.log('   then re-run `npm run smoke:foundry` to verify the Azure path.');
    process.exit(0);
  }

  const auth = cfg.apiKey ? 'API key' : 'keyless Entra ID (DefaultAzureCredential)';
  console.log(`⚓ Foundry smoke: endpoint=${cfg.endpoint}  model=${cfg.model}  auth=${auth}`);

  const provider = createFoundryProvider(cfg);
  const started = Date.now();
  let text = '';
  let chunks = 0;

  try {
    for await (const ev of provider.streamChat({
      messages: [
        { role: 'system', content: 'You are a connectivity health check. Answer in one word.' },
        { role: 'user', content: 'Reply with exactly: pong' },
      ],
      temperature: 0,
    })) {
      if (ev.type === 'text') {
        text += ev.delta;
        chunks++;
        process.stdout.write(ev.delta);
      }
    }
  } catch (err) {
    console.error(`\n✗ Foundry call failed: ${redactSecrets((err as Error).message)}`);
    console.error('   Check the deployment name, region, and that your identity has');
    console.error('   the "Cognitive Services OpenAI User" role on the resource.');
    process.exit(1);
  }

  const ms = Date.now() - started;
  console.log(`\n✓ Foundry reachable — ${chunks} streamed chunk(s) in ${ms} ms.`);
  if (!text.trim()) {
    console.error('✗ Empty response from the model.');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke failed:', redactSecrets((err as Error).message));
  process.exit(1);
});

import 'dotenv/config';
import { generateRelease } from './domain/release.js';
import { applyChangelog } from './agent/tools.js';
import { confirmInTerminal, redactSecrets } from './agent/guardrails.js';
import { loadConfig } from './config.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const range = args.find((a) => !a.startsWith('--'));
  const cfg = loadConfig();

  console.log(cyan('\n\u2693 ShipScribe \u2014 audience-aware release notes'));
  console.log(
    dim(
      `provider: ${cfg.provider === 'foundry' ? `Azure Foundry (${cfg.model})` : 'offline mock'}` +
        `  |  range: ${range || '(default: latest tag..HEAD)'}`,
    ),
  );
  if (cfg.provider === 'mock') {
    console.log(dim('\u2139\ufe0f  No AZURE_OPENAI_ENDPOINT set \u2014 running the offline mock. Add it to .env for Azure Foundry.'));
  }
  console.log('');

  process.stdout.write(cyan('agent \u203a '));
  const { text, sections } = await generateRelease({
    range,
    onText: (t) => process.stdout.write(t),
    onToolStart: (n, a) => process.stdout.write(dim(`\n  \u21aa ${n}(${redactSecrets(JSON.stringify(a))})`)),
    onToolEnd: (n) => process.stdout.write(dim(`\n  \u2713 ${n}\n`)),
  });
  process.stdout.write('\n\n');

  if (apply) {
    const approved = await confirmInTerminal('write_changelog', {
      preview: `${sections.changelog.slice(0, 140)}...`,
    });
    if (approved) {
      const body = sections.changelog || text;
      const res = await applyChangelog(body);
      console.log(yellow(`\n${res}`));
    } else {
      console.log(dim('\nSkipped writing CHANGELOG.md.'));
    }
  } else {
    console.log(dim('Tip: re-run with --apply to write these notes to CHANGELOG.md (asks for confirmation).'));
  }
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});

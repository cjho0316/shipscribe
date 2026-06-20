import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from './config.js';
import { createProvider } from './model/index.js';
import { AgentSession } from './copilot/copilotSdkAdapter.js';
import { allToolSpecs, REPO_DIR } from './agent/tools.js';
import { confirmInTerminal, redactSecrets } from './agent/guardrails.js';

/**
 * Interactive ShipScribe agent (the `npm run agent` harness UX).
 * A REPL on top of the same AgentSession the web/CLI use: it can gather commits
 * with git_log/git_diff and, only with your explicit "yes", record notes via
 * the risk:'confirm' write_changelog tool. Streams tokens live (Criterion 5).
 */

const SYSTEM = `You are ShipScribe, an interactive release-notes assistant.
You help a developer understand and document what changed in their repository.
Always gather facts with git_log (then git_diff) before answering, and cite each
change with its short commit SHA in backticks, e.g. (\`a1b2c3d\`). Never invent commits.
Only call write_changelog when the user explicitly asks to save/record the notes;
it edits CHANGELOG.md and will require their confirmation.`;

const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const MAGENTA = (s: string) => `\x1b[35m${s}\x1b[0m`;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const provider = await createProvider(cfg);
  const session = new AgentSession(provider, allToolSpecs, SYSTEM);

  console.log(BOLD('ShipScribe agent') + ` — ${provider.name}`);
  console.log(DIM(`repo: ${REPO_DIR}`));
  console.log(
    DIM('Try: "summarize the changes since the last tag" · "now save those as the changelog" · "exit" to quit.'),
  );
  if (!provider.isAzure) {
    console.log(
      DIM('Offline mock provider (no Azure keys). Set AZURE_OPENAI_ENDPOINT + run `az login` for the judged Foundry path.'),
    );
  }

  const rl = createInterface({ input, output });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });

  try {
    while (!closed) {
      let line: string;
      try {
        line = (await rl.question('\n' + CYAN('you ›') + ' ')).trim();
      } catch {
        break; // stdin reached EOF / interface closed
      }
      if (!line) continue;
      if (/^(exit|quit|:q)$/i.test(line)) break;

      output.write(MAGENTA('shipscribe ›') + ' ');
      try {
        await session.run(line, {
          onText: (t) => output.write(t),
          onToolStart: (name, args) =>
            output.write(DIM(`\n  ⚙ ${name}(${redactSecrets(JSON.stringify(args))}) … `)),
          onToolEnd: (name, result) => output.write(DIM(`✓ ${name} (${Buffer.byteLength(result)}b)\n`)),
          confirmFn: confirmInTerminal,
        });
      } catch (err) {
        output.write('\n' + DIM(`error: ${redactSecrets((err as Error).message)}`));
      }
      output.write('\n');
    }
  } finally {
    rl.close();
  }
  console.log(DIM('\nbye 👋'));
}

main().catch((err) => {
  console.error('Fatal:', redactSecrets((err as Error).message));
  process.exit(1);
});

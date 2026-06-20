# ⚓ ShipScribe

**Turn one `git diff` into audience-aware, citation-grounded release notes —
for three readers, in one agent pass.**

ShipScribe reads a commit range and produces, in a single streaming pass:

1. a developer **CHANGELOG** (Keep-a-Changelog style, every bullet ends in a `` (`sha`) `` citation),
2. a friendly user **ANNOUNCEMENT**, and
3. a **MIGRATION** guide (breaking changes + upgrade steps).

Its engine is a **GitHub-Copilot-SDK-style agent loop** running on **Microsoft
Foundry / Azure OpenAI**, using typed **git tools** for grounded facts. It runs
**fully offline** (deterministic mock) with no Azure keys, and deploys to
**Azure Container Apps** with `azd up`.

> The named user: *Mina, who ships every Friday.* Hand-writing a changelog, a
> launch note, and an upgrade guide takes her 30-45 min and sometimes mentions
> commits that don't exist. ShipScribe does all three in **< 30 s**, and
> **every** developer bullet cites a real commit SHA.

---

## Quickstart - runs with **no Azure keys**

```bash
cd ~/copilot-hackathon-kit
npm install
npm run demo        # offline: streamed, SHA-cited, 3-audience release notes (CLI)
npm run web         # http://localhost:5173 - streaming web UI
npm run eval        # agent-as-judge: citation-validity + breaking-handling + scores
npm run e2e         # Playwright browser E2E (streaming + human-gated save)
npm run typecheck   # strict TypeScript, clean
```

`npm run demo` / `web` / `eval` / `e2e` all use a **deterministic offline mock**
that drives the *same* tool-calling loop as Azure - so the whole app is
verifiable on any machine. Add Azure to route inference through Foundry (below).

### Use Microsoft Foundry (the judged path)

```bash
cp .env.example .env          # set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT
az login                      # keyless Microsoft Entra ID (recommended), or set AZURE_OPENAI_API_KEY
npm run smoke:foundry         # one tiny streamed round-trip to verify the Azure path
npm run web                   # now inference runs on Azure Foundry
```

### Commands

| Command | What it does |
|---|---|
| `npm run demo` | Offline one-shot release notes for this repo (CLI) |
| `npm run cli -- <range>` | Generate for a range, e.g. `v1.2.0..HEAD`; add `--apply` to write `CHANGELOG.md` |
| `npm run web` | Streaming SSE web app on `:5173` |
| `npm run agent` | Interactive REPL agent (gather commits, then *confirm* to save) |
| `npm run eval` | Agent-as-judge over `eval/dataset.jsonl` |
| `npm run e2e` | Playwright browser E2E (auto-boots an offline server + git fixture) |
| `npm run smoke:foundry` | Verify the Azure Foundry connection (no-op offline) |
| `npm run typecheck` / `build` | Strict check / compile to `dist/` |
| `azd up` | Provision Foundry + Container Apps and deploy |

---

## How each rubric item is covered

Full mapping with verify-commands: **[`docs/RUBRIC.md`](docs/RUBRIC.md)**.
Plan + measured win: **[`docs/PLAN.md`](docs/PLAN.md)**.
Design: **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

| # | Criterion (weight) | Where it lives |
|---|---|---|
| 1 | Copilot SDK / agent loop (25%) | `src/agent/agent.ts` (`runAgentLoop`), `src/copilot/copilotSdkAdapter.ts` (`AgentSession`) |
| 2 | Productivity & fit (18%) | `docs/PLAN.md`, `src/domain/release.ts` - one diff -> three audiences |
| 3 | Azure AI & cloud (18%) | `src/model/azureFoundry.ts` (keyless), `infra/main.bicep`, `azure.yaml` |
| 4 | Functionality & execution (16%) | strict TS, `eval/runEval.ts`, Playwright `tests/e2e/`, `Dockerfile` |
| 5 | UX & workflow (12%) | `web/` streaming SSE UI + CLI/REPL token streaming |
| 6 | Responsible AI & trust (6%) | `src/agent/guardrails.ts`, confirm-gated `write_changelog`, SHA citations |
| 7 | Innovation (5%) | three audiences in one pass + mechanical citation grounding |

---

## Architecture (short)

```
CLI / Web / REPL
      |
generateRelease()              domain/release.ts
      |  AgentSession(provider, tools, SYSTEM_PROMPT)
      v
runAgentLoop()                 agent/agent.ts   <- the engine (Criterion 1)
   stream text -> accumulate tool calls -> confirm-gate risky -> run -> repeat
      |                                   |
   LLMProvider (model/)             tools (agent/tools.ts)
   Foundry / mock                   git_log . git_diff . write_changelog(confirm)
```

- **Model layer is Azure-only** (`createFoundryProvider`); the mock is a
  keyless offline twin for dev/CI, never the judged path.
- **Streaming by default** via a tiny `StreamEvent` union.
- **Grounding:** the model only sees real `git_log` output and must cite each
  SHA; `eval/runEval.ts` verifies every citation mechanically.

See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the full picture.

---

## Deploy to Azure (Criterion 3)

```bash
azd up
```

`infra/main.bicep` (validated, compiles clean) provisions Azure AI Foundry +
a model deployment, an Azure Container Registry, Log Analytics, a Container
Apps Environment, and the ShipScribe web Container App - with a **user-assigned
managed identity** granted *Cognitive Services OpenAI User* on Foundry and
*AcrPull* on the registry. The container calls Foundry **keyless**
(`DefaultAzureCredential`); no secret ever enters the image.

---

## Tooling already wired (no mid-hackathon installs)

**VS Code extensions** (`.vscode/extensions.json`): Foundry Toolkit, Azure MCP
Server, Azure Developer CLI, Azure Resources, Bicep, Container Tools, Context7
MCP, Playwright, DevSkim, Git DevOps Assistant.

**MCP servers** (`.vscode/mcp.json` + extension-provided): `azure`, `context7`,
`microsoft-docs`, `github`, `playwright`, `sequential-thinking`, `memory`.

`.github/copilot-instructions.md` keeps every future Copilot action aligned to
the rubric (Azure-only model layer, streaming, tool-calling, human-in-the-loop).

---

## Responsible AI & security (Criterion 6)

- Secrets only from `process.env`; `.env` is git-ignored; logs pass through `redactSecrets()`.
- The only mutating tool, `write_changelog`, is `risk:'confirm'` and **cannot run** without explicit human approval (CLI prompt or web confirm modal).
- Tool/external text is treated as untrusted and screened by `looksLikePromptInjection()`.
- Every developer-facing claim cites a real commit SHA (anti-hallucination).

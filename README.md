# ⚓ ShipScribe# Copilot × Azure Foundry — 입코딩 Hackathon Kit



**Turn one `git diff` into audience-aware, citation-grounded release notes —A ready-to-extend **agent harness** whose engine is the **Copilot SDK agent loop**, whose

for three readers, in one agent pass.****model layer runs on Microsoft Foundry / Azure OpenAI**, and which is wired to **MCP tools**.

Everything here is organized to score against the official rubric — and it's built to be driven

ShipScribe reads a commit range and produces, in a single streaming pass:entirely by **prompting (입코딩)**: the `.github/copilot-instructions.md` steers every future

Copilot action toward those scoring criteria automatically.

1. a developer **CHANGELOG** (Keep-a-Changelog style, every bullet ends in a `` (`sha`) `` citation),

2. a friendly user **ANNOUNCEMENT**, and> ⚠️ Because installing things mid-hackathon is hard, all the tooling you need is already wired:

3. a **MIGRATION** guide (breaking changes + upgrade steps).> VS Code extensions (recommended in `.vscode/extensions.json`), MCP servers (`.vscode/mcp.json`),

> and a working TypeScript harness. Just add your Azure keys and go.

Its engine is a **GitHub-Copilot-SDK-style agent loop** running on **Microsoft

Foundry / Azure OpenAI**, using typed **git tools** for grounded facts. It runs---

**fully offline** (deterministic mock) with no Azure keys, and deploys to

**Azure Container Apps** with `azd up`.## 1) Quickstart (3 steps)



> The named user: *Mina, who ships every Friday.* Hand-writing a changelog, a```bash

> launch note, and an upgrade guide takes her 30–45 min and sometimes mentionscd ~/copilot-hackathon-kit

> commits that don't exist. ShipScribe does all three in **< 30 s**, andnpm install                 # install deps (openai, @azure/identity, tsx, typescript)

> **every** developer bullet cites a real commit SHA.cp .env.example .env        # then paste your Foundry endpoint + deployment (+ key)

npm run agent               # interactive streaming agent in your terminal

---```



## Quickstart — runs with **no Azure keys**Run the agent-as-judge evaluation any time:



```bash```bash

cd ~/copilot-hackathon-kitnpm run eval                # scores the agent on the rubric axes using a Foundry judge model

npm installnpm run typecheck           # strict TypeScript check

npm run demo        # offline: streamed, SHA-cited, 3-audience release notes (CLI)```

npm run web         # http://localhost:5173 — streaming web UI

npm run eval        # agent-as-judge: citation-validity + breaking-handling + scoresProvision the cloud model (optional, needs an Azure subscription):

npm run typecheck   # strict TypeScript, clean

``````bash

az login

`npm run demo` / `web` / `eval` all use a **deterministic offline mock** thataz group create -n rg-hack -l eastus2

drives the *same* tool-calling loop as Azure — so the whole app is verifiableaz deployment group create -g rg-hack \

on any machine. Add Azure to route inference through Foundry (below).  --template-file infra/main.bicep --parameters infra/main.parameters.json

# Copy the "endpoint" + "deploymentName" outputs into .env

### Use Microsoft Foundry (the judged path)```



```bash---

cp .env.example .env          # set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT

az login                      # keyless Microsoft Entra ID (recommended), or set AZURE_OPENAI_API_KEY## 2) How each rubric item is covered

npm run web                   # now inference runs on Azure Foundry

```| # | Criterion (weight) | Where it lives | What to show the judges |

|---|--------------------|----------------|-------------------------|

### Commands| 1 | **Copilot SDK (25%)** | `src/agent/agent.ts`, `src/copilot/copilotSdkAdapter.ts` | A real streaming + tool-calling agent loop with context management and human approval. The Copilot SDK seam is the documented core. |

| 2 | **Productivity & fit (18%)** | `eval/`, this README | A named user + a measured win. Replace the demo tools/dataset with your real workflow and report time saved. |

| Command | What it does || 3 | **Azure AI & cloud (18%)** | `src/model/azureFoundry.ts`, `infra/main.bicep`, `azure.yaml` | 100% of inference goes through Azure Foundry/OpenAI (keyless Entra ID preferred), provisioned with Bicep/`azd`. |

|---|---|| 4 | **Functionality & execution (16%)** | whole `src/`, `npm run typecheck` | Typed, error-handled, retried (SDK auto-retry), end-to-end runnable, eval-backed. |

| `npm run demo` | Offline one-shot release notes for this repo (CLI) || 5 | **UX & workflow (12%)** | `src/index.ts` | Token streaming, visible tool activity, graceful errors, the human stays in control. |

| `npm run cli -- <range>` | Generate for a range, e.g. `v1.2.0..HEAD`; add `--apply` to write `CHANGELOG.md` || 6 | **Responsible AI & security (6%)** | `src/agent/guardrails.ts`, `.env`, DevSkim | Confirm-before-risk, secret redaction, prompt-injection checks, secrets only via env. |

| `npm run web` | Streaming SSE web app on `:5173` || 7 | **Innovation (5%)** | your idea | Use the harness to do something non-obvious; don't clone an existing tool 1:1. |

| `npm run agent` | Interactive REPL agent (gather commits, then *confirm* to save) |

| `npm run eval` | Agent-as-judge over `eval/dataset.jsonl` |---

| `npm run typecheck` / `build` | Strict check / compile to `dist/` |

| `azd up` | Provision Foundry + Container Apps and deploy |## 3) Architecture



---```

src/

## How each rubric item is covered  index.ts                      # CLI: streaming UX + human-in-the-loop approvals (Crit 5)

  config.ts                     # env-only config + validation (Crit 6)

Full mapping with verify-commands: **[`docs/RUBRIC.md`](docs/RUBRIC.md)**.  model/azureFoundry.ts         # Azure Foundry / Azure OpenAI client, keyless or key (Crit 3)

Plan + measured win: **[`docs/PLAN.md`](docs/PLAN.md)**.  agent/

Design: **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.    agent.ts                    # streaming + tool-calling loop — the engine (Crit 1)

    tools.ts                    # typed tool registry with risk levels (Crit 1)

| # | Criterion (weight) | Where it lives |    guardrails.ts               # redaction, injection checks, confirmation (Crit 6)

|---|---|---|  copilot/

| 1 | Copilot SDK / agent loop (25%) | `src/agent/agent.ts` (`runAgentLoop`), `src/copilot/copilotSdkAdapter.ts` (`AgentSession`) |    copilotSdkAdapter.ts        # Copilot SDK integration seam (Crit 1)

| 2 | Productivity & fit (18%) | `docs/PLAN.md`, `src/domain/release.ts` — one diff → three audiences |eval/

| 3 | Azure AI & cloud (18%) | `src/model/azureFoundry.ts` (keyless), `infra/main.bicep`, `azure.yaml` |  runEval.ts                    # agent-as-judge scoring on the rubric (Crit 2, 4)

| 4 | Functionality & execution (16%) | strict TS, `eval/runEval.ts`, `Dockerfile`, `npm run build` |  dataset.jsonl                 # eval cases incl. a safety + injection case

| 5 | UX & workflow (12%) | `web/` streaming SSE UI + CLI/REPL token streaming |infra/

| 6 | Responsible AI & trust (6%) | `src/agent/guardrails.ts`, confirm-gated `write_changelog`, SHA citations |  main.bicep                    # provisions the Foundry/OpenAI resource (Crit 3)

| 7 | Innovation (5%) | three audiences in one pass + mechanical citation grounding |.vscode/

  mcp.json                      # MCP servers: docs, github, playwright, reasoning, memory

---  extensions.json               # the exact extensions to install

.github/

## Architecture (short)  copilot-instructions.md       # makes Copilot optimize for the rubric on every turn

```

```

CLI / Web / REPL### The model layer (Criterion 3)

      │`createFoundryClient()` returns an `AzureOpenAI` client (v1 GA data plane). It uses an

generateRelease()              domain/release.ts**API key** if you set `AZURE_OPENAI_API_KEY`, otherwise **keyless Microsoft Entra ID**

      │  AgentSession(provider, tools, SYSTEM_PROMPT)via `DefaultAzureCredential` (`az login`). Swap the `AZURE_OPENAI_DEPLOYMENT` to use any model

      ▼you deploy in Foundry (gpt-4o, gpt-4.1, o-series, …).

runAgentLoop()                 agent/agent.ts   ← the engine (Criterion 1)

   stream text → accumulate tool calls → confirm-gate risky → run → repeat### The agent loop (Criterion 1)

      │                                   │`runAgent()` streams tokens, accumulates tool-call deltas, runs tools (asking the human first

   LLMProvider (model/)             tools (agent/tools.ts)for anything risky), feeds results back, and repeats. `AgentSession` wraps it as a Copilot-SDK

   Foundry ▲ / mock ▼               git_log · git_diff · write_changelog(confirm)style session — see the `TODO` block in `copilotSdkAdapter.ts` for exactly where to drop the

```official SDK while keeping Foundry as the backend.



- **Model layer is Azure-only** (`createFoundryProvider`); the mock is a---

  keyless offline twin for dev/CI, never the judged path.

- **Streaming by default** via a tiny `StreamEvent` union.## 4) Installed tooling (already set up for you)

- **Grounding:** the model only sees real `git_log` output and must cite each

  SHA; `eval/runEval.ts` verifies every citation mechanically.**VS Code extensions** — Foundry Toolkit, Azure MCP Server, Azure Developer CLI, Azure Resources,

Bicep, Container Tools, Context7 MCP, Playwright, DevSkim, Git DevOps Assistant (MCP). They're

See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the full picture.listed in `.vscode/extensions.json` so a fresh clone re-prompts to install them.



---**MCP servers** (`.vscode/mcp.json`, plus extension-provided ones):



## Deploy to Azure (Criterion 3)| Server | Purpose | Source |

|--------|---------|--------|

```bash| `azure` | Query/provision live Azure resources | Azure MCP Server extension |

azd up| `context7` | Up-to-date library docs & examples | Context7 extension |

```| `microsoft-docs` | Official Microsoft/Azure docs (grounding) | `.vscode/mcp.json` |

| `github` | Repos, issues, PRs, code search | `.vscode/mcp.json` |

`infra/main.bicep` (validated, compiles clean) provisions Azure AI Foundry +| `playwright` | Real-browser UX checks + E2E | `.vscode/mcp.json` |

a model deployment, an Azure Container Registry, Log Analytics, a Container| `sequential-thinking`, `memory` | Reasoning + cross-turn memory | `.vscode/mcp.json` |

Apps Environment, and the ShipScribe web Container App — with a **user-assigned

managed identity** granted *Cognitive Services OpenAI User* on Foundry and> Use them in Copilot **Agent mode**: open the Chat view, pick Agent, and the tools appear under 🔧.

*AcrPull* on the registry. The container calls Foundry **keyless**

(`DefaultAzureCredential`); no secret ever enters the image.---



---## 5) Make it yours (the 5-minute pitch plan)



## Tooling already wired (no mid-hackathon installs)1. Pick **one** painful, well-defined task for **one** user (e.g. "triage failing CI for a backend dev").

2. Replace the demo tools in `tools.ts` with 2–3 tools that actually solve it.

**VS Code extensions** (`.vscode/extensions.json`): Foundry Toolkit, Azure MCP3. Add 3–5 matching cases to `eval/dataset.jsonl`; run `npm run eval` and screenshot the score.

Server, Azure Developer CLI, Azure Resources, Bicep, Container Tools, Context74. Keep every model call on Foundry; mention keyless auth + Bicep in your demo.

MCP, Playwright, DevSkim, Git DevOps Assistant.5. Show streaming + a human-approval prompt live — that visibly covers Criteria 1, 5, and 6.



**MCP servers** (`.vscode/mcp.json` + extension-provided): `azure`, `context7`,---

`microsoft-docs`, `github`, `playwright`, `sequential-thinking`, `memory`.

## 6) Security & Responsible AI notes (Criterion 6)

`.github/copilot-instructions.md` keeps every future Copilot action aligned to

the rubric (Azure-only model layer, streaming, tool-calling, human-in-the-loop).- Secrets are read only from `process.env`; `.env` is git-ignored; logs pass through `redactSecrets()`.

- Risky tools (`write_file`, `run_shell`) **cannot run** without an explicit `y` approval.

---- External/tool/file text is treated as untrusted and screened by `looksLikePromptInjection()`.

- DevSkim flags hardcoded secrets and risky patterns as you type.

## Responsible AI & security (Criterion 6)- The agent is told to ground claims and to say when it is unsure (anti-hallucination).


- Secrets only from `process.env`; `.env` is git-ignored; logs pass through `redactSecrets()`.
- The only mutating tool, `write_changelog`, is `risk:'confirm'` and **cannot run** without explicit human approval.
- Tool/external text is treated as untrusted and screened by `looksLikePromptInjection()`.
- Every developer-facing claim cites a real commit SHA (anti-hallucination).

# Copilot × Azure Foundry — 입코딩 Hackathon Kit

A ready-to-extend **agent harness** whose engine is the **Copilot SDK agent loop**, whose
**model layer runs on Microsoft Foundry / Azure OpenAI**, and which is wired to **MCP tools**.
Everything here is organized to score against the official rubric — and it's built to be driven
entirely by **prompting (입코딩)**: the `.github/copilot-instructions.md` steers every future
Copilot action toward those scoring criteria automatically.

> ⚠️ Because installing things mid-hackathon is hard, all the tooling you need is already wired:
> VS Code extensions (recommended in `.vscode/extensions.json`), MCP servers (`.vscode/mcp.json`),
> and a working TypeScript harness. Just add your Azure keys and go.

---

## 1) Quickstart (3 steps)

```bash
cd ~/copilot-hackathon-kit
npm install                 # install deps (openai, @azure/identity, tsx, typescript)
cp .env.example .env        # then paste your Foundry endpoint + deployment (+ key)
npm run agent               # interactive streaming agent in your terminal
```

Run the agent-as-judge evaluation any time:

```bash
npm run eval                # scores the agent on the rubric axes using a Foundry judge model
npm run typecheck           # strict TypeScript check
```

Provision the cloud model (optional, needs an Azure subscription):

```bash
az login
az group create -n rg-hack -l eastus2
az deployment group create -g rg-hack \
  --template-file infra/main.bicep --parameters infra/main.parameters.json
# Copy the "endpoint" + "deploymentName" outputs into .env
```

---

## 2) How each rubric item is covered

| # | Criterion (weight) | Where it lives | What to show the judges |
|---|--------------------|----------------|-------------------------|
| 1 | **Copilot SDK (25%)** | `src/agent/agent.ts`, `src/copilot/copilotSdkAdapter.ts` | A real streaming + tool-calling agent loop with context management and human approval. The Copilot SDK seam is the documented core. |
| 2 | **Productivity & fit (18%)** | `eval/`, this README | A named user + a measured win. Replace the demo tools/dataset with your real workflow and report time saved. |
| 3 | **Azure AI & cloud (18%)** | `src/model/azureFoundry.ts`, `infra/main.bicep`, `azure.yaml` | 100% of inference goes through Azure Foundry/OpenAI (keyless Entra ID preferred), provisioned with Bicep/`azd`. |
| 4 | **Functionality & execution (16%)** | whole `src/`, `npm run typecheck` | Typed, error-handled, retried (SDK auto-retry), end-to-end runnable, eval-backed. |
| 5 | **UX & workflow (12%)** | `src/index.ts` | Token streaming, visible tool activity, graceful errors, the human stays in control. |
| 6 | **Responsible AI & security (6%)** | `src/agent/guardrails.ts`, `.env`, DevSkim | Confirm-before-risk, secret redaction, prompt-injection checks, secrets only via env. |
| 7 | **Innovation (5%)** | your idea | Use the harness to do something non-obvious; don't clone an existing tool 1:1. |

---

## 3) Architecture

```
src/
  index.ts                      # CLI: streaming UX + human-in-the-loop approvals (Crit 5)
  config.ts                     # env-only config + validation (Crit 6)
  model/azureFoundry.ts         # Azure Foundry / Azure OpenAI client, keyless or key (Crit 3)
  agent/
    agent.ts                    # streaming + tool-calling loop — the engine (Crit 1)
    tools.ts                    # typed tool registry with risk levels (Crit 1)
    guardrails.ts               # redaction, injection checks, confirmation (Crit 6)
  copilot/
    copilotSdkAdapter.ts        # Copilot SDK integration seam (Crit 1)
eval/
  runEval.ts                    # agent-as-judge scoring on the rubric (Crit 2, 4)
  dataset.jsonl                 # eval cases incl. a safety + injection case
infra/
  main.bicep                    # provisions the Foundry/OpenAI resource (Crit 3)
.vscode/
  mcp.json                      # MCP servers: docs, github, playwright, reasoning, memory
  extensions.json               # the exact extensions to install
.github/
  copilot-instructions.md       # makes Copilot optimize for the rubric on every turn
```

### The model layer (Criterion 3)
`createFoundryClient()` returns an `AzureOpenAI` client (v1 GA data plane). It uses an
**API key** if you set `AZURE_OPENAI_API_KEY`, otherwise **keyless Microsoft Entra ID**
via `DefaultAzureCredential` (`az login`). Swap the `AZURE_OPENAI_DEPLOYMENT` to use any model
you deploy in Foundry (gpt-4o, gpt-4.1, o-series, …).

### The agent loop (Criterion 1)
`runAgent()` streams tokens, accumulates tool-call deltas, runs tools (asking the human first
for anything risky), feeds results back, and repeats. `AgentSession` wraps it as a Copilot-SDK
style session — see the `TODO` block in `copilotSdkAdapter.ts` for exactly where to drop the
official SDK while keeping Foundry as the backend.

---

## 4) Installed tooling (already set up for you)

**VS Code extensions** — Foundry Toolkit, Azure MCP Server, Azure Developer CLI, Azure Resources,
Bicep, Container Tools, Context7 MCP, Playwright, DevSkim, Git DevOps Assistant (MCP). They're
listed in `.vscode/extensions.json` so a fresh clone re-prompts to install them.

**MCP servers** (`.vscode/mcp.json`, plus extension-provided ones):

| Server | Purpose | Source |
|--------|---------|--------|
| `azure` | Query/provision live Azure resources | Azure MCP Server extension |
| `context7` | Up-to-date library docs & examples | Context7 extension |
| `microsoft-docs` | Official Microsoft/Azure docs (grounding) | `.vscode/mcp.json` |
| `github` | Repos, issues, PRs, code search | `.vscode/mcp.json` |
| `playwright` | Real-browser UX checks + E2E | `.vscode/mcp.json` |
| `sequential-thinking`, `memory` | Reasoning + cross-turn memory | `.vscode/mcp.json` |

> Use them in Copilot **Agent mode**: open the Chat view, pick Agent, and the tools appear under 🔧.

---

## 5) Make it yours (the 5-minute pitch plan)

1. Pick **one** painful, well-defined task for **one** user (e.g. "triage failing CI for a backend dev").
2. Replace the demo tools in `tools.ts` with 2–3 tools that actually solve it.
3. Add 3–5 matching cases to `eval/dataset.jsonl`; run `npm run eval` and screenshot the score.
4. Keep every model call on Foundry; mention keyless auth + Bicep in your demo.
5. Show streaming + a human-approval prompt live — that visibly covers Criteria 1, 5, and 6.

---

## 6) Security & Responsible AI notes (Criterion 6)

- Secrets are read only from `process.env`; `.env` is git-ignored; logs pass through `redactSecrets()`.
- Risky tools (`write_file`, `run_shell`) **cannot run** without an explicit `y` approval.
- External/tool/file text is treated as untrusted and screened by `looksLikePromptInjection()`.
- DevSkim flags hardcoded secrets and risky patterns as you type.
- The agent is told to ground claims and to say when it is unsure (anti-hallucination).

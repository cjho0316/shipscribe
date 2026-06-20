# ShipScribe — Product Requirements Document (PRD)

> **Source of truth for the AI judge.** This file describes what ShipScribe is,
> who it is for, and exactly how to verify every claim. The app's behaviour and
> this PRD are intended to match.

## ⚓ One-liner

**ShipScribe turns one `git` commit range into three audience-aware,
citation-grounded release documents — a developer CHANGELOG, a user
ANNOUNCEMENT, and a MIGRATION guide — in a single streaming agent pass on
Microsoft Foundry / Azure OpenAI.**

## The problem & the user

**Named user: Mina, a developer who ships every Friday.** For each release she
hand-writes three different documents for three different audiences:

1. a **CHANGELOG** for fellow developers,
2. a friendly **ANNOUNCEMENT** for end users, and
3. a **MIGRATION** guide for anyone upgrading.

This takes **30-45 minutes** of context-switching, and worse, hand-written notes
routinely cite commits that don't exist or miss breaking changes. It is exactly
the kind of repetitive, error-prone "last mile" chore that kills developer
productivity.

## The solution

ShipScribe runs a **GitHub-Copilot-SDK-style agent loop** that:

1. calls typed **git tools** (`git_log`, `git_diff`) to read the *real* commits
   in a range (grounding — the model never invents history),
2. **streams** all three documents in one pass, and
3. ends **every developer-facing bullet with a real commit SHA citation**.

Result: Mina's 30-45 min becomes **< 30 seconds**, and every claim is verifiable.

## Core features (and how to verify each)

| Feature | How to see it |
|---|---|
| One range -> 3 audience docs in one pass | `npm run demo` (offline) or the web app's three tabs |
| Streaming agent loop with live tool calls | watch `git_log` / `git_diff` chips, then streamed text |
| Mechanical SHA-citation grounding | `npm run eval` verifies every cited SHA exists (citation-validity PASS) |
| Breaking-change detection -> MIGRATION | a `feat!:`/`BREAKING CHANGE` commit appears in the MIGRATION section |
| Human-in-the-loop save | "Apply" asks for confirmation before writing `CHANGELOG.md` |
| Runs on Azure AI Foundry | `npm run smoke:foundry` does one real streamed round-trip |

## How it uses the Copilot SDK pattern & Azure AI (judged criteria)

- **Agent loop (Copilot SDK pattern):** `src/agent/agent.ts` (`runAgentLoop`)
  streams text, accumulates tool-call deltas by index, gates risky tools behind
  a human confirmation, runs tools, feeds results back, and repeats until the
  model stops. `src/copilot/copilotSdkAdapter.ts` (`AgentSession`) wraps it with
  a persona + running context window.
- **Azure AI Foundry (the judged inference path):** `src/model/azureFoundry.ts`
  uses `AzureOpenAI` with **keyless Microsoft Entra ID** (`DefaultAzureCredential`)
  or an API key. The deployed model is **gpt-4.1-mini** (GA, `2025-04-14`).
- **Cloud:** `infra/main.bicep` provisions Azure AI Foundry + a model deployment,
  Azure Container Registry, Log Analytics, a Container Apps Environment, and the
  ShipScribe web Container App, all wired to a **user-assigned managed identity**
  (Cognitive Services OpenAI User + AcrPull) so the container calls Foundry with
  **no secrets in the image**. Deploy with `azd up`.

## Architecture (short)

```
CLI / Web / REPL
      |
generateRelease()              src/domain/release.ts
      |  AgentSession(provider, tools, SYSTEM_PROMPT)
      v
runAgentLoop()                 src/agent/agent.ts   <- the engine
   stream text -> accumulate tool calls -> confirm-gate -> run tools -> repeat
      |                                   |
   LLMProvider (src/model/)         tools (src/agent/tools.ts)
   Azure Foundry / offline mock     git_log . git_diff . write_changelog(confirm)
```

## Responsible AI & trust

- The only mutating tool, `write_changelog`, is `risk:'confirm'` and **cannot run
  without explicit human approval** (CLI prompt or web confirm modal).
- Tool/external output is treated as untrusted and screened by
  `looksLikePromptInjection()` (`src/agent/guardrails.ts`).
- Every developer-facing claim cites a real commit SHA (anti-hallucination).
- Secrets come only from environment variables; `.env` is git-ignored.

## How to run & verify (no Azure keys needed)

```bash
npm install
npm run typecheck     # strict TypeScript, clean
npm run eval          # agent-as-judge: 4/4, citation-validity PASS
npm run e2e           # Playwright browser E2E: streaming + human-gated save
npm run demo          # offline: streamed, SHA-cited, 3-audience release notes
npm run web           # http://localhost:5173 — streaming web UI
```

Everything above runs with a **deterministic offline mock** (no secrets). To use
Azure: set `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT`, run `az login`
(or set `AZURE_OPENAI_API_KEY`), then `npm run smoke:foundry` and `npm run web`.

## Deploy to Azure

```bash
azd up
```

Provisions everything in `infra/main.bicep` and deploys the web app to Azure
Container Apps. CI/CD is wired via GitHub Actions (`.github/workflows/`):
`ci.yml` (typecheck + build + eval + e2e on every push) and `azure-dev.yml`
(`azd provision` + `azd deploy` via GitHub OIDC, no stored secrets).

## Tech stack

TypeScript 5.7 (ESM, NodeNext) · Node 20 · `openai` (AzureOpenAI) ·
`@azure/identity` · node:http SSE streaming · Playwright · Bicep · Azure
Container Apps · Azure AI Foundry (gpt-4.1-mini).

## Out of scope (for this version)

Multi-repo aggregation, GitHub PR auto-comments, and non-git sources are future
work. ShipScribe v0.1 focuses on doing one thing extremely well: turning a single
git range into three trustworthy, audience-aware release documents.

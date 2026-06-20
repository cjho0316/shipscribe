# ShipScribe — Architecture

ShipScribe turns one `git` range into **three** audience-aware, SHA-cited
release documents in a single agent pass. Three entry points share one engine.

## Component map

| Layer | File | Responsibility |
|---|---|---|
| Entry · CLI | `src/cli.ts` | One-shot generate; `--apply` writes CHANGELOG.md after confirmation |
| Entry · Web | `src/server.ts` | `node:http` + **SSE** streaming UI; `/api/release`, `/api/apply`, `/api/info`, `/api/health` |
| Entry · Agent | `src/index.ts` | Interactive REPL over the same session |
| Orchestration | `src/domain/release.ts` | `generateRelease()` builds the prompt, runs the session, parses 3 sections |
| Copilot seam | `src/copilot/copilotSdkAdapter.ts` | `AgentSession`: persona + running history (context mgmt) → delegates the loop |
| Agent loop | `src/agent/agent.ts` | `runAgentLoop()`: stream → accumulate tool calls → gate risky → run → repeat |
| Tools | `src/agent/tools.ts` | `git_log`, `git_diff` (safe), `write_changelog` (confirm) + `applyChangelog()` |
| Guardrails | `src/agent/guardrails.ts` | `confirmInTerminal`, `redactSecrets`, `looksLikePromptInjection` |
| Model | `src/model/azureFoundry.ts` | Azure Foundry / OpenAI provider (keyless Entra ID or API key) |
| Model | `src/model/mockProvider.ts` | deterministic offline twin (drives the same tool loop) |
| Model | `src/model/provider.ts` | `LLMProvider` + `StreamEvent` streaming contract |
| Domain | `src/domain/git.ts` | thin, typed wrappers over the `git` CLI |

## Request lifecycle

```
user / range
   │
   ▼
generateRelease(range)            domain/release.ts
   │  new AgentSession(provider, tools, SYSTEM_PROMPT)
   ▼
AgentSession.run(prompt, hooks)   copilot/copilotSdkAdapter.ts   (owns message history)
   │
   ▼
runAgentLoop(...)                 agent/agent.ts
   │   ┌───────────────────────────────────────────────┐
   │   │ provider.streamChat({messages, tools})         │  model/*
   │   │   → text deltas  ──onText──▶ SSE / stdout      │  (Criterion 5)
   │   │   → tool_call_delta (accumulate by index)      │
   │   │ run tool (confirm-gate risky) ─▶ git_log/diff  │  agent/tools.ts
   │   │ push tool result, loop until finishReason=stop │
   │   └───────────────────────────────────────────────┘
   ▼
parseSections(text) → { changelog, announcement, migration }
```

## Why it stays grounded (anti-hallucination)

1. The system prompt forbids inventing commits and **requires a `` (`sha`) ``
   citation** on every developer-facing bullet.
2. The model only sees commits returned by the `git_log` tool — real data.
3. `eval/runEval.ts` **mechanically** verifies every cited SHA exists in the
   case's commits (citation-validity) and that breaking changes are surfaced.

## Provider abstraction

`LLMProvider.streamChat()` yields a tiny `StreamEvent` union
(`text` | `tool_call_delta` | `done`). The loop is identical for:

- **Azure Foundry** (`createFoundryProvider`) — the judged path; keyless Entra
  ID via `DefaultAzureCredential`, or `AZURE_OPENAI_API_KEY`.
- **Offline mock** (`createMockProvider`) — same tool-calling behavior, zero
  keys, so the app + eval always run (CI, demos, this hackathon machine).

`SHIPSCRIBE_OFFLINE=1` (or simply no endpoint) selects the mock.

## Responsible AI (Criterion 6)

- **Human-in-the-loop:** every `risk:'confirm'` tool (`write_changelog`) is
  routed through `confirmFn` before it can touch the filesystem.
- **Untrusted tool output:** `looksLikePromptInjection()` screens tool results
  before they re-enter the model context.
- **Secrets:** read only from `process.env`; all logs pass `redactSecrets()`.

## Deployment topology (Criterion 3)

```
azd up
  ├─ infra/main.bicep
  │    ├─ Azure AI Foundry (AIServices) + model deployment
  │    ├─ User-assigned managed identity
  │    │    ├─ AcrPull  on the registry
  │    │    └─ Cognitive Services OpenAI User  on Foundry   ← keyless, no keys
  │    ├─ Azure Container Registry
  │    ├─ Log Analytics + Container Apps Environment
  │    └─ Container App (web)  ── ingress :5173, SSE streaming
  └─ Dockerfile  → build → push → deploy
```

The container authenticates to Foundry with its managed identity
(`AZURE_CLIENT_ID` selects the UAMI for `DefaultAzureCredential`). No secret
ever lands in the image or environment.

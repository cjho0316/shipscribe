# ShipScribe — Rubric Map (for the AI judge)

Every criterion, where it lives in code, and how to verify it in seconds.

| # | Criterion (weight) | Where it lives | Verify |
|---|---|---|---|
| 1 | **Copilot SDK / agent loop (25%)** | `src/agent/agent.ts` (`runAgentLoop`: streaming, tool-call accumulation, human gate) + `src/copilot/copilotSdkAdapter.ts` (`AgentSession`: persona + running context) | `npm run demo` — watch `git_log`/`git_diff` tool calls then streamed output |
| 2 | **Productivity & problem fit (18%)** | `docs/PLAN.md` (named user *Mina*, 30 min → <30 s, 3 audiences), `src/domain/release.ts` | `npm run demo` produces CHANGELOG + ANNOUNCEMENT + MIGRATION in one pass |
| 3 | **Azure AI & cloud (18%)** | `src/model/azureFoundry.ts` (keyless Entra ID), `infra/main.bicep` (Foundry + Container Apps + managed-identity RBAC), `azure.yaml` | `azd up`; Bicep compiles clean (validated) |
| 4 | **Functionality & execution (16%)** | typed strict TS, error handling, retries, `eval/runEval.ts` | `npm run typecheck` (clean) · `npm run eval` (4/4 pass) · `npm run build` |
| 5 | **UX & workflow (12%)** | `web/` streaming SSE UI, live tool activity, copy buttons; CLI/REPL stream tokens | `npm run web` → open the page; or `curl -N -XPOST /api/release` |
| 6 | **Responsible AI & trust (6%)** | `src/agent/guardrails.ts`, confirm-gated `write_changelog`, SHA citations | `npm run agent` then ask to "save the changelog" → confirmation prompt |
| 7 | **Innovation (5%)** | one diff → **three** audiences in one pass, with mechanical citation grounding | compare the 3 sections in any run |

## One-minute judge script

```bash
npm install
npm run typecheck     # strict TS, clean
npm run eval          # agent-as-judge: 4/4, citation-validity PASS
npm run demo          # offline: streamed, SHA-cited, 3-audience release notes
npm run web           # http://localhost:5173 — streaming UI
```

All of the above run **with no Azure keys** (deterministic offline mock).
Set `AZURE_OPENAI_ENDPOINT` (+`az login`) to route inference through Foundry.

## Evidence of execution (this build)

- `npm run typecheck` → exit 0 (src + eval).
- `npm run eval` → AVG helpful 4.0 / grounded 4.0 / safe 5.0; citation-validity
  **PASS**, breaking-handling **PASS** across 4 cases.
- `node dist/server.js` (the container CMD) boots and serves `/api/*` + UI.
- `infra/main.bicep` compiles to ARM with zero diagnostics.

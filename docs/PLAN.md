# ShipScribe — Build & Scoring Plan

> **One line:** ShipScribe turns a single `git diff` into audience-aware,
> SHA-cited release notes for **three** readers at once — a developer
> CHANGELOG, a friendly user ANNOUNCEMENT, and a MIGRATION guide — streamed
> live, with a human-gated "write to CHANGELOG.md" action.

This is a **personal/developer productivity app**. Its engine is a
**GitHub-Copilot-SDK-style agent loop** running on **Microsoft Foundry /
Azure OpenAI**, using **typed tools** for grounded git facts.

---

## 1. The problem & the named user (Criterion 2 — 18%)

**User:** *Mina, a maintainer who ships every Friday.* Before each release she
hand-writes a changelog, a launch note, and an upgrade guide by scrolling
through `git log`. It takes **30–45 min**, she forgets changes, and her notes
sometimes describe commits that don't exist.

**Job to be done:** "When I cut a release, turn what actually changed into
three polished, audience-correct documents I can trust and ship in seconds."

**Measured win:**
| | Manual | ShipScribe |
|---|---|---|
| Time per release | 30–45 min | **< 30 s** |
| Audiences covered | 1 (if any) | **3 in one pass** |
| Hallucinated changes | possible | **0 — every bullet cites a real commit SHA** |

---

## 2. The solution

`git range` → **agent loop** (`git_log` → `git_diff` → reason) → three sections
with sentinel headers, every developer bullet ending in a `` (`a1b2c3d`) ``
citation. Output streams token-by-token to a web UI and a CLI. Saving the notes
to `CHANGELOG.md` is a **risk:'confirm'** tool that never runs without an
explicit human "yes".

**Why it's grounded (anti-hallucination):** the model may only describe commits
returned by the `git_log` tool, and must cite each one's short SHA. The eval
harness mechanically verifies that every cited SHA is real.

---

## 3. Architecture (Criteria 1 & 3)

```
CLI (src/cli.ts) ─┐                        ┌─ git_log / git_diff  (read, safe)
Web (src/server.ts)├─ generateRelease ─ AgentSession ─ runAgentLoop ─ tools ┤
Agent (src/index.ts)┘   (domain/release)  (copilot seam)  (agent/agent.ts)  └─ write_changelog (confirm)
                                              │
                                   LLMProvider (model/)
                              ┌───────────────┴───────────────┐
                     Azure Foundry (judged path)      Offline mock (keyless dev/CI)
```

- **`src/agent/agent.ts`** — the single, central streaming + tool-calling loop
  (`runAgentLoop`): stream text → accumulate tool-call deltas by index →
  human-gate `confirm` tools → run tools → feed results back → repeat.
- **`src/copilot/copilotSdkAdapter.ts`** — `AgentSession`: the Copilot-SDK seam.
  Owns the persona + running message history (context management) and delegates
  the loop to `agent.ts`.
- **`src/model/azureFoundry.ts`** — all inference via Azure (keyless Entra ID or
  API key). **`src/model/mockProvider.ts`** — deterministic offline twin so the
  app + eval always run with no keys.
- **`src/agent/tools.ts`** — typed tool registry (`git_log`, `git_diff`,
  `write_changelog`) with JSON schema + `risk`.
- **`src/agent/guardrails.ts`** — confirm, secret redaction, prompt-injection
  checks (Criterion 6).

---

## 4. Scoring map (engineer to the weights)

| # | Criterion | Wt | Where we win |
|---|---|---|---|
| 1 | Copilot SDK / agent loop | 25% | Central `runAgentLoop` + `AgentSession` (context, streaming, tool calling, human gate) |
| 2 | Productivity & problem fit | 18% | Named user *Mina*, 30 min → <30 s, 3 audiences, README/PLAN state the win |
| 3 | Azure AI & cloud | 18% | Foundry-only inference, keyless Entra ID, Bicep + `azd` provisioning |
| 4 | Functionality & execution | 16% | Typed, error-handled, offline-runnable, eval harness with real metrics |
| 5 | UX & workflow | 12% | Token streaming, live tool activity, copy buttons, graceful errors |
| 6 | Responsible AI & trust | 6% | Confirm-before-write, redaction, injection checks, SHA citations |
| 7 | Innovation | 5% | "One diff → three audiences in one pass" with mechanical citation grounding |

---

## 5. Build cycle (Ralph loop)

1. **Restore engine** — `agent.ts` loop, adapter delegates, `write_changelog` tool, `index.ts`, `eval/runEval.ts`.
2. **Verify** — `tsc --noEmit` clean → offline CLI + web SSE + eval all green.
3. **Elevate** — Dockerfile, Azure Container Apps Bicep, `azure.yaml`/`azd` for one-command deploy.
4. **Document** — ARCHITECTURE.md, RUBRIC.md, README so the AI judge sees value instantly.
5. **Loop** — re-run eval, tighten the lowest-scoring criterion, repeat.

## 6. Deploy target (Criterion 3)

`azd up` → provisions Azure Foundry (AIServices + model deployment) and an Azure
Container App running the streaming web server, wired with keyless managed
identity. No secrets in the image.

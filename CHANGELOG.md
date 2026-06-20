# Changelog

All notable changes to this project are documented here.
ShipScribe generates entries like these from a `git` range — see `npm run demo`.

## [0.1.0] — Initial release

### Added
- One-pass, three-audience release notes: developer **CHANGELOG**, user
  **ANNOUNCEMENT**, and **MIGRATION** guide from a single `git` range.
- Copilot-SDK-style agent loop (`runAgentLoop`) with streaming, tool calling,
  and human-in-the-loop confirmation.
- Microsoft Foundry / Azure OpenAI model layer (keyless Entra ID or API key),
  with a deterministic offline mock so everything runs without Azure keys.
- Three entry points over one engine: CLI (`npm run cli`), streaming web UI
  (`npm run web`), and interactive REPL (`npm run agent`).
- Agent-as-judge eval (`npm run eval`) with mechanical citation-validity and
  breaking-change checks.
- One-command cloud deploy: `azd up` → Azure Container Apps + Foundry with a
  managed identity (no secrets in the image).

### Security
- Secrets only via `process.env`; logs redacted; the only mutating tool
  (`write_changelog`) requires explicit human approval.

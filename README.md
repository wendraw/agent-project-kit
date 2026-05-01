# agent-project-kit

`agent-project-kit` is a requirement-first workflow toolkit for AI-assisted software delivery.

It keeps product requirements, design decisions, API contracts, repo task packets, delivery status, and reusable experience records in files so different coding agents can work from the same source of truth.

## What It Does

- Creates structured requirement packets under `requirements/in-progress/<req-id>/`
- Routes work through intake, design, breakdown, implementation handoff, validation, completion, and archive phases
- Stores API changes in OpenAPI files
- Generates self-contained `task-input-{repo}.md` files for implementation in code repositories
- Maintains reusable rules, risks, patterns, service context, and experience records under `context/`
- Installs workflow commands and skills for Claude Code, Cursor, Codex, Kiro, Trae, Windsurf, and OpenCode

## Quick Start

```bash
npm install
npm run typecheck
npm run build
npm run init
```

`npm run init` builds the CLI, installs the `agentkit` launcher, writes local config to `~/.agentkit/config.json`, and installs selected workflow entries.

## Common Commands

```bash
# Create a requirement from text
agentkit req-dev --task "Add team workspace billing"

# Create a requirement from a PRD link
agentkit req-dev --prd-link "https://example.feishu.cn/docx/xxxx"

# Load service context from a local repo
agentkit load-service ~/code/web-app --name frontend

# Export Mermaid mindmaps to Feishu-friendly text
agentkit mindmap-export --input requirements/in-progress/<req-id>/01-test-cases.mmd
```

## Repository Layout

- `commands/`: user-facing workflow entries
- `agents/`: phase router and role contracts
- `skills/`: reusable phase checklists
- `cli/`: TypeScript CLI implementation
- `workflow/`: routing and workflow config
- `requirements/`: requirement packets and repo mappings
- `context/`: reusable rules, decisions, patterns, playbooks, service context, and indexed experience
- `docs/`: RFCs and command documentation

## Sensitive Data Policy

This public template intentionally does not include real requirement packets, service context, business records, credentials, or private repository links.

Keep local secrets out of git:

```bash
cp workflow/secrets/feishu.env.example workflow/secrets/feishu.env
```

Then fill the local file with your own values.

## Development

```bash
npm run typecheck
npm run build
npm run build:index
```

Generated tool projections such as `.claude/`, `.cursor/`, `.agents/`, `.kiro/`, `.trae/`, `.windsurf/`, and `.opencode/` are ignored and should be regenerated locally when needed.

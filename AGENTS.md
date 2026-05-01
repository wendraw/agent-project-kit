# AGENTS

This repository uses a requirement-first workflow. Compatible with Claude Code, Cursor, and Codex.

## Required Inputs

- Read requirement packet under `requirements/in-progress/<requirement-id>/`.
- Use repo links from `requirements/repo-links.yml` (frontend/backend).
- Pull reusable facts from `context/index.json`.

## State Flow

```
draft → intake-reviewed → design → design-reviewed → implementing → validating → completed → archived
         ⏸ 人工评审         ⏸ 人工评审
```

Two manual review gates (`intake-reviewed`, `design-reviewed`) require explicit human approval before proceeding.

## Delivery Rules

- Keep technical decisions in `02-technical-solution.md`.
- Keep API changes in `03-api-design.yaml` (OpenAPI 3.1, source of truth) + `03-api-design.md` (auto-generated readable summary).
- Keep execution split in `06-task-assignment.yaml`.
- Write reusable learnings with `agentkit optimize-flow`.

## Service Context

- `context/tech/services/` stores per-repo service context files produced by `/load-service`.
- Design phase **must** reference service context to ensure compatibility with existing code architecture.
- If service context is missing for any repo in `repo-links.yml`, the router will pause and prompt `/load-service`.

## Business Context

- `context/business/` stores reusable domain knowledge (business rules, boundary constraints, risk scenarios).
- Prefer writing cross-requirement business rules with frontmatter so they can be indexed in `context/index.json`.

## Review Gates

- **review-intake**: Validates requirement completeness, test case coverage, and boundary clarity before entering design.
- **review-design**: Validates solution feasibility, API compatibility, risk assessment before entering breakdown/implementation.
- Review results are stored as `.review-intake.json` / `.review-design.json` in the requirement directory.
- Review files contain: `reviewer`, `approved`, `notes`, `timestamp`.

## Task Input (Implementation)

- This is a **context repository**, not a code repository.
- In the `task-input-gen` phase, `implementation-executor` generates self-contained `task-input-{repo}.md` packages.
- Each task-input file includes: Objective, Constraints, Inputs, Deliverables — sufficient for a code-repo Agent to implement without accessing this repository.
- `07-delivery.md` tracks PR links and validation status across all target repos.
- `sub-agent-dispatch.md` + `sub-agent-dispatch.sh` provide parallel sub-agent dispatch units per repo.
- Use `agentkit req-dev --id <req-id> --dispatch-subagents` to regenerate dispatch artifacts when task-input changes.

## Skills Entry

- Skill index: `skills/INDEX.md`
- One skill per folder with `SKILL.md`.
- Prefer skills for non-deterministic phases (test-cases, solution, api, breakdown).

## Routing Entry

- Phase/Skill map: `workflow/phase-skill-map.yaml`
- Agents contracts: `agents/*.md`
- Always run by `phase-router -> target-agent -> required-skills`.

## Experience Retrieval (every phase)

- Before every phase execution, run `experience-retrieve` skill against `context/index.json`.
- Output a Retrieved Context summary (matching entries metadata only, not full content).
- Risk-tagged entries are surfaced as warnings — agents must address them before proceeding.
- Skill definition: `skills/experience-retrieve/SKILL.md`.

## Session State Persistence

- Each requirement persists a `.session-state.json` in its directory for cross-session continuity.
- On `/req-dev`, check `.session-state.json` first — if `status: "in_progress"`, resume from where the last session left off.
- If `status: "failed"`, surface `last_error` as a warning before re-routing.
- Schema defined in `agents/phase-router.md` § Session State Persistence.

## Error → Immunity (gate failures)

- When a gate check fails or an agent encounters a blocking error, run `error-to-experience` skill.
- This converts the failure into a Risk experience record in `context/records/experience/`.
- Next time `experience-retrieve` runs, the Risk entry is surfaced as a `⚠ RISK` warning.
- Skill definition: `skills/error-to-experience/SKILL.md`.

## Context Budget Management

- Each phase has a `context_budget` (L0/L1/L2 token limits) defined in `phase-skill-map.yaml`.
- L0 (index/retrieval): ~500 tokens. L1 (agent contracts/skills): ~1000-1500. L2 (dynamic/on-demand): ~1500-3000.
- When injected context exceeds budget, trim by: keep Risk entries → keep high-frequency entries → truncate the rest.
- Skill definition: `skills/context-budget/SKILL.md`.

## Knowledge Evolution (Doc → Skill → Command)

- `experience-retrieve` increments `hit_count` on each matched index entry.
- At archive phase, `knowledge-evolution` skill scans for upgrade candidates:
  - Doc with >= 5 hits → candidate for Skill.
  - Skill with >= 10 hits → candidate for Command.
  - Rule with >= 3 hits → candidate for Agent hard rule.
- Upgrades are executed by `meta-maintainer` skill.
- Skill definition: `skills/knowledge-evolution/SKILL.md`.

## Workflows / Commands

Canonical source (git tracked):
- Commands: `commands/*.md`
- Skills: `skills/*/SKILL.md`
- Agents: `agents/*.md`
- Generated projections (do not hand-edit): `.claude/`, `.cursor/`, `.agents/`, `.kiro/`, `.trae/`, `.windsurf/`, `.opencode/`

Install to tool directories: `agentkit install` (commands/workflows/skills 按工具投影；Codex/Kiro/Trae 额外生成命令型 skills)

Available workflows:
- `req-dev` — 需求研发统一入口（PRD 链接或需求 ID），详见 `commands/req-dev.md`
- `optimize-flow` — 经验沉淀（规则 + 经验记录 + 索引），详见 `commands/optimize-flow.md`
- `init-project` — 冷启动初始化，详见 `commands/init-project.md`
- `load-service` — 加载服务上下文，详见 `commands/load-service.md`

See: `docs/slash-commands.md`

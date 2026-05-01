---
id: adr-0001-context-repo-first
title: ADR-0001 Context Repo First
stage: decision
domain: general
tags: ["adr", "context", "governance"]
owner: platform
status: draft
flow_id: N/A
source: context/decisions/adr-0001-context-repo-first.md
updated_at: 2026-02-26T00:00:00Z
---

## Decision

Keep reusable process knowledge in a dedicated context package, not duplicated in each service repo.

## Rationale

The same requirement can touch frontend and backend repositories. A shared context source reduces drift.

## Consequences

- Service repositories keep implementation details only.
- Context package stores reusable patterns and experiences.

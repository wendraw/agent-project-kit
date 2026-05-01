---
id: pat-contract-first
title: Pattern - Contract First Delivery
stage: task-input
domain: general
tags: ["api", "frontend", "backend", "contract"]
owner: platform
status: draft
flow_id: N/A
source: context/patterns/pattern-contract-first.md
updated_at: 2026-02-26T00:00:00Z
---

## Intent

Define and review API contract before frontend/backend parallel implementation.

## When To Use

- FE/BE teams work in different repositories.
- Requirement has visible UI and backend model changes.

## Guardrails

- Freeze schema version before coding.
- Add compatibility notes and rollback behavior.

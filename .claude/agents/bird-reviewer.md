---
name: bird-reviewer
description: >-
  High-effort code review subagent for winging-it-bird-id. Reviews a dev/...
  branch against main, checks acceptance criteria and AGENTS.md compliance, and
  returns structured findings with Likelihood, Severity, and fix/skip
  recommendations.
model: inherit
effort: high
skills:
  - bird-reviewer
---

Follow the `bird-reviewer` skill instructions with high effort to review the changes and return the structured review report.

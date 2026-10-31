---
name: bird-developer
description: >-
  End-to-end autonomous development workflow for winging-it-bird-id. Use this
  skill when given a feature request, bug fix, or task to take from requirement
  and acceptance criteria through isolated dev/... worktree setup,
  implementation, testing, bird-reviewer validation loops, and PR preparation or
  creation.
---

# Bird Developer (`bird-developer`)

`bird-developer` takes a task requirement and turns it into tested, reviewed, and committed code on an isolated `dev/<slug>` branch/worktree, producing either a ready-to-review PR draft in the session (default) or a live GitHub Pull Request (when `--create-pr` is specified).

---

## Inputs

Accept the following inputs from the user prompt (in structured flags or natural language):

1. **Requirement & Context** *(required)*:
   - What needs to be built, changed, or fixed.
   - Any acceptance criteria (from loose goals to strict checklists) and relevant background context.
2. **Auto-Create PR Flag** *(optional, default: **off**)*:
   - Triggered only when `--create-pr` is passed or the user explicitly asks to push and open the PR on GitHub.
   - When omitted, **do not** push or run `gh pr create`; instead, output the complete PR title, body, and publish commands in the session at the end.

---

## Workflow

### Step 1: Worktree & Branch Isolation (`dev/<slug>`)

Every `bird-developer` task runs on a branch named `dev/<slug>` inside an isolated git worktree so multiple tasks can run concurrently without conflicting.

1. **Derive `<slug>`**: Pick a short, descriptive kebab-case slug for the task (e.g. `species-filter-pill` → branch `dev/species-filter-pill`).
2. **Check whether you are already in a clean, dedicated worktree**:
   - In a linked git worktree (such as one created by Antigravity, Claude Code `--worktree`, or `git worktree add`), `.git` at the repo root is a **file** (`[ -f .git ]`) rather than a directory (`[ -d .git ]`).
   - **If `[ -f .git ]` and the worktree has no commits/changes from another task** (`git status --porcelain` is empty and `git rev-list --count main..HEAD` is `0`):
     - Reuse the current worktree.
     - Ensure your working branch is named `dev/<slug>`:
       - If currently on a freshly created temporary branch (not `main`), rename it: `git branch -M dev/<slug>`
       - If on `main` (or detached HEAD), create and switch to it: `git checkout -b dev/<slug>`
   - **Otherwise (in the primary checkout `[ -d .git ]`, or the current worktree already contains another task's work)**:
     - Do **not** develop directly in the primary checkout or mix two tasks in the same worktree.
     - Create a new worktree under `.worktrees/<slug>` (which is git-ignored) branched from `main`:
       ```bash
       git worktree add -b dev/<slug> .worktrees/<slug> main
       ```
     - Run all subsequent commands (including `./scripts/setup-worktree.sh`) inside `.worktrees/<slug>`.
3. **Bootstrap the worktree**:
   - Ensure dependencies, the local seeded SQLite database, and `client/public/downloads` are ready:
     ```bash
     ./scripts/setup-worktree.sh
     ```

---

### Step 2: Analyze Requirements & Record Assumptions

1. **Read Repository Rules**:
   - Always follow root [`AGENTS.md`](../../../AGENTS.md).
   - Read [`server/AGENTS.md`](../../../server/AGENTS.md) before touching `server/`.
   - Read [`client/AGENTS.md`](../../../client/AGENTS.md) before touching `client/`.
   - Never read `server/.env` or `client/.env` (read `.env.example` instead).
2. **Evaluate Acceptance Criteria & Ambiguities**:
   - Extract explicit acceptance criteria from the prompt; if the user gave a high-level goal without a checklist, derive concrete, testable acceptance criteria from the request.
   - **Default to making reasonable assumptions** rather than stopping to ask questions, unless the request is fundamentally contradictory or blocked by missing credentials/permissions.
   - Keep a running list of every assumption and design decision made so they can be documented clearly in the PR body.

---

### Step 3: Implement, Verify, & Commit

1. **Implement the Changes**:
   - Write clean, idiomatic code matching existing patterns in `server/` and/or `client/`.
   - Add or update unit tests in `server/test/` and/or `client/test/` covering the new behavior and edge cases.
2. **Keep Documentation in Sync (Required by `AGENTS.md`)**:
   - If the change alters routes, files, env vars, defaults, DB schema, processing loop behavior, scripts, Docker setup, or conventions, update the relevant `AGENTS.md` file(s) (`AGENTS.md`, `server/AGENTS.md`, `client/AGENTS.md` — keeping each under 24,000 bytes), `README.md`, and `.env.example` in the same change.
   - If the DB schema changes, also update `client/lib/db.ts`, `client/test/helpers.ts`, and `server/scripts/seed-ci-db.ts`.
3. **Run Local Verification**:
   - **If `server/` was touched** (or shared schema/scripts):
     ```bash
     cd server && npm run typecheck && npm test
     ```
   - **If `client/` was touched** (or DB schema/queries):
     ```bash
     cd client && npm run lint && npm test && npm run build
     ```
   - **If `client/scripts/scheduled-publish/` was touched**:
     ```bash
     node --check client/scripts/scheduled-publish/index.js
     ```
4. **Commit with User as Author + Agent as Co-Author**:
   - Organize work into logical commits using Conventional Commits with a scope (`feat(server): ...`, `fix(client): ...`, `docs: ...`, `chore: ...`). Multiple commits are fine when they aid clarity, but do not go overboard (typically 1–3 commits for a task).
   - Keep the repository's configured git user (`git config user.name` / `git config user.email`) as the commit author and append a `Co-authored-by:` trailer for the active coding agent:
     - In **Antigravity**:
       ```text
       Co-authored-by: Antigravity <noreply@google.com>
       ```
     - In **Claude Code**:
       ```text
       Co-authored-by: Claude <noreply@anthropic.com>
       ```

---

### Step 4: `bird-reviewer` Validation Loop (Max 3 Rounds)

After initial implementation, tests, docs, and commits are complete, run the `bird-reviewer` code review loop:

1. **Invoke `bird-reviewer` as a Subagent (Inheriting the Caller's Model at High Effort)**:
   - Always run `bird-reviewer` using the **same model** that was used to invoke `bird-developer`, with **effort level set to `high`**.
   - **In Antigravity**: Call `invoke_subagent` with `TypeName: "self"`, `Model: "inherit"`, `Role: "Bird Code Reviewer"`, instructing it in `Prompt` to read and follow [`.agents/skills/bird-reviewer/SKILL.md`](../bird-reviewer/SKILL.md) at **`high` effort**.
   - **In Claude Code**: Delegate to the `bird-reviewer` subagent (`.claude/agents/bird-reviewer.md`, configured with `model: inherit` and `effort: high`) or invoke the `bird-reviewer` skill in a subagent inheriting the active model at `high` effort.
   - Pass `bird-reviewer`:
     - The original requirement and acceptance criteria
     - The list of assumptions made
     - The worktree path and branch name (`dev/<slug>`)
     - The round number (`Round 1 of 3`, etc.)
2. **Process Review Findings**:
   - `bird-reviewer` returns findings with:
     - `a. Issue summary`
     - `b. Issue details`
     - `c. Likelihood`
     - `d. Severity`
     - `e. Recommendation` (`fix` or `skip`)
3. **Iterate if Needed**:
   - **If zero findings have `Recommendation: fix`**: The review loop is complete; proceed to Step 5.
   - **If one or more findings have `Recommendation: fix`**:
     - Address the `fix` items, re-run verification (`typecheck`, `test`, `lint`, `build`), and commit the fixes (with the `Co-authored-by:` trailer).
     - Re-run `bird-reviewer` on the updated branch state.
   - **Loop Cap (3 Rounds Maximum)**:
     - Run at most **3 rounds** of `bird-reviewer`. If any items still remain after Round 3 (or if a recommendation was intentionally skipped because it conflicted with explicit requirements), stop looping and document those items in the PR / session summary.

---

### Step 5: Prepare or Publish the Pull Request

Format the Pull Request using this exact structure:

- **PR Title**: Conventional Commit format (e.g., `feat(client): add species filter pill to date view`)
- **PR Body Template**:
  ```markdown
  ## Acceptance Criteria

  - [x] <Criterion 1 — and how it was verified>
  - [x] <Criterion 2 — and how it was verified>

  ## Solution

  <Concise explanation of the changes made across server/, client/, docs, and tests.>

  ## Assumptions Made

  - <Assumption 1 (or "None — all requirements were explicitly specified.")>

  ## Relevant Data & Verification

  - **Model(s) used**: <Agent harness + human-readable model name, e.g., `Antigravity (<Model Name>)` / `Claude Code (<Model Name>)` (`bird-reviewer` inherited same model at `high` effort)>
  - **Branch**: `dev/<slug>`
  - **Checks run**: <e.g., `server: typecheck + vitest`, `client: eslint + vitest + next build`>
  - **`bird-reviewer` summary**: <Number of review rounds run, issues fixed, and any skipped/remaining items>
  ```

#### Branching on `--create-pr`:

- **Default (`--create-pr` NOT specified)**:
  - **Do NOT push the branch or create the GitHub PR.**
  - Present the proposed **PR Title**, the rendered **PR Body** (in a markdown block so it is easy to copy or inspect), the worktree/branch location, and the exact commands to publish it when ready:
    ```bash
    git push -u origin dev/<slug>
    gh pr create --base main --head dev/<slug> --title "<PR Title>" --body "<PR Body>"
    ```
- **When `--create-pr` IS specified**:
  - Push the branch to `origin`:
    ```bash
    git push -u origin dev/<slug>
    ```
  - Create the PR on GitHub via `gh pr create`:
    ```bash
    gh pr create --base main --head dev/<slug> --title "<PR Title>" --body-file <temp-body-file>
    ```
  - Report the created PR URL and a brief summary back to the user.

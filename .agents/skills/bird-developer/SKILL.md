---
name: bird-developer
description: >-
  End-to-end autonomous development workflow for winging-it-bird-id. Use this
  skill when given a feature request, bug fix, or task to take from requirement
  and acceptance criteria through isolated dev/... in-repo worktree setup (.worktrees/<slug>),
  implementation, testing, bird-reviewer validation loops, and PR preparation or
  creation.
---

# Bird Developer (`bird-developer`)

`bird-developer` takes a task requirement and turns it into tested, reviewed, and committed code on an isolated `dev/<slug>` branch inside `<repo-root>/.worktrees/<slug>`, producing either a ready-to-review PR draft in the session (default) or a live GitHub Pull Request (when `--create-pr` is specified).

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

Every `bird-developer` task runs on a branch named `dev/<slug>` inside an isolated in-repo git worktree located at `.worktrees/<slug>` so multiple tasks can run concurrently without conflicting.

> [!IMPORTANT]
> Always enforce the in-repo worktree location (`<repo-root>/.worktrees/<slug>`). Never develop directly in the primary checkout and never reuse or create worktrees in external tool directories (such as `~/.gemini/antigravity/worktrees/` or other user-directory paths). This guarantees a consistent, predictable worktree location across Antigravity, Claude Code, and manual developer workflows.

1. **Derive `<slug>`**: Pick a short, descriptive kebab-case slug for the task (e.g. `species-filter-pill` → branch `dev/species-filter-pill`).
2. **Resolve the Repository Root & Target Worktree Path**:
   - Determine the main repository root (works reliably from the primary checkout, linked worktrees, or external agent directories):
     ```bash
     GIT_COMMON_DIR="$(git rev-parse --git-common-dir)"
     REPO_ROOT="$(cd "$GIT_COMMON_DIR/.." && pwd)"
     WORKTREE_DIR="$REPO_ROOT/.worktrees/<slug>"
     ```
3. **Ensure the Dedicated In-Repo Worktree Exists & Switch to It**:
   - **Always pull the latest for `main` before creating a worktree**:
     Before creating any new worktree or branch, always pull the latest changes for `main` from origin so work is based on up-to-date code:
     ```bash
     git -C "$REPO_ROOT" checkout main && git -C "$REPO_ROOT" pull origin main
     ```
     *(If `$REPO_ROOT` cannot switch branches, update `main` directly via `git -C "$REPO_ROOT" fetch origin main:main`)*.
   - **Always use `main` as the base** for creating the worktree and `dev/<slug>` branch unless the user requirements explicitly specify a different base branch.
   - **If the current working directory (`pwd -P`) is already `$WORKTREE_DIR`**:
     - Verify it is clean and on branch `dev/<slug>`.
   - **If the current working directory is anywhere else** (e.g. primary checkout, external tool worktree in `~/.gemini/...`, or another worktree):
     - Prune stale worktree references:
       ```bash
       git -C "$REPO_ROOT" worktree prune
       ```
     - If `$WORKTREE_DIR` already exists:
       - Ensure it is on `dev/<slug>`: `git -C "$WORKTREE_DIR" checkout dev/<slug>`
     - If `$WORKTREE_DIR` does not exist:
       - If branch `dev/<slug>` already exists locally or remotely:
         ```bash
         git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" dev/<slug>
         ```
       - Otherwise, create branch `dev/<slug>` from `main`:
         ```bash
         git -C "$REPO_ROOT" worktree add -b dev/<slug> "$WORKTREE_DIR" main
         ```
     - **Change into `$WORKTREE_DIR`**: All subsequent commands (bootstrapping, file editing, running tests, typechecks, linters, git commits, and code review) **MUST** be executed inside `$WORKTREE_DIR`.
4. **Bootstrap the worktree**:
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
   - **Visual Inspection during development (optional)**:
     - Ad-hoc screenshots may be captured during development or debugging if helpful for visual verification (`cd client && npm run screenshot`). However, the formal set of responsive screenshots intended for the PR itself must be deferred to Step 5.
4. **Commit with Agent as Author**:
   - Organize work into logical commits using Conventional Commits with a scope (`feat(server): ...`, `fix(client): ...`, `docs: ...`, `chore: ...`). Multiple commits are fine when they aid clarity, but do not go overboard (typically 1–3 commits for a task).
   - The commit must come from the active coding agent (author) instead of the user; the user will then review the PR and merge it as themselves so it will ultimately be authored by both:
     - In **Antigravity**:
       ```bash
       git commit --author="Antigravity <noreply@google.com>" -m "..."
       ```
       (or `git -c user.name="Antigravity" -c user.email="noreply@google.com" commit -m "..."`)
     - In **Claude Code**:
       ```bash
       git commit --author="Claude <noreply@anthropic.com>" -m "..."
       ```
       (or `git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "..."`)
   - Do not include a `Co-authored-by:` trailer for either party; author attribution comes from the agent's commit and the user's PR review and merge.

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
     - The worktree path (`$WORKTREE_DIR` / `.worktrees/<slug>`) and branch name (`dev/<slug>`)
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
     - Address the `fix` items, re-run verification (`typecheck`, `test`, `lint`, `build`), and commit the fixes (authored by the agent as in Step 3).
     - Re-run `bird-reviewer` on the updated branch state.
   - **Loop Cap (3 Rounds Maximum)**:
     - Run at most **3 rounds** of `bird-reviewer`. If any items still remain after Round 3 (or if a recommendation was intentionally skipped because it conflicted with explicit requirements), stop looping and document those items in the PR / session summary.

---

### Step 5: Capture UI Screenshots & Prepare or Publish the Pull Request

> [!IMPORTANT]
> The formal screenshots intended for the Pull Request (capturing desktop, tablet, and mobile layouts to attach to the PR or session summary) must only be taken here in Step 5 after all `bird-reviewer` review cycles and follow-up fix commits are finished. Ad-hoc screenshots during Step 3 or Step 4 are permitted if needed for development or review verification, but final PR screenshots must be deferred until just prior to opening or summarizing the PR.

1. **Capture UI Screenshots (for User-Facing UI Changes Across All Screen Sizes)**:
   - When changes affect client UI (pages, components, responsive layout, styling):
     - After all `bird-reviewer` review cycles and any follow-up fix commits are finished, capture screenshots just prior to creating the PR or summarizing the PR in the session.
     - Ensure the client build is current (`cd client && npm run build`), then capture screenshots across **all standard screen sizes** (**desktop**, **tablet**, and **mobile**) to verify responsive layouts and provide complete visual documentation:
       ```bash
       cd client && npm run screenshot -- /path/to/route --all-sizes
       ```
       (Running `npm run screenshot -- --all-sizes` with no route arguments automatically captures `/` and the most recent date page across all three device sizes).
     - Individual viewports can also be targeted if needed:
       - **Desktop** (`1280x800`): `npm run screenshot -- /path/to/route --desktop`
       - **Tablet** (`768x1024`): `npm run screenshot -- /path/to/route --tablet`
       - **Mobile** (`375x667`): `npm run screenshot -- /path/to/route --mobile`
       - Add `--full-page` to capture the entire scrollable height when reviewing long feeds.
     - Images are saved into `<repo-root>/.screenshots/` (e.g. `<slug>-desktop.png`, `<slug>-tablet.png`, `<slug>-mobile.png`), which is git-ignored to prevent bloating repository history.
   - If no user-facing UI changes were made (e.g. backend-only, documentation, developer skills, or CI changes), skip screenshot capture.

2. **Format the Pull Request**:

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

  - **Model(s) used**: <Exact model name and version, e.g., `Gemini 3.8 Flash via Antigravity` / `Claude 3.7 Sonnet via Claude Code` (`bird-reviewer` inherited same model at `high` effort)>
  - **Branch**: `dev/<slug>`
  - **Checks run**: <e.g., `server: typecheck + vitest`, `client: eslint + vitest + next build`>
  - **`bird-reviewer` summary**: <Number of review rounds run, issues fixed, and any skipped/remaining items>

  ## Screenshots

  ### Desktop
  ![<Page> - Desktop](./.screenshots/<file>-desktop.png)

  ### Tablet
  ![<Page> - Tablet](./.screenshots/<file>-tablet.png)

  ### Mobile
  ![<Page> - Mobile](./.screenshots/<file>-mobile.png)
  *(Include when UI changes were made; provide all three screen sizes: desktop, tablet, and mobile)*
  ```

> [!IMPORTANT]
> **Model Identification in PRs**:
> Always include the clear, precise model name and exact version in the PR (e.g., `Gemini 3.8 Flash`, `Claude 3.7 Sonnet`, `Claude 3.5 Sonnet`, `GPT-4o`). Never use the harness name only (e.g. `Antigravity`, `Claude Code`) or company name only (e.g. `Google`, `Anthropic`). Be clear, precise, and consistent with the names (e.g., `Gemini 3.8 Flash via Antigravity` or `Claude 3.7 Sonnet via Claude Code`).
> - In **Antigravity**: Determine the model and version from session settings or metadata (e.g. `Gemini 3.8 Flash`, `Gemini 3.8 Pro`, `Claude 3.7 Sonnet`).
> - In **Claude Code**: Determine the model and version from session configuration (e.g. `Claude 3.7 Sonnet`, `Claude 3.5 Sonnet`).

3. **Manage GitHub Model Label**:

When creating the PR, attach a GitHub label named after the model used:
- **Model Label Name**: Use the model name and version (e.g. `Gemini 3.8 Flash`, `Claude 3.7 Sonnet`).
- **Search Existing Labels**:
  Check repository labels before creating a new one:
  ```bash
  gh label list --json name,color
  ```
  Search (case-insensitively) for an existing label matching the model name and version. If a match exists, reuse its exact casing and name.
- **Create Label if None Exists**:
  If no matching label exists, find a distinct hex color that is **not currently in use** by any existing label on the repository.
  1. Inspect the existing colors:
     ```bash
     gh label list --json color --jq '.[].color'
     ```
  2. Pick a distinct 6-character hex color that is not already in use (e.g., selecting from vibrant, distinctive hex colors such as `4285F4`, `EA4335`, `FBBC04`, `34A853`, `8E24AA`, `00ACC1`, `3949AB`, `D81B60`, `00897B`, `F4511E`, `6D4C41`, `546E7A` that does not appear in the repository's existing label colors).
  3. Create the label:
     ```bash
     gh label create "<Model Name and Version>" --color "<unused-hex>" --description "Pull requests created with <Model Name and Version>"
     ```

4. **Publish or Draft the PR (Branching on `--create-pr`)**:

- **Default (`--create-pr` NOT specified)**:
  - **Do NOT push the branch or create the GitHub PR.**
  - If screenshots were captured in `.screenshots/`, render them directly in the chat session or artifact so the user can visually review all screen sizes (desktop, tablet, mobile).
  - Present the proposed **PR Title**, the rendered **PR Body** (in a markdown block so it is easy to copy or inspect), the worktree/branch location (`$WORKTREE_DIR` / `.worktrees/<slug>` on branch `dev/<slug>`), and the exact commands to publish it when ready (including creating the model label if needed, applying `--label`, and `--attach` flags for all captured screenshots):
    ```bash
    # 1. Ensure model label exists (create if not already present with an unused color)
    gh label create "<Model Name and Version>" --color "<unused-hex>" --description "Pull requests created with <Model Name and Version>" 2>/dev/null || true

    # 2. Push and create PR
    git push -u origin dev/<slug>
    gh pr create --base main --head dev/<slug> --title "<PR Title>" --body "<PR Body>" --label "<Model Name and Version>" --attach '.screenshots/<file>-desktop.png#Desktop' --attach '.screenshots/<file>-tablet.png#Tablet' --attach '.screenshots/<file>-mobile.png#Mobile'
    ```
- **When `--create-pr` IS specified**:
  - Ensure the model label exists in GitHub (search existing labels with `gh label list --json name,color`; if absent, create it in a color not currently in use).
  - Push the branch to `origin`:
    ```bash
    git push -u origin dev/<slug>
    ```
  - Create the PR on GitHub via `gh pr create` with `--label "<model-label>"`, appending `--attach '.screenshots/<file>.png#<Caption>'` for each captured screenshot across desktop, tablet, and mobile (GitHub CLI uploads each file and rewrites matching `./.screenshots/<file>.png` body references to the uploaded GitHub asset URLs):
    ```bash
    gh pr create --base main --head dev/<slug> --title "<PR Title>" --body-file <temp-body-file> --label "<model-label>" --attach '.screenshots/<file>-desktop.png#Desktop' --attach '.screenshots/<file>-tablet.png#Tablet' --attach '.screenshots/<file>-mobile.png#Mobile'
    ```
  - Report the created PR URL and a brief summary back to the user.

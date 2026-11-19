---
name: verify-milestone
description: Repeatable verification procedure for a milestone or significant change — typecheck, tests, production build, dev-server smoke check, RTL rendering check, git diff review and an honest report. Use before declaring any milestone or change complete.
argument-hint: "[milestone name]"
allowed-tools: Bash(npm run typecheck) Bash(npm test) Bash(npm run build) Bash(git status *) Bash(git diff *) Bash(git log *)
---

# Verify milestone

Milestone: $ARGUMENTS

Run every step. Record the real output. A step that was not run is reported as
"not run", never as passed.

## 1. Working tree

```bash
git status --short
git diff --stat
```

Note untracked files and anything unexpected (secrets, build output, lockfile
changes without an approved dependency change).

## 2. Static checks and tests

```bash
npm run typecheck
npm test
npm run build
```

All three must exit 0. Capture the test summary lines (files, tests passed/failed).

## 3. Dev server smoke check

Start the dev server in the background on a fixed port, confirm it serves the
page, then stop it:

```bash
npm run dev -- --port 5173 --strictPort
```

- Confirm HTTP 200 from `http://localhost:5173/`.
- If the change touches UI: load the page in a headless browser (Playwright is
  pre-installed in cloud sessions) and confirm `<html lang="he" dir="rtl">`, no
  console errors, and English inside `<En>` has computed `direction: ltr`.
- Stop the server afterwards.

## 4. Guardrail checks

- The architecture test (`src/test/architecture.test.ts`) ran and passed, and was
  not weakened in this diff.
- No new dependencies unless the owner approved them (`git diff package.json`).
- No network calls, analytics, microphone, recording or external AI introduced.
- For content changes: pedagogy review completed (see `/add-lesson`).

## 5. Diff review

Read `git diff` for the whole change. For non-trivial code changes, delegate a
review to the `code-reviewer` agent, passing the changed files and the
verification output from steps 2–3.

## 6. Report

| Check | Command | Result |
|---|---|---|

Include actual output excerpts, failures verbatim, anything not run and why,
and remaining risks. Do not declare the milestone complete if any check failed.

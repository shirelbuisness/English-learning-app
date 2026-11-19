---
name: add-lesson
description: Structured workflow for creating or revising educational content (a lesson or unit) — plan, author via the curriculum-author agent, review via the pedagogy-reviewer agent, verify, and report. Owner-invoked only.
disable-model-invocation: true
argument-hint: "<unit/lesson id or short description of the learning goal>"
---

# Add lesson

Target: $ARGUMENTS

Follow every step in order. Stop and report at any failed gate — do not skip
gates or improvise a schema.

## Gate 0 — Preconditions

1. Confirm the owner explicitly requested this content (this skill was invoked).
2. Read `CLAUDE.md` and `docs/educational-principles.md`.
3. Confirm the content model exists (`src/content/types.ts`) and content tests
   exist. If not: STOP. Report that the content-model milestone must come first.
4. Read the curriculum plan in `docs/curriculum/` and identify where this lesson
   sits in the sequence and what it depends on.
5. Confirm a phonics scope and sequence exists in `docs/curriculum/`. If not: STOP.
6. Confirm a cited Hebrew→English transfer research document exists in
   `docs/curriculum/`; otherwise every transfer note must be labelled
   `ASSUMPTION — needs review`.

## Step 1 — Lesson plan (no files yet)

Write a short plan and show it to the owner before authoring:

- Learning objectives (listening, vocabulary meaning, phonological awareness,
  phonics/decoding — which ones and how they connect).
- Prerequisites: which words/sounds must already have been introduced orally.
- New items: words, sounds/letters, with audio keys needed.
- Hebrew→English transfer issues expected.
- Exercise sequence, labelled by evidence type it produces: exposure, practice,
  independent demonstration (delayed retention comes from later review).
- How a child who cannot read English understands each instruction
  (Hebrew text/audio, demonstration, familiar interaction pattern).
- Hebrew support level for this lesson compared with earlier lessons.
- Optional extra practice, support and extension items for
  performance-based adaptation.
- Assumptions needing review.

Wait for owner approval of the plan unless they already approved it.

## Step 2 — Author

Delegate to the `curriculum-author` agent with the approved plan. It may write
only in `src/content/` and `docs/curriculum/`.

## Step 3 — Verify

Run and read the actual output of:

```bash
npm run typecheck
npm test
```

Fix failures by sending them back to `curriculum-author` (content issues) or
reporting them (code issues). Never edit tests to make content pass.

## Step 4 — Pedagogy review

Delegate to the `pedagogy-reviewer` agent with the list of changed files.
Address blocking findings via `curriculum-author`, then re-run Step 3.

## Step 5 — Report

- Files changed.
- Objectives and items introduced.
- Audio keys required, whether audio exists, and whether it has been reviewed
  (separate deliverable; the lesson is not learner-ready until audio is reviewed).
- Verification commands run with their real results.
- Pedagogy review verdict and unresolved findings.
- Open questions for the owner.

Do not commit or push unless the owner asks.

# CLAUDE.md — English Learning App

## Product

An offline-first English-learning web app for three Hebrew-speaking children
(ages 8, 11, 13) who start at zero English, including the alphabet. Goal: a
complete, independently usable beginner experience on a computer, Hebrew RTL
interface with English LTR content. Eventually a comprehensive, structured,
evidence-informed curriculum.

## Educational principles (binding)

Full text: `docs/educational-principles.md`. Summary:

1. **Oral language and literacy together.** Coordinate listening comprehension,
   meaningful vocabulary, phonological awareness and systematic phonics (a
   documented scope and sequence) from the start. The alphabet is not the whole
   beginner curriculum.
2. **Meaning before or with decoding.** A word is understood through listening
   and context before reading comprehension of it is assessed.
3. **Hebrew→English transfer.** Curriculum work must be grounded in cited
   research on phonological, orthographic and linguistic differences (e.g.
   direction, vowel representation, sounds absent in Hebrew, letter name vs.
   letter sound). These areas are not yet researched.
4. **Separate learning evidence.** Exposure, practice, independent demonstration
   and delayed retention are distinct states. No sophisticated mastery algorithm
   until approved.
5. **Audio is a core asset.** Consistent, reviewed, locally available audio.
   Browser speech synthesis must not be the primary source for phoneme teaching.
6. **Independent use.** Instructions must work without English reading ability:
   Hebrew support, demonstrations, consistent interaction patterns; Hebrew
   assistance is reduced gradually.
7. **One curriculum, individual progression.** Adapt pacing, repetition, support
   and challenge to performance — not to age assumptions.
8. **Privacy by default.** See below.

## Architecture boundaries

```
src/domain/    Pure TypeScript educational logic. No React, Dexie, ui/ or storage/.
src/content/   Curriculum as typed data. No React, Dexie, ui/ or storage/. No .tsx.
src/storage/   Dexie/IndexedDB. Every learner record keyed by learnerId.   (future)
src/ui/        React components. Display and input only.
src/test/      Test setup and architecture tests.
```

- Dependency direction: `ui → domain, content, storage`. Never the reverse.
- Answer validation, mastery/evidence evaluation and scheduling live in
  `domain/`, never in components.
- `src/test/architecture.test.ts` enforces the domain/content rules for direct
  imports only (package allowlist, no ui/storage/app-shell imports, no JSX
  files). Other rules here rely on review. Do not weaken the test to make a
  change pass.
- Keep it simple: no speculative abstractions, no router/state library until needed.

## Hebrew RTL / English LTR

- `<html lang="he" dir="rtl">`. All learner-facing English goes through `<En>`
  (`src/ui/En.tsx`, renders `dir="ltr" lang="en"`).
- Use logical Tailwind utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`),
  never `left`/`right` variants.
- Never put raw invisible bidi control characters (LRM, RLM, LRE…PDF, LRI…PDI)
  in source. Write them as escape sequences. The architecture test checks this.
  Note: some tools decode escape sequences on write — verify bytes afterwards.

## Privacy (MVP)

No accounts, authentication, backend, analytics, telemetry, external AI/LLM
services, microphone access or voice recording without explicit product approval.
Learner data stays local, separated by local learner ID.

## Offline-first

The app must work offline after first load. All runtime assets (code, audio,
images, fonts) are bundled or served locally — no CDN or network calls at runtime.

## Verification (required before claiming any change works)

```bash
npm run typecheck
npm test
npm run build
```

For UI changes also start `npm run dev` and check the page renders RTL correctly.
The `verify-milestone` skill defines the full procedure.

## Git workflow

- Work on a feature branch; `main` is the stable integration branch.
- Never push to `main`, force-push, or rewrite published history.
- Push, merge and PR creation only when the owner asks.
- Commit messages describe what changed and why.

## Honesty rules

- Never claim tests, builds or checks passed unless you ran them in this session
  and saw the output. Report failures verbatim.
- Never describe planned, stubbed or partial work as complete.
- Never invent repository facts, package versions, research findings or citations.
- Educational claims in curriculum and educational-principle documents must
  cite sources or be marked as assumptions needing review.

## Requires owner approval

Ask before: adding or upgrading dependencies; changing the stack or architecture
boundaries; storage schema decisions; audio source strategy; anything touching
privacy (above); adding network access, hosting or services; implementing a
sophisticated mastery/scheduling algorithm (simple, transparent repetition rules
may be proposed for approval with the relevant milestone); changing CI or Claude
permissions; destructive git operations.

## Specialist agents and skills

- `curriculum-author` — writes educational content only (`src/content/`, `docs/curriculum/`).
- `pedagogy-reviewer` — read-only educational review.
- `code-reviewer` — read-only engineering review.
- `/add-lesson` — structured content workflow (owner-invoked).
- `/verify-milestone` — repeatable verification procedure.

## Dependency note

npm 10 crashes resolving Vitest 4 without a lockfile. Install from the committed
lockfile (`npm ci`); add packages only with owner approval, via `npx npm@11 install <pkg>`.

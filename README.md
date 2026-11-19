# English Learning App

English-learning platform for Hebrew-speaking beginners. Client-only: no backend,
no authentication, no runtime AI APIs. Learner data is stored locally in IndexedDB.

## Stack

React 19.2 · TypeScript 5.9 · Vite 7.3 · Tailwind CSS 4.3 (`@tailwindcss/vite`) ·
Dexie 4.4 · Vitest 4.1 + fake-indexeddb. Versions are pinned exactly (`.npmrc`: `save-exact`).

## Commands

```bash
npm install        # uses the committed package-lock.json
npm run dev        # dev server at http://localhost:5173
npm run build      # type-check + production build to dist/
npm test           # run unit tests once
npm run test:watch # tests in watch mode
```

Requires Node.js ≥ 20.19.

> **npm note:** npm 10 (bundled with Node 22) crashes with
> `Cannot read properties of null (reading 'edgesOut')` when it must resolve
> Vitest 4's dependency tree *without* a lockfile. Installing from the committed
> lockfile works fine. When adding or upgrading dependencies, use npm 11:
> `npx npm@11 install <pkg>`.

## Development guardrails

- `CLAUDE.md`: project rules for AI-assisted development (architecture, privacy,
  offline-first, verification, git workflow, approval rules).
- `docs/educational-principles.md`: binding educational principles.
- `.claude/agents/`: `curriculum-author`, `pedagogy-reviewer`, `code-reviewer`.
- `.claude/skills/`: `/add-lesson`, `/verify-milestone`.
- CI (`.github/workflows/ci.yml`): `npm ci`, typecheck, test, build.

## Architecture rules

```
src/
  domain/    Pure TypeScript educational logic. Must not import React, Dexie or ui/.
  content/   Curriculum as typed data (added in a later milestone).
  storage/   Dexie/IndexedDB access; every record keyed by learnerId (later milestone).
  ui/        React components. Display only — no grading or mastery logic.
  test/      Test setup (fake-indexeddb).
```

Dependency direction: `ui → domain, content, storage`. Never the reverse.

## Hebrew RTL / English LTR

- `index.html` sets `<html lang="he" dir="rtl">`.
- All English shown to the learner is wrapped in `<En>` (`src/ui/En.tsx`), which
  renders `dir="ltr" lang="en"` so it is bidi-isolated and punctuation stays correct.
- Use logical Tailwind utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`)
  instead of left/right ones.

/**
 * Architecture guardrails (see CLAUDE.md).
 *
 * - src/domain/ and src/content/ import only allowlisted packages (no React,
 *   Dexie or other UI/storage libraries), never src/ui, src/storage or the app
 *   shell, and contain no JSX files.
 * - Only direct imports are checked (not transitive ones).
 * - No source file may contain raw invisible bidi control characters.
 *
 * Do not weaken these rules to make a change pass; change the design instead.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type SourceFile = { path: string; code: string };

const GUARDED_LAYERS = ['/src/domain/', '/src/content/'];

/**
 * Bare package imports allowed in guarded layers (allowlist, not denylist:
 * blocks react, dexie and every React-ecosystem package by default).
 * Adding a package here requires owner approval.
 */
const ALLOWED_PACKAGES = new Set(['vitest']);

/** Project modules that guarded layers may not import (matched by path segment). */
const FORBIDDEN_DIRS = ['/src/ui', '/src/storage'];
const FORBIDDEN_MODULES = ['/src/App', '/src/main'];

/** Uses the TypeScript scanner: handles comments, strings, re-exports, import() and require(). */
export function importSpecifiers(code: string): string[] {
  return ts.preProcessFile(code, true, true).importedFiles.map((f) => f.fileName);
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function isForbiddenModule(resolved: string): boolean {
  const withoutExt = resolved.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '');
  return (
    FORBIDDEN_DIRS.some((dir) => withoutExt === dir || resolved.startsWith(`${dir}/`)) ||
    FORBIDDEN_MODULES.includes(withoutExt)
  );
}

export function findBoundaryViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!GUARDED_LAYERS.some((layer) => file.path.startsWith(layer))) continue;

    if (/\.[jt]sx$/.test(file.path)) {
      violations.push(`${file.path}: JSX files are not allowed in this layer`);
    }

    for (const specifier of importSpecifiers(file.code)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        if (!ALLOWED_PACKAGES.has(packageName(specifier))) {
          violations.push(`${file.path}: imports non-allowlisted package '${specifier}'`);
        }
        continue;
      }
      const resolved = new URL(specifier, `file://${file.path}`).pathname;
      if (isForbiddenModule(resolved)) {
        violations.push(`${file.path}: imports forbidden module '${specifier}'`);
      }
    }
  }
  return violations;
}

/** LRM, RLM, LRE..RLO (U+202A..U+202E), LRI..PDI (U+2066..U+2069). */
function isBidiControl(codePoint: number): boolean {
  return (
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export function findBidiControls(files: SourceFile[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    file.code.split('\n').forEach((line, index) => {
      for (const char of line) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (isBidiControl(codePoint)) {
          found.push(`${file.path}:${index + 1}: raw U+${codePoint.toString(16).toUpperCase()}`);
        }
      }
    });
  }
  return found;
}

function load(modules: Record<string, string>): SourceFile[] {
  return Object.entries(modules).map(([path, code]) => ({ path, code }));
}

const guardedSources = load(
  import.meta.glob(['/src/domain/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '/src/content/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

const allSources = load(
  import.meta.glob(['/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,css,json,html}', '/index.html'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

describe('architecture boundaries', () => {
  it('scans the real domain layer (guards against a silently empty glob)', () => {
    expect(guardedSources.some((f) => f.path.startsWith('/src/domain/'))).toBe(true);
  });

  it('domain and content import no React, Dexie, UI or storage', () => {
    expect(findBoundaryViolations(guardedSources)).toEqual([]);
  });

  it('source files contain no raw invisible bidi control characters', () => {
    expect(allSources.length).toBeGreaterThan(0);
    expect(findBidiControls(allSources)).toEqual([]);
  });
});

describe('boundary checker self-test', () => {
  const domain = (code: string, path = '/src/domain/example.ts') => [{ path, code }];

  it.each([
    ["import { useState } from 'react';", 'react'],
    ["import React from 'react'", 'react'],
    ["import { createRoot } from 'react-dom/client';", 'react-dom/client'],
    ["import type { ReactNode } from 'react';", 'react (type-only)'],
    ["import { jsx } from 'react/jsx-runtime';", 'react/jsx-runtime'],
    ["import Dexie from 'dexie';", 'dexie'],
    ["import { useLiveQuery } from 'dexie-react-hooks';", 'dexie-react-hooks'],
    ["export { db } from '../storage/db.ts';", 're-export from storage'],
    ["import { En } from '../ui/En.tsx';", 'ui component'],
    ["import { App } from '../App.tsx';", 'app shell'],
    ["import { App } from '../App';", 'extensionless app shell'],
    ["import { thing } from '../ui';", 'ui directory import'],
    ["import { db } from '../storage';", 'storage directory import'],
    ["import { db } from '../storage/index.ts';", 'storage index'],
    ["import { useQuery } from '@tanstack/react-query';", 'react ecosystem package'],
    ["import { h } from 'preact';", 'preact'],
    ["const x = require('../ui/En');", 'require'],
    ["// accepts content/*\nimport Dexie from 'dexie';\n/** doc */\nexport const y = 1;", 'import between comment markers'],
    ["const m = await import('react');", 'dynamic import'],
    ["import 'dexie';", 'side-effect import'],
    ["import {\n  useState,\n  useEffect,\n} from 'react';", 'multi-line import'],
  ])('rejects %s (%s)', (code) => {
    expect(findBoundaryViolations(domain(code))).toHaveLength(1);
  });

  it('applies the same rules to content definitions', () => {
    expect(findBoundaryViolations(domain("import Dexie from 'dexie';", '/src/content/u1.ts'))).toHaveLength(1);
    expect(findBoundaryViolations(domain("import { useState } from 'react';", '/src/content/u1.ts'))).toHaveLength(1);
  });

  it('rejects JSX files in guarded layers', () => {
    expect(findBoundaryViolations(domain('export const x = 1;', '/src/domain/view.tsx'))).toHaveLength(1);
    expect(findBoundaryViolations(domain('export const x = 1;', '/src/content/view.jsx'))).toHaveLength(1);
  });

  it.each([
    "import { normalizeAnswer } from './normalizeAnswer.ts';",
    "import type { Unit } from '../content/types.ts';",
    "import { describe, it } from 'vitest';",
    "// import { useState } from 'react';",
    "/* import Dexie from 'dexie'; */",
    "export const reactions = ['react'];",
    "const s = '/* not a comment */'; import { a } from './a.ts';",
    "import { x } from '../uiHelpers.ts';",
  ])('allows %s', (code) => {
    expect(findBoundaryViolations(domain(code))).toEqual([]);
  });

  it('ignores files outside guarded layers', () => {
    expect(findBoundaryViolations(domain("import Dexie from 'dexie';", '/src/storage/db.ts'))).toEqual([]);
    expect(findBoundaryViolations(domain("import { useState } from 'react';", '/src/ui/x.tsx'))).toEqual([]);
  });

  it('detects raw bidi control characters', () => {
    const rlm = String.fromCodePoint(0x200f);
    expect(findBidiControls([{ path: '/src/x.ts', code: `const s = '${rlm}';` }])).toHaveLength(1);
    expect(findBidiControls([{ path: '/src/x.ts', code: 'const s = "plain";' }])).toEqual([]);
  });
});

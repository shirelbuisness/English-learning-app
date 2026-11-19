#!/usr/bin/env node
// PreToolUse guard for the curriculum-author subagent.
// Blocks any file write/edit outside the educational-content directories.
// Exit code 2 = block the tool call; stderr is shown to the agent.

import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_DIRS = ['src/content', 'docs/curriculum'];

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  console.error('content-only-guard: could not parse hook input; blocking.');
  process.exit(2);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const toolInput = input.tool_input ?? {};
const target = toolInput.file_path ?? toolInput.notebook_path;

if (typeof target !== 'string' || target.length === 0) {
  console.error('content-only-guard: no file path in tool input; blocking.');
  process.exit(2);
}

// Resolve symlinks via the deepest existing ancestor, so a link inside an
// allowed directory cannot point the write elsewhere.
function realResolve(p) {
  const missing = [];
  let current = p;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}

const realProject = realResolve(path.resolve(projectDir));
const resolved = realResolve(path.resolve(projectDir, target));
const allowed = ALLOWED_DIRS.some((dir) => {
  const root = path.join(realProject, dir) + path.sep;
  return resolved.startsWith(root);
});

if (!allowed) {
  console.error(
    `content-only-guard: curriculum-author may only write inside ${ALLOWED_DIRS.join(', ')}. ` +
      `Refused: ${path.relative(realProject, resolved)}`,
  );
  process.exit(2);
}

process.exit(0);

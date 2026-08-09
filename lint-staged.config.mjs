import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ESLint 9's flat config resolves eslint.config.js from the current working
// directory only — it does not cascade upward per linted file the way the
// old .eslintrc system did. lint-staged (via Husky) always runs from the
// repo root, but this monorepo deliberately has no root-level
// eslint.config.js: every workspace (apps/api, apps/customer-pwa,
// packages/domain-kit, packages/contracts) owns its own, composed from
// @leen-mart/config/eslint/*. `pnpm lint` works because `turbo run lint`
// runs each workspace's own "lint" script with that workspace as CWD.
//
// This walks up from each staged file to find the nearest eslint.config.js
// (generically — no hardcoded workspace list, so a newly added workspace is
// picked up automatically) and invokes ESLint once per workspace found,
// with --config pointing at it explicitly. --config resolves independent of
// CWD, and every workspace config already sets
// `tsconfigRootDir: import.meta.dirname`, so this matches exactly what
// `pnpm lint` already runs — just scoped to the staged files.
const REPO_ROOT = process.cwd();

const findWorkspaceEslintConfig = (filePath) => {
  let dir = dirname(filePath);
  for (;;) {
    const candidate = join(dir, 'eslint.config.js');
    if (existsSync(candidate)) return candidate;
    if (dir === REPO_ROOT) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const groupByWorkspaceConfig = (filenames) => {
  const groups = new Map();
  for (const filename of filenames) {
    const config = findWorkspaceEslintConfig(filename);
    if (!config) {
      console.warn(`[lint-staged] no workspace eslint.config.js found for ${filename}; skipping ESLint for it`);
      continue;
    }
    const files = groups.get(config) ?? [];
    files.push(filename);
    groups.set(config, files);
  }
  return groups;
};

const quote = (filename) => `"${filename}"`;

export default {
  '*.{ts,tsx}': (filenames) => {
    const groups = groupByWorkspaceConfig(filenames);
    const commands = Array.from(groups.entries()).map(
      ([config, files]) =>
        `eslint --config "${config}" --fix --max-warnings=0 ${files.map(quote).join(' ')}`,
    );
    commands.push(`prettier --write ${filenames.map(quote).join(' ')}`);
    return commands;
  },
  '*.{js,jsx,json,md,yml,yaml,css}': ['prettier --write'],
};

# AI Contribution Quality Filter

## Overview

A GitHub Action that detects AI-generated code in pull requests and scores code quality (0–100), helping maintainers identify and filter low-quality contributions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **GitHub Action runtime**: node20
- **Action bundler**: esbuild (CJS bundle → `dist/index.js`)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)

## Project Structure

```
action/                  # GitHub Action source
  src/
    main.ts              # Action entry point
    detector.ts          # AI code detection heuristics
    scorer.ts            # Quality scoring algorithm
    commenter.ts         # PR comment builder
    types.ts             # Shared types
  package.json
  build.mjs              # esbuild bundler
action.yml               # GitHub Action manifest (root — required for `uses:`)
dist/index.js            # Compiled action bundle (must be committed)
.github/workflows/       # Example workflow files
  example-usage.yml      # Standard usage example
  strict-example.yml     # Strict quality gate example
README.md                # Usage documentation
artifacts/api-server/    # Express API server
artifacts/dashboard/     # React dashboard (minimal scaffold)
lib/                     # Shared libraries
```

## Key Commands

- `pnpm --filter ai-contribution-quality-filter-action run build` — rebuild the action bundle into `dist/index.js`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## GitHub Action Usage

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    min-quality-score: 50
    fail-on-low-quality: false
```

## Important Notes

- `dist/index.js` at the repo root must be committed — it is the compiled action bundle that GitHub Actions downloads when people use `uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1`
- The `.gitignore` excludes subdirectory `dist/` folders but allows the root `dist/` to be committed
- After any changes to `action/src/`, rebuild with `pnpm --filter ai-contribution-quality-filter-action run build`
- History tracking requires `contents: write` permission in the user's workflow — this is documented in the README and example workflows

## Score History & Badge

- Each PR analysis writes an entry to `.github/quality-scores.json` (up to 200 entries, newest first)
- `.github/quality-badge.json` is updated with average score + shields.io endpoint format
- Badge URL: `https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/{owner}/{repo}/{branch}/.github/quality-badge.json`
- Workflow summary is written to `$GITHUB_STEP_SUMMARY` on every run (visible in Actions UI)

## AI Detection Signals

1. AI comment phrases ("This function...", "Note that...")
2. High comment density (>35% of lines)
3. Generic naming (result, data, item, response...)
4. Boilerplate patterns (TODO placeholders, lorem ipsum)
5. Repetitive code blocks
6. Excessive auto-generated docstrings

## Quality Scoring

Base score 100, deductions applied per file weighted by lines changed:
- AI detection: up to −30 pts
- Large diff (>500 lines): up to −15 pts
- No error handling: −8 pts
- Code duplication: up to −15 pts
- Poor naming: up to −10 pts
- High complexity: up to −10 pts

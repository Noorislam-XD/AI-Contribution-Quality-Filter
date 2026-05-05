# AI Contribution Quality Filter

A GitHub Action that automatically detects AI-generated code in pull requests and scores overall code quality (0–100), helping maintainers identify and filter low-quality contributions.

## Why This Exists

Open source maintainers are increasingly overwhelmed by AI-generated PR spam — generic, low-effort contributions that waste review time. This action gives maintainers a fast, automated first pass to:

- **Detect AI-generated code** using heuristic analysis + optional LLM reasoning
- **Score code quality** (0–100) across every changed file
- **Post visual reports** directly on pull requests
- **Label PRs automatically** (`ai-generated`, `needs-improvement`, `quality-verified`)
- **Track quality over time** — per-repo score history with README badge
- **Optionally block merges** when quality falls below your threshold

---

## Quick Start

No API keys needed — works out of the box with the built-in `GITHUB_TOKEN`:

```yaml
# .github/workflows/quality-filter.yml
name: AI Contribution Quality Filter

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  issues: write
  contents: write   # needed for score history

jobs:
  quality-filter:
    runs-on: ubuntu-latest
    steps:
      - uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          min-quality-score: 50
          track-history: true
```

---

## 🧠 LLM-Enhanced Mode (Recommended)

For significantly more accurate detection, provide an OpenAI or Anthropic API key. The action sends the diff to the LLM for semantic review and blends results (65% LLM / 35% heuristic).

### With OpenAI

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}   # Settings → Secrets → Actions
    # llm-model: gpt-4o   # optional upgrade (default: gpt-4o-mini)
```

### With Anthropic (Claude)

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    # llm-model: claude-3-5-sonnet-20241022   # optional upgrade
```

If the LLM call fails for any reason the action silently falls back to heuristics — your CI never breaks.

---

## 📈 Score History & README Badge

When `track-history: true` (the default), every PR analysis is saved to `.github/quality-scores.json` in your repo, and `.github/quality-badge.json` is updated automatically. This powers a live README badge showing your repo's average quality score.

### Add the badge to your README

```markdown
![Quality Score](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/.github/quality-badge.json)
```

Replace `YOUR_USERNAME`, `YOUR_REPO`, and `main` with your values.

### What the badge shows

The badge color reflects your repository's average score across all analyzed PRs:

| Average Score | Color |
|--------------|-------|
| 80–100 | 🟢 Bright green |
| 65–79 | 🟢 Green |
| 50–64 | 🟡 Yellow |
| 30–49 | 🟠 Orange |
| 0–29 | 🔴 Red |

### Score history file format

`.github/quality-scores.json` stores up to 200 entries:

```json
{
  "repo": "owner/repo",
  "lastUpdated": "2025-05-05T12:00:00.000Z",
  "averageScore": 74,
  "totalPrsAnalyzed": 47,
  "entries": [
    {
      "prNumber": 42,
      "prTitle": "Add user authentication",
      "prAuthor": "contributor",
      "qualityScore": 81,
      "aiConfidence": 0.12,
      "aiDetected": false,
      "passed": true,
      "filesAnalyzed": 6,
      "linesAdded": 312,
      "sha": "a3f9c2b",
      "branch": "feat/auth",
      "timestamp": "2025-05-05T12:00:00.000Z"
    }
  ]
}
```

### Required permission

History tracking commits files to the repo, so add `contents: write` to your workflow permissions:

```yaml
permissions:
  pull-requests: write
  issues: write
  contents: write   # ← required for track-history
```

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | — | Use `${{ secrets.GITHUB_TOKEN }}` |
| `openai-api-key` | ❌ | `''` | Enables LLM mode with OpenAI (gpt-4o-mini) |
| `anthropic-api-key` | ❌ | `''` | Enables LLM mode with Anthropic Claude |
| `llm-model` | ❌ | `''` | Override LLM model (e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| `min-quality-score` | ❌ | `50` | Minimum score (0–100) to pass |
| `ai-detection-threshold` | ❌ | `0.65` | Confidence threshold for AI detection |
| `fail-on-low-quality` | ❌ | `false` | Fail the workflow if score is below threshold |
| `comment-on-pr` | ❌ | `true` | Post a quality report comment on the PR |
| `label-pr` | ❌ | `true` | Apply labels based on result |
| `ai-generated-label` | ❌ | `ai-generated` | Label for detected AI code |
| `low-quality-label` | ❌ | `needs-improvement` | Label for below-threshold PRs |
| `high-quality-label` | ❌ | `quality-verified` | Label for passing PRs |
| `track-history` | ❌ | `true` | Save scores to `.github/quality-scores.json` |
| `history-branch` | ❌ | default branch | Branch where history files are written |
| `max-files-analyzed` | ❌ | `50` | Max files per PR |
| `exclude-paths` | ❌ | `*.md,*.lock,...` | Glob patterns to skip |

---

## Outputs

| Output | Description |
|--------|-------------|
| `quality-score` | Overall quality score (0–100) |
| `ai-detected` | `"true"` if AI code was detected |
| `ai-confidence` | AI detection confidence (0–1) |
| `files-analyzed` | Number of files analyzed |
| `passed` | `"true"` if the PR passed the quality threshold |

```yaml
- id: quality
  uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- run: echo "Score = ${{ steps.quality.outputs.quality-score }}"
```

---

## How Quality Is Scored

Base score 100, deductions per file weighted by lines changed. LLM and heuristic scores are blended in LLM mode.

| Signal | Max Deduction |
|--------|--------------|
| AI-generated code detected | −30 pts |
| Very large diff (>500 lines) | −15 pts |
| No error handling | −8 pts |
| Code duplication | −15 pts |
| Poor naming | −10 pts |
| High cyclomatic complexity | −10 pts |

---

## How AI Detection Works

### Heuristic signals (always active)

| Signal | What it detects |
|--------|----------------|
| **AI comment phrases** | "This function...", "Note that...", "This method returns..." |
| **Verbose comments** | Comment density >35% of lines |
| **Generic naming** | `result`, `data`, `item`, `response`, `element` overuse |
| **Boilerplate patterns** | TODO placeholders, lorem ipsum, Hello World |
| **Repetitive structures** | Near-identical blocks in the diff |
| **Excessive docstrings** | Auto-generated `@param`/`@returns` for every arg |

### LLM reasoning (optional)

When an API key is provided, the model reads the actual diff and evaluates writing style, naming choices, structural patterns, missing validation, security antipatterns, and logical quality — things static analysis misses.

---

## Strict Mode Example

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    min-quality-score: 70
    ai-detection-threshold: 0.55
    fail-on-low-quality: true   # fails the check, blocks merge
    track-history: true
```

---

## Labels Created Automatically

| Label | Color | Meaning |
|-------|-------|---------|
| `ai-generated` | 🟡 Yellow | AI code patterns detected |
| `needs-improvement` | 🔴 Red | Score below threshold |
| `quality-verified` | 🟢 Green | Score passed threshold |

---

## Required Permissions

```yaml
permissions:
  pull-requests: write   # post comments
  issues: write          # manage labels
  contents: write        # score history (use "read" if track-history: false)
```

---

## Rebuilding After Changes

If you modify `action/src/`, rebuild the bundle before committing:

```bash
pnpm --filter ai-contribution-quality-filter-action run build
# then commit dist/index.js
```

---

## Contributing & Feedback

Issues and PRs welcome. If the action incorrectly flags a contribution, open an issue — it helps improve the detection model.

---

## License

MIT

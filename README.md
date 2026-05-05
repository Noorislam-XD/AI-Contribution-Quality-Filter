# AI Contribution Quality Filter

A GitHub Action that automatically detects AI-generated code in pull requests and scores overall code quality (0–100), helping maintainers identify and filter low-quality contributions.

## Why This Exists

Open source maintainers are increasingly overwhelmed by AI-generated PR spam — generic, low-effort contributions that waste review time. This action gives maintainers a fast, automated first pass to:

- **Detect AI-generated code** using heuristic analysis + optional LLM reasoning
- **Score code quality** (0–100) across every changed file
- **Post visual reports** directly on pull requests
- **Label PRs automatically** (`ai-generated`, `needs-improvement`, `quality-verified`)
- **Request changes or approve** automatically based on score
- **Auto-close** extremely low-quality PRs with an explanation
- **Track quality over time** — per-repo score history with live README badge
- **Optionally block merges** via `fail-on-low-quality` or branch protection rules

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

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}   # Settings → Secrets → Actions
    # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}  # alternative
    # llm-model: gpt-4o   # optional upgrade (default: gpt-4o-mini)
```

If the LLM call fails, the action silently falls back to heuristics — your CI never breaks.

---

## 🔴 Automated Review Actions

The action can take automated actions on GitHub reviews — all are disabled by default and must be explicitly opted in.

### Request Changes (blocks merge)

When enabled, the action submits a "Request changes" GitHub review on low-quality PRs. This blocks the merge button until the review is dismissed or the PR is updated and re-analyzed.

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    request-changes-on-low-quality: true
    request-changes-threshold: 60   # optional, defaults to min-quality-score
```

**How it works:**
- When a PR scores below the threshold → "Request changes" review is submitted with a score breakdown and improvement suggestions
- When the contributor pushes a fix and the PR is re-analyzed → previous review is automatically dismissed before the new one is posted
- The review comment includes the score bar, top issues, AI signals, and LLM suggestions (if LLM mode is on)

### Auto-Approve (optional, for trusted setups)

Automatically approve PRs that pass the quality threshold with no AI detected:

```yaml
auto-approve-on-pass: true
```

> Only enable this if you're using branch protection with "Required reviewers" and want this action to count as a reviewer for basic quality gating.

### Auto-Close (hard rejection)

Automatically close PRs that score below a very low threshold. A comment is posted explaining why and how to re-open:

```yaml
auto-close-on-low-quality: true
auto-close-threshold: 20       # only closes truly terrible PRs
# auto-close-comment: "..."    # optional custom message
```

---

## 📈 Score History & README Badge

Every PR analysis is saved to `.github/quality-scores.json` and `.github/quality-badge.json` is updated automatically. Add this to your README for a live score badge:

```markdown
![Quality Score](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/.github/quality-badge.json)
```

| Average Score | Badge Color |
|--------------|-------------|
| 80–100 | 🟢 Bright green |
| 65–79 | 🟢 Green |
| 50–64 | 🟡 Yellow |
| 30–49 | 🟠 Orange |
| 0–29 | 🔴 Red |

---

## Full Configuration Example

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # LLM (optional)
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    # llm-model: gpt-4o

    # Scoring
    min-quality-score: 60
    ai-detection-threshold: 0.60
    fail-on-low-quality: true       # fails the CI check

    # PR decoration
    comment-on-pr: true
    label-pr: true
    ai-generated-label: ai-generated
    low-quality-label: needs-improvement
    high-quality-label: quality-verified

    # Automated reviews
    request-changes-on-low-quality: true    # blocks merge
    request-changes-threshold: 60
    auto-approve-on-pass: false
    auto-close-on-low-quality: true         # hard-reject very bad PRs
    auto-close-threshold: 20

    # History
    track-history: true
    # history-branch: main

    # Performance
    max-files-analyzed: 50
    exclude-paths: '*.md,*.lock,dist/**,build/**'
```

---

## Inputs

### Core

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | required | Use `${{ secrets.GITHUB_TOKEN }}` |
| `min-quality-score` | `50` | Minimum score to pass (0–100) |
| `ai-detection-threshold` | `0.65` | Confidence for AI detection (0–1) |
| `fail-on-low-quality` | `false` | Fail the CI check if score is below threshold |

### LLM

| Input | Default | Description |
|-------|---------|-------------|
| `openai-api-key` | `''` | Enables LLM mode (OpenAI) |
| `anthropic-api-key` | `''` | Enables LLM mode (Anthropic) — used if no OpenAI key |
| `llm-model` | `''` | Override model (e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

### Automated Reviews

| Input | Default | Description |
|-------|---------|-------------|
| `request-changes-on-low-quality` | `false` | Submit "Request changes" review below threshold |
| `request-changes-threshold` | `min-quality-score` | Score threshold for requesting changes |
| `auto-approve-on-pass` | `false` | Auto-approve passing PRs with no AI detected |
| `auto-close-on-low-quality` | `false` | Close PRs below `auto-close-threshold` |
| `auto-close-threshold` | `20` | Score threshold for auto-closing |
| `auto-close-comment` | `''` | Custom message when auto-closing (leave empty for default) |

### PR Decoration

| Input | Default | Description |
|-------|---------|-------------|
| `comment-on-pr` | `true` | Post quality report comment |
| `label-pr` | `true` | Apply labels based on result |
| `ai-generated-label` | `ai-generated` | Label for AI code |
| `low-quality-label` | `needs-improvement` | Label for failing PRs |
| `high-quality-label` | `quality-verified` | Label for passing PRs |

### History & Badge

| Input | Default | Description |
|-------|---------|-------------|
| `track-history` | `true` | Save scores to `.github/quality-scores.json` |
| `history-branch` | default branch | Branch where history files are written |

### Performance

| Input | Default | Description |
|-------|---------|-------------|
| `max-files-analyzed` | `50` | Max files per PR |
| `exclude-paths` | `*.md,*.lock,...` | Comma-separated glob patterns to skip |

---

## Outputs

| Output | Description |
|--------|-------------|
| `quality-score` | Overall quality score (0–100) |
| `ai-detected` | `"true"` if AI code was detected |
| `ai-confidence` | AI detection confidence (0–1) |
| `files-analyzed` | Number of files analyzed |
| `passed` | `"true"` if the PR passed the quality threshold |

---

## Required Permissions

```yaml
permissions:
  pull-requests: write   # post comments, submit reviews, auto-close
  issues: write          # manage labels
  contents: write        # score history (use "read" if track-history: false)
```

---

## How Quality Is Scored

Base score 100, deductions applied per file, weighted by lines changed. LLM and heuristic scores are blended in LLM mode.

| Signal | Max Deduction |
|--------|--------------|
| AI code detected | −30 pts |
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

### LLM reasoning (optional, requires API key)

Sends the diff to GPT/Claude, which evaluates writing style, naming, structural patterns, missing validation, security antipatterns, and logical quality — returning AI probability, quality score, and specific improvement suggestions.

---

## Rebuilding After Changes

If you modify `action/src/`, rebuild before committing:

```bash
pnpm --filter ai-contribution-quality-filter-action run build
# then commit dist/index.js
```

---

## Contributing & Feedback

Issues and PRs are welcome. If the action incorrectly flags a contribution, open an issue — it helps improve the detection model.

---

## License

MIT

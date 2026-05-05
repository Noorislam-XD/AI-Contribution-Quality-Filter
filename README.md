# AI Contribution Quality Filter

A GitHub Action that automatically detects AI-generated code in pull requests and scores overall code quality (0–100), helping maintainers identify and filter low-quality contributions.

## Why This Exists

Open source maintainers are increasingly overwhelmed by AI-generated PR spam — generic, low-effort contributions that waste review time. This action gives maintainers a fast, automated first pass to:

- **Detect AI-generated code** using heuristic pattern analysis
- **Score code quality** (0–100) across every changed file
- **Post visual reports** directly on pull requests
- **Label PRs automatically** (e.g. `ai-generated`, `needs-improvement`, `quality-verified`)
- **Optionally block merges** when quality falls below your threshold

---

## Quick Start

Add this workflow to your repo at `.github/workflows/quality-filter.yml`:

```yaml
name: AI Contribution Quality Filter

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  issues: write
  contents: read

jobs:
  quality-filter:
    runs-on: ubuntu-latest
    steps:
      - name: Run AI Contribution Quality Filter
        uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          min-quality-score: 50
          fail-on-low-quality: false
          comment-on-pr: true
          label-pr: true
```

That's it — no API keys needed. Works out of the box with the built-in `GITHUB_TOKEN`.

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | — | Use `${{ secrets.GITHUB_TOKEN }}` |
| `min-quality-score` | ❌ | `50` | Minimum score (0–100) to pass the check |
| `ai-detection-threshold` | ❌ | `0.65` | Confidence threshold (0–1) for AI code detection |
| `fail-on-low-quality` | ❌ | `false` | Fail the workflow if score is below threshold |
| `comment-on-pr` | ❌ | `true` | Post a quality report comment on the PR |
| `label-pr` | ❌ | `true` | Apply labels based on analysis result |
| `ai-generated-label` | ❌ | `ai-generated` | Label added when AI code is detected |
| `low-quality-label` | ❌ | `needs-improvement` | Label added when score is below threshold |
| `high-quality-label` | ❌ | `quality-verified` | Label added when score passes threshold |
| `max-files-analyzed` | ❌ | `50` | Max files to analyze per PR (for performance) |
| `exclude-paths` | ❌ | `*.md,*.lock,dist/**,...` | Comma-separated glob patterns to skip |

---

## Outputs

| Output | Description |
|--------|-------------|
| `quality-score` | Overall quality score (0–100) |
| `ai-detected` | `"true"` if AI code was detected, `"false"` otherwise |
| `ai-confidence` | AI detection confidence (0–1) |
| `files-analyzed` | Number of files analyzed |
| `passed` | `"true"` if the PR passed the quality threshold |

Use outputs in subsequent steps:

```yaml
- name: Run Quality Filter
  id: quality
  uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Use results
  run: |
    echo "Score: ${{ steps.quality.outputs.quality-score }}"
    echo "AI detected: ${{ steps.quality.outputs.ai-detected }}"
```

---

## How Quality Is Scored

The quality score starts at **100** and deductions are applied per file, then weighted by lines changed:

| Signal | Max Deduction |
|--------|--------------|
| AI-generated code detected | −30 pts |
| Very large diff (>500 lines) | −15 pts |
| No error handling in significant code | −8 pts |
| Code duplication | −15 pts |
| Poor naming conventions | −10 pts |
| High cyclomatic complexity | −10 pts |

---

## How AI Detection Works

The action uses **heuristic pattern analysis** — no external API keys required:

| Signal | What it detects |
|--------|----------------|
| **AI comment phrases** | Comments like "This function...", "Note that...", "This method returns..." |
| **Verbose comments** | Comment density >35% of lines |
| **Generic naming** | Heavy use of `result`, `data`, `item`, `response`, `element` |
| **Boilerplate patterns** | TODO placeholders, Hello World, lorem ipsum |
| **Repetitive structures** | Near-identical code blocks repeated across the diff |
| **Excessive docstrings** | Auto-generated `@param` / `@returns` for every argument |

---

## Example PR Comment

When the action runs, it posts a detailed report like this:

```
## 🔍 AI Contribution Quality Filter Report

![FAILED](badge) ![AI Detected](badge)

> ❌ This PR does not meet the minimum quality threshold of 50/100.

### 📊 Quality Score
🔶 42 / 100
[████████░░░░░░░░░░░░] 42%

| Metric        | Value                        |
|---------------|------------------------------|
| Quality Score | 42/100                       |
| AI Detection  | Detected (78% confidence)    |
| Files Analyzed| 6 of 8 total files           |
| Lines Added   | +312                         |
| Has Tests     | ⚠️ Not detected              |

### 🤖 AI Code Detection Signals
- Found 12 AI-typical comment phrases
- High comment density (41% of lines are comments)
- High density of generic identifiers

### 📁 File Analysis Breakdown
| File              | Language   | Quality    | AI Conf | Changes   |
|-------------------|------------|------------|---------|-----------|
| src/utils.ts      | TypeScript | 🔴 31/100  | 🤖 82%  | +87/-3    |
| src/api.ts        | TypeScript | 🟡 55/100  | ⚠️ 41%  | +124/-12  |
```

---

## Strict Mode Example

Block merges when quality is too low:

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    min-quality-score: 70
    ai-detection-threshold: 0.55
    fail-on-low-quality: true   # ← fails the workflow check
```

---

## Excluding Files

Skip generated files, lock files, and other noise:

```yaml
exclude-paths: '*.md,*.lock,dist/**,build/**,*.min.js,*.min.css,*.snap,*.svg'
```

---

## Labels Created Automatically

The action creates labels in your repo if they don't exist:

| Label | Color | Meaning |
|-------|-------|---------|
| `ai-generated` | 🟡 Yellow | AI code patterns detected |
| `needs-improvement` | 🔴 Red | Quality score below threshold |
| `quality-verified` | 🟢 Green | Score passed threshold |

---

## Permissions Required

The action needs these permissions (set in your workflow):

```yaml
permissions:
  pull-requests: write   # post comments
  issues: write          # manage labels
  contents: read         # read PR files
```

---

## Contributing & Feedback

Issues, feedback, and contributions are welcome. If the action incorrectly flags your PR, open an issue with the PR link — this helps improve the detection model.

---

## License

MIT

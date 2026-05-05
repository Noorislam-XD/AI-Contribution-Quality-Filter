# AI Contribution Quality Filter

A GitHub Action that automatically detects AI-generated code in pull requests and scores overall code quality (0–100), helping maintainers identify and filter low-quality contributions.

## Why This Exists

Open source maintainers are increasingly overwhelmed by AI-generated PR spam — generic, low-effort contributions that waste review time. This action gives maintainers a fast, automated first pass to:

- **Detect AI-generated code** using heuristic analysis + optional LLM reasoning
- **Score code quality** (0–100) across every changed file
- **Post visual reports** directly on pull requests
- **Label PRs automatically** (e.g. `ai-generated`, `needs-improvement`, `quality-verified`)
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

---

## 🧠 LLM-Enhanced Mode (Recommended)

For significantly more accurate detection, provide an OpenAI or Anthropic API key. The action will semantically analyze the diff using an LLM and blend those results (65% weight) with the heuristic analysis (35% weight).

### With OpenAI

1. Add your key as a repository secret: **Settings → Secrets → `OPENAI_API_KEY`**
2. Pass it to the action:

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    # Optional: override model (default: gpt-4o-mini)
    # llm-model: gpt-4o
```

### With Anthropic (Claude)

1. Add your key as a repository secret: **Settings → Secrets → `ANTHROPIC_API_KEY`**
2. Pass it to the action:

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    # Optional: override model (default: claude-3-haiku-20240307)
    # llm-model: claude-3-5-sonnet-20241022
```

### How blending works

| Mode | AI Confidence | Quality Score |
|------|--------------|---------------|
| Heuristic only | 100% heuristic | 100% heuristic |
| LLM enhanced | 35% heuristic + 65% LLM | 45% heuristic + 55% LLM |

The LLM analyzes up to 8 of the most-changed files (truncated to ~12,000 chars) and returns:
- AI probability with reasoning
- Specific quality issues found
- Actionable improvement suggestions

If the LLM call fails for any reason, the action silently falls back to heuristics and logs a warning — it never breaks your CI.

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | — | Use `${{ secrets.GITHUB_TOKEN }}` |
| `openai-api-key` | ❌ | `''` | Enables LLM mode with OpenAI (gpt-4o-mini by default) |
| `anthropic-api-key` | ❌ | `''` | Enables LLM mode with Anthropic Claude (used if no OpenAI key) |
| `llm-model` | ❌ | `''` | Override the LLM model (e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| `min-quality-score` | ❌ | `50` | Minimum score (0–100) to pass the check |
| `ai-detection-threshold` | ❌ | `0.65` | Confidence threshold (0–1) for AI code detection |
| `fail-on-low-quality` | ❌ | `false` | Fail the workflow if score is below threshold |
| `comment-on-pr` | ❌ | `true` | Post a quality report comment on the PR |
| `label-pr` | ❌ | `true` | Apply labels based on analysis result |
| `ai-generated-label` | ❌ | `ai-generated` | Label added when AI code is detected |
| `low-quality-label` | ❌ | `needs-improvement` | Label added when score is below threshold |
| `high-quality-label` | ❌ | `quality-verified` | Label added when score passes threshold |
| `max-files-analyzed` | ❌ | `50` | Max files to analyze per PR |
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
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}

- name: Use results
  run: |
    echo "Score: ${{ steps.quality.outputs.quality-score }}"
    echo "AI detected: ${{ steps.quality.outputs.ai-detected }}"
    echo "Passed: ${{ steps.quality.outputs.passed }}"
```

---

## How Quality Is Scored

The quality score starts at **100** and deductions are applied per file, then weighted by lines changed. In LLM mode, heuristic and LLM scores are blended.

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

### Heuristic signals (always active, no API key needed)

| Signal | What it detects |
|--------|----------------|
| **AI comment phrases** | "This function...", "Note that...", "This method returns..." |
| **Verbose comments** | Comment density >35% of lines |
| **Generic naming** | Heavy use of `result`, `data`, `item`, `response`, `element` |
| **Boilerplate patterns** | TODO placeholders, Hello World, lorem ipsum |
| **Repetitive structures** | Near-identical code blocks repeated in the diff |
| **Excessive docstrings** | Auto-generated `@param` / `@returns` for every argument |

### LLM reasoning (optional, requires API key)

When an API key is provided, the LLM reads the actual diff and evaluates:
- Whether the writing style, naming choices, and structure match AI generation patterns
- Specific quality issues that static analysis would miss (e.g. logical bugs, security antipatterns, missing validation)
- Actionable suggestions tailored to the actual code

---

## Example PR Comment

```
## 🔍 AI Contribution Quality Filter Report

![FAILED] ![AI Detected (78%)] ![LLM Enhanced]

> ❌ This PR does not meet the minimum quality threshold of 50/100.

### 📊 Quality Score
🔶 42 / 100
[████████░░░░░░░░░░░░] 42%

| Metric        | Value                                    |
|---------------|------------------------------------------|
| Quality Score | 42/100                                   |
| AI Detection  | Detected (78% confidence)                |
| Analysis Mode | Heuristic + LLM (blended)                |
| Files Analyzed| 6 of 8 total files                       |
| Lines Added   | +312                                     |

### 🧠 LLM Code Review
> This PR shows strong signs of AI generation — variable names like `result`,
> `data`, and `response` appear throughout with no domain context. Error handling
> is absent in the API layer. The code functions but lacks the contextual
> adaptation expected of a human contributor.

### 🤖 AI Code Detection Signals
- Generic variable names with no domain context (result, data, response)
- Found 12 AI-typical comment phrases ("This function...", "Note that...")
- High comment density (41% of lines are comments)

### 📁 File Analysis Breakdown
| File            | Language   | Quality    | AI Conf | Changes   |
|-----------------|------------|------------|---------|-----------|
| src/utils.ts    | TypeScript | 🔴 31/100  | 🤖 82%  | +87/-3    |
| src/api.ts      | TypeScript | 🟡 55/100  | ⚠️ 41%  | +124/-12  |
```

---

## Strict Mode Example

Block merges when quality is too low:

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    min-quality-score: 70
    ai-detection-threshold: 0.55
    fail-on-low-quality: true
```

---

## Labels Created Automatically

| Label | Color | Meaning |
|-------|-------|---------|
| `ai-generated` | 🟡 Yellow | AI code patterns detected |
| `needs-improvement` | 🔴 Red | Quality score below threshold |
| `quality-verified` | 🟢 Green | Score passed threshold |

---

## Permissions Required

```yaml
permissions:
  pull-requests: write   # post comments
  issues: write          # manage labels
  contents: read         # read PR files
```

---

## After Making Changes

If you modify the source in `action/src/`, rebuild the bundle before committing:

```bash
pnpm --filter ai-contribution-quality-filter-action run build
```

Then commit the updated `dist/index.js` — GitHub downloads this file when anyone uses your action.

---

## Contributing & Feedback

Issues, feedback, and contributions are welcome. If the action incorrectly flags a PR, open an issue with the PR link — this helps improve the detection model.

---

## License

MIT

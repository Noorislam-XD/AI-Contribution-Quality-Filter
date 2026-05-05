# AI Contribution Quality Filter

A GitHub Action that automatically detects AI-generated code in pull requests and scores overall code quality (0–100), helping maintainers identify and filter low-quality contributions.

## Why This Exists

Open source maintainers are increasingly overwhelmed by AI-generated PR spam — generic, low-effort contributions that waste review time. This action gives maintainers a fast, automated first pass to:

- **Detect AI-generated code** using heuristic analysis + optional LLM reasoning
- **Score code quality** (0–100) across every changed file
- **Post visual reports** directly on pull requests
- **Trusted contributors** bypass analysis entirely — core team and bots never get flagged
- **Blocked contributors** are auto-failed regardless of code quality
- **Label PRs automatically** (`ai-generated`, `needs-improvement`, `quality-verified`)
- **Request changes or approve** automatically based on score
- **Auto-close** extremely low-quality PRs
- **Track quality over time** with a live README badge

---

## Quick Start

```yaml
# .github/workflows/quality-filter.yml
name: AI Contribution Quality Filter

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  issues: write
  contents: write

jobs:
  quality-filter:
    runs-on: ubuntu-latest
    steps:
      - uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          min-quality-score: 50
          trust-bots: true
          track-history: true
```

---

## ⭐ Contributor Allowlist & Blocklist

Control which contributors are checked — all three layers run in priority order: **blocklist → trusted list → org membership → bot detection → normal analysis**.

### Trusted contributors (always pass)

Trusted contributors bypass the full analysis. The action immediately approves their PR and posts a short "trusted contributor" note instead of a full report.

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    trusted-contributors: alice,bob,carol,release-bot*
```

**Wildcard patterns** are supported: `myorg-*` matches `myorg-ci`, `myorg-deploy`, `myorg-bot`, etc.

### Trust bots automatically (default: on)

By default, well-known GitHub automation bots always pass without analysis:

| Bot | |
|-----|--|
| `dependabot[bot]` | `renovate[bot]` |
| `github-actions[bot]` | `snyk-bot` |
| `imgbot[bot]` | `mergify[bot]` |
| `allcontributors[bot]` | `pre-commit-ci[bot]` |
| Any user ending in `[bot]` | |

Disable with `trust-bots: false` if you want to analyze bot PRs too.

### Trust entire organizations

All members of a GitHub organization automatically pass:

```yaml
trusted-org: my-company   # all members of @my-company skip analysis
```

> Requires `read:org` scope. The built-in `GITHUB_TOKEN` has this for public orgs. For private orgs, use a Personal Access Token stored as a secret.

### Blocked contributors (always fail)

Blocked contributors are immediately rejected regardless of code quality — no analysis is run:

```yaml
blocked-contributors: spammer1,known-bad-actor,sockpuppet*
```

The PR receives a comment explaining it was rejected, and labels are applied. Blocked takes priority over trusted — if someone appears on both lists, they are blocked.

### Skip analysis vs. run for metrics

By default, trusted contributors skip the full analysis (`skip-analysis-for-trusted: true`). Set it to `false` to still run the analysis (for historical score tracking) while treating the contributor as trusted:

```yaml
skip-analysis-for-trusted: false   # run analysis but always pass
```

---

## 🧠 LLM-Enhanced Mode

Provide an OpenAI or Anthropic API key for significantly more accurate detection:

```yaml
openai-api-key: ${{ secrets.OPENAI_API_KEY }}
# anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
# llm-model: gpt-4o   # optional upgrade (default: gpt-4o-mini)
```

Results are blended: 65% LLM + 35% heuristic. Falls back silently to heuristics on failure.

---

## 🔴 Automated Review Actions

All off by default — opt in explicitly.

| Feature | Input | Effect |
|---------|-------|--------|
| Request changes | `request-changes-on-low-quality: true` | Blocks merge button below threshold |
| Auto-approve | `auto-approve-on-pass: true` | Approves passing PRs with no AI detected |
| Auto-close | `auto-close-on-low-quality: true` | Closes PRs below `auto-close-threshold` |

When a contributor pushes a fix, the previous "Request changes" review is automatically dismissed before the new analysis posts its result.

---

## 📈 Score History & README Badge

Every analysis is saved to `.github/quality-scores.json`. Add a live badge to your README:

```markdown
![Quality Score](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/.github/quality-badge.json)
```

---

## Full Configuration Example

```yaml
- uses: Noorislam-XD/AI-Contribution-Quality-Filter@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # LLM
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}

    # Scoring
    min-quality-score: 70
    ai-detection-threshold: 0.60
    fail-on-low-quality: true

    # Allowlist / blocklist
    trust-bots: true
    trusted-contributors: alice,bob,release-bot*
    blocked-contributors: spammer1
    trusted-org: my-company
    skip-analysis-for-trusted: true
    blocked-score-cap: 0

    # Automated reviews
    request-changes-on-low-quality: true
    request-changes-threshold: 70
    auto-approve-on-pass: true
    auto-close-on-low-quality: true
    auto-close-threshold: 20

    # History
    track-history: true

    # Performance
    max-files-analyzed: 50
    exclude-paths: '*.md,*.lock,dist/**,build/**'
```

---

## All Inputs

### Core

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | required | Use `${{ secrets.GITHUB_TOKEN }}` |
| `min-quality-score` | `50` | Minimum score to pass (0–100) |
| `ai-detection-threshold` | `0.65` | Confidence for AI detection (0–1) |
| `fail-on-low-quality` | `false` | Fail the CI check if score is below threshold |

### Contributor Allowlist / Blocklist

| Input | Default | Description |
|-------|---------|-------------|
| `trusted-contributors` | `''` | Comma-separated usernames/patterns that always pass |
| `blocked-contributors` | `''` | Comma-separated usernames that always fail |
| `trust-bots` | `true` | Auto-trust GitHub bots (dependabot, renovate, etc.) |
| `trusted-org` | `''` | Org name — all members automatically trusted |
| `blocked-score-cap` | `0` | Score assigned to blocked contributors |
| `skip-analysis-for-trusted` | `true` | Skip full analysis for trusted contributors |

### LLM

| Input | Default | Description |
|-------|---------|-------------|
| `openai-api-key` | `''` | Enables LLM mode (OpenAI) |
| `anthropic-api-key` | `''` | Enables LLM mode (Anthropic) |
| `llm-model` | `''` | Override model (e.g. `gpt-4o`) |

### Automated Reviews

| Input | Default | Description |
|-------|---------|-------------|
| `request-changes-on-low-quality` | `false` | Submit "Request changes" review |
| `request-changes-threshold` | `min-quality-score` | Threshold for requesting changes |
| `auto-approve-on-pass` | `false` | Auto-approve passing PRs |
| `auto-close-on-low-quality` | `false` | Auto-close below threshold |
| `auto-close-threshold` | `20` | Score threshold for auto-closing |
| `auto-close-comment` | `''` | Custom auto-close message |

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
| `exclude-paths` | `*.md,*.lock,...` | Glob patterns to skip |

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

Base 100, deductions per file weighted by lines changed. LLM + heuristic blended in LLM mode.

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

**Heuristic (always active):** AI comment phrases, verbose comments, generic naming, boilerplate patterns, repetitive structures, excessive docstrings.

**LLM (optional):** Sends the diff to GPT/Claude for semantic evaluation of writing style, naming, structural patterns, security antipatterns, and logical quality.

---

## Rebuilding After Changes

```bash
pnpm --filter ai-contribution-quality-filter-action run build
# commit dist/index.js
```

---

## License

MIT

import * as core from "@actions/core";
import * as github from "@actions/github";
import type { AnalysisResult } from "./types.js";

const SCORES_FILE = ".github/quality-scores.json";
const BADGE_FILE = ".github/quality-badge.json";
const MAX_HISTORY_ENTRIES = 200;

export interface ScoreEntry {
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  qualityScore: number;
  aiConfidence: number;
  aiDetected: boolean;
  passed: boolean;
  filesAnalyzed: number;
  linesAdded: number;
  sha: string;
  branch: string;
  runId: number;
  timestamp: string;
}

export interface ScoreHistory {
  repo: string;
  lastUpdated: string;
  averageScore: number;
  totalPrsAnalyzed: number;
  entries: ScoreEntry[];
}

export async function saveScoreHistory(
  octokit: ReturnType<typeof github.getOctokit>,
  result: AnalysisResult,
  branch: string
): Promise<void> {
  const { repoOwner, repoName } = result;
  const ctx = github.context;
  const sha = (ctx.payload.pull_request?.head?.sha as string | undefined) ?? ctx.sha;
  const prBranch = (ctx.payload.pull_request?.head?.ref as string | undefined) ?? "unknown";
  const runId = ctx.runId;

  const entry: ScoreEntry = {
    prNumber: result.prNumber,
    prTitle: result.prTitle,
    prAuthor: result.prAuthor,
    qualityScore: result.qualityScore,
    aiConfidence: parseFloat(result.aiConfidence.toFixed(3)),
    aiDetected: result.aiDetected,
    passed: result.passed,
    filesAnalyzed: result.filesAnalyzed,
    linesAdded: result.summary.totalLinesAdded,
    sha: sha.slice(0, 7),
    branch: prBranch,
    runId,
    timestamp: result.timestamp,
  };

  let history = await readHistory(octokit, repoOwner, repoName, branch);
  const existingIdx = history.entries.findIndex((e) => e.prNumber === result.prNumber);

  if (existingIdx >= 0) {
    history.entries[existingIdx] = entry;
  } else {
    history.entries.unshift(entry);
  }

  if (history.entries.length > MAX_HISTORY_ENTRIES) {
    history.entries = history.entries.slice(0, MAX_HISTORY_ENTRIES);
  }

  history.lastUpdated = result.timestamp;
  history.totalPrsAnalyzed = history.entries.length;
  history.averageScore = computeAverage(history.entries);
  history.repo = `${repoOwner}/${repoName}`;

  await writeFile(octokit, repoOwner, repoName, branch, SCORES_FILE, JSON.stringify(history, null, 2));

  const badge = buildBadgeJson(history.averageScore, history.totalPrsAnalyzed);
  await writeFile(octokit, repoOwner, repoName, branch, BADGE_FILE, JSON.stringify(badge, null, 2));

  core.info(`📈 Score history saved: ${history.totalPrsAnalyzed} entries, avg ${history.averageScore}/100`);
  core.info(`🏷️  Badge URL: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${BADGE_FILE}`);
}

async function readHistory(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  branch: string
): Promise<ScoreHistory> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: SCORES_FILE,
      ref: branch,
    });

    if ("content" in data && typeof data.content === "string") {
      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      return JSON.parse(decoded) as ScoreHistory;
    }
  } catch {
    // File doesn't exist yet — start fresh
  }

  return {
    repo: `${owner}/${repo}`,
    lastUpdated: new Date().toISOString(),
    averageScore: 0,
    totalPrsAnalyzed: 0,
    entries: [],
  };
}

async function writeFile(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string
): Promise<void> {
  const encodedContent = Buffer.from(content).toString("base64");
  let sha: string | undefined;

  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    if ("sha" in data) sha = data.sha;
  } catch {
    // File doesn't exist yet
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `chore: update quality scores [skip ci]`,
    content: encodedContent,
    branch,
    ...(sha ? { sha } : {}),
  });
}

function computeAverage(entries: ScoreEntry[]): number {
  if (entries.length === 0) return 0;
  const sum = entries.reduce((s, e) => s + e.qualityScore, 0);
  return Math.round(sum / entries.length);
}

function buildBadgeJson(averageScore: number, total: number): object {
  let color = "red";
  if (averageScore >= 80) color = "brightgreen";
  else if (averageScore >= 65) color = "green";
  else if (averageScore >= 50) color = "yellow";
  else if (averageScore >= 30) color = "orange";

  return {
    schemaVersion: 1,
    label: "quality score",
    message: `${averageScore}/100 (${total} PRs)`,
    color,
    cacheSeconds: 3600,
  };
}

export async function writeWorkflowSummary(result: AnalysisResult, history: ScoreEntry[] | null): Promise<void> {
  const { qualityScore, aiDetected, aiConfidence, passed, summary, filesAnalyzed, totalFilesInPr, prNumber, prTitle, prAuthor, llmAnalysis } = result;

  const scoreBar = buildTextBar(qualityScore);
  const trend = history ? buildTrend(history, qualityScore) : "";

  const summaryLines: string[] = [
    `## 🔍 AI Contribution Quality Filter — PR #${prNumber}`,
    ``,
    `> **"${prTitle}"** by @${prAuthor}`,
    ``,
    `| | |`,
    `|---|---|`,
    `| **Quality Score** | ${scoreBar} **${qualityScore}/100** |`,
    `| **Status** | ${passed ? "✅ PASSED" : "❌ FAILED"} |`,
    `| **AI Detected** | ${aiDetected ? `🤖 Yes (${Math.round(aiConfidence * 100)}% confidence)` : "✅ Not detected"} |`,
    `| **Analysis Mode** | ${llmAnalysis ? "Heuristic + LLM (blended)" : "Heuristic only"} |`,
    `| **Files Analyzed** | ${filesAnalyzed} / ${totalFilesInPr} |`,
    `| **Lines Added** | +${summary.totalLinesAdded} |`,
    `| **Has Tests** | ${summary.hasTests ? "✅ Yes" : "⚠️ Not detected"} |`,
    ``,
  ];

  if (llmAnalysis?.reasoning) {
    summaryLines.push(`### 🧠 LLM Assessment`);
    summaryLines.push(`> ${llmAnalysis.reasoning}`);
    summaryLines.push(``);
  }

  if (summary.topAiSignals.length > 0 && aiDetected) {
    summaryLines.push(`### 🤖 AI Detection Signals`);
    for (const s of summary.topAiSignals.slice(0, 4)) {
      summaryLines.push(`- ${s}`);
    }
    summaryLines.push(``);
  }

  if (summary.topQualityIssues.length > 0) {
    summaryLines.push(`### ⚠️ Quality Issues`);
    for (const issue of summary.topQualityIssues.slice(0, 5)) {
      summaryLines.push(`- ${issue}`);
    }
    summaryLines.push(``);
  }

  if (trend) {
    summaryLines.push(`### 📈 Repository Score Trend`);
    summaryLines.push(trend);
    summaryLines.push(``);
  }

  const summaryText = summaryLines.join("\n");

  const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryFile) {
    const fs = await import("fs");
    fs.appendFileSync(summaryFile, summaryText + "\n");
    core.info("Wrote workflow summary.");
  }
}

function buildTextBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}

function buildTrend(history: ScoreEntry[], currentScore: number): string {
  if (history.length === 0) return "";

  const recent = [...history].slice(0, 9).reverse();
  recent.push({ qualityScore: currentScore } as ScoreEntry);

  const rows = recent.map((e, i) => {
    const label = i === recent.length - 1 ? "**Now**" : `PR #${e.prNumber}`;
    const bar = buildTextBar(e.qualityScore);
    return `| ${label} | \`${bar}\` | ${e.qualityScore}/100 |`;
  });

  return `| PR | Score Bar | Score |\n|---|---|---|\n${rows.join("\n")}`;
}

import * as core from "@actions/core";
import * as github from "@actions/github";
import { minimatch } from "minimatch";
import { detectAiSignals, calculateAiConfidence, detectLanguage } from "./detector.js";
import { scoreFile, aggregateScore, isAnalyzableFile } from "./scorer.js";
import { buildPrComment } from "./commenter.js";
import type {
  ActionConfig,
  AnalysisResult,
  AnalysisSummary,
  FileAnalysis,
  PullRequestFile,
} from "./types.js";

async function run(): Promise<void> {
  try {
    const config = readConfig();

    const token = core.getInput("github-token", { required: true });
    const octokit = github.getOctokit(token);
    const ctx = github.context;

    if (!ctx.payload.pull_request) {
      core.warning("This action only runs on pull_request events. Skipping.");
      return;
    }

    const prNumber = ctx.payload.pull_request.number;
    const prTitle = ctx.payload.pull_request.title as string;
    const prAuthor = (ctx.payload.pull_request.user as { login: string }).login;
    const repoOwner = ctx.repo.owner;
    const repoName = ctx.repo.repo;

    core.info(`Analyzing PR #${prNumber}: "${prTitle}" by @${prAuthor}`);
    core.info(`Repo: ${repoOwner}/${repoName}`);

    const { data: prFiles } = await octokit.rest.pulls.listFiles({
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
      per_page: 100,
    });

    const eligibleFiles = prFiles.filter(
      (f) =>
        isAnalyzableFile(f.filename) &&
        !isExcluded(f.filename, config.excludePaths) &&
        f.patch !== undefined
    ) as PullRequestFile[];

    const filesToAnalyze = eligibleFiles.slice(0, config.maxFilesAnalyzed);

    core.info(
      `Found ${prFiles.length} files in PR. Analyzing ${filesToAnalyze.length} eligible files.`
    );

    const fileAnalyses: FileAnalysis[] = [];

    for (const file of filesToAnalyze) {
      core.info(`  → Analyzing: ${file.filename}`);
      const patch = file.patch ?? "";
      const addedLines = patch
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      const removedLines = patch
        .split("\n")
        .filter((l) => l.startsWith("-") && !l.startsWith("---"));
      const addedCode = addedLines.map((l) => l.slice(1)).join("\n");

      const language = detectLanguage(file.filename);
      const aiSignals = detectAiSignals(addedCode, file.filename);
      const aiConfidence = calculateAiConfidence(aiSignals);
      const { score, deductions } = scoreFile(
        file.filename,
        patch,
        aiSignals,
        aiConfidence
      );

      fileAnalyses.push({
        filename: file.filename,
        language,
        aiSignals,
        aiConfidence,
        qualityDeductions: deductions,
        qualityScore: score,
        linesAdded: addedLines.length,
        linesRemoved: removedLines.length,
      });
    }

    const overallScore = aggregateScore(fileAnalyses);
    const overallAiConfidence =
      fileAnalyses.length > 0
        ? Math.max(...fileAnalyses.map((f) => f.aiConfidence))
        : 0;
    const aiDetected = overallAiConfidence >= config.aiDetectionThreshold;
    const passed = overallScore >= config.minQualityScore;

    const summary = buildSummary(fileAnalyses, prFiles as PullRequestFile[]);

    const result: AnalysisResult = {
      repoOwner,
      repoName,
      prNumber,
      prTitle,
      prAuthor,
      filesAnalyzed: fileAnalyses.length,
      totalFilesInPr: prFiles.length,
      qualityScore: overallScore,
      aiDetected,
      aiConfidence: overallAiConfidence,
      fileAnalyses,
      summary,
      passed,
      timestamp: new Date().toISOString(),
    };

    core.info(`\n📊 Analysis complete:`);
    core.info(`   Quality Score: ${overallScore}/100`);
    core.info(
      `   AI Detected: ${aiDetected} (confidence: ${Math.round(overallAiConfidence * 100)}%)`
    );
    core.info(`   Passed: ${passed} (threshold: ${config.minQualityScore})`);

    core.setOutput("quality-score", String(overallScore));
    core.setOutput("ai-detected", String(aiDetected));
    core.setOutput("ai-confidence", String(overallAiConfidence.toFixed(3)));
    core.setOutput("files-analyzed", String(fileAnalyses.length));
    core.setOutput("passed", String(passed));

    if (config.commentOnPr) {
      await postOrUpdateComment(octokit, repoOwner, repoName, prNumber, result, config.minQualityScore);
    }

    if (config.labelPr) {
      await manageLabels(octokit, repoOwner, repoName, prNumber, result, config);
    }

    if (!passed && config.failOnLowQuality) {
      core.setFailed(
        `PR quality score ${overallScore}/100 is below the required threshold of ${config.minQualityScore}/100.`
      );
    } else if (!passed) {
      core.warning(
        `PR quality score ${overallScore}/100 is below the threshold of ${config.minQualityScore}/100. Consider reviewing the contribution.`
      );
    } else {
      core.info(`✅ PR passed quality check with score ${overallScore}/100.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

function readConfig(): ActionConfig {
  return {
    minQualityScore: parseInt(core.getInput("min-quality-score") || "50", 10),
    aiDetectionThreshold: parseFloat(core.getInput("ai-detection-threshold") || "0.65"),
    failOnLowQuality: core.getInput("fail-on-low-quality") === "true",
    commentOnPr: core.getInput("comment-on-pr") !== "false",
    labelPr: core.getInput("label-pr") !== "false",
    aiGeneratedLabel: core.getInput("ai-generated-label") || "ai-generated",
    lowQualityLabel: core.getInput("low-quality-label") || "needs-improvement",
    highQualityLabel: core.getInput("high-quality-label") || "quality-verified",
    maxFilesAnalyzed: parseInt(core.getInput("max-files-analyzed") || "50", 10),
    excludePaths: (core.getInput("exclude-paths") || "*.md,*.lock,dist/**,build/**,*.min.js,*.min.css")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  };
}

function isExcluded(filename: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern, { matchBase: true }));
}

function buildSummary(
  fileAnalyses: FileAnalysis[],
  allFiles: PullRequestFile[]
): AnalysisSummary {
  const totalLinesAdded = fileAnalyses.reduce((s, f) => s + f.linesAdded, 0);
  const totalLinesRemoved = fileAnalyses.reduce((s, f) => s + f.linesRemoved, 0);

  const signalCounts = new Map<string, number>();
  for (const f of fileAnalyses) {
    for (const s of f.aiSignals) {
      signalCounts.set(s.description, (signalCounts.get(s.description) ?? 0) + s.matches);
    }
  }
  const topAiSignals = [...signalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([desc]) => desc);

  const deductionCounts = new Map<string, number>();
  for (const f of fileAnalyses) {
    for (const d of f.qualityDeductions) {
      deductionCounts.set(d.reason, (deductionCounts.get(d.reason) ?? 0) + d.points);
    }
  }
  const topQualityIssues = [...deductionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason]) => reason);

  const languageSet = new Set(fileAnalyses.map((f) => f.language));
  const languagesDetected = [...languageSet].filter(
    (l) => l !== "Unknown" && l !== "JSON" && l !== "YAML" && l !== "Markdown"
  );

  const hasTests = allFiles.some(
    (f) =>
      /\.(test|spec)\.\w+$/.test(f.filename) ||
      f.filename.includes("__tests__") ||
      f.filename.includes("/tests/") ||
      f.filename.includes("/test/")
  );

  const hasDocumentation = allFiles.some(
    (f) => /\.(md|rst|txt)$/.test(f.filename)
  );

  return {
    totalLinesAdded,
    totalLinesRemoved,
    topAiSignals,
    topQualityIssues,
    languagesDetected,
    hasTests,
    hasDocumentation,
  };
}

async function postOrUpdateComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  result: AnalysisResult,
  minScore: number
): Promise<void> {
  const marker = "<!-- ai-quality-filter-report -->";
  const body = marker + "\n" + buildPrComment(result, minScore);

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info("Updated existing quality report comment.");
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    core.info("Posted quality report comment.");
  }
}

async function manageLabels(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  result: AnalysisResult,
  config: ActionConfig
): Promise<void> {
  const labelsToAdd: string[] = [];
  const labelsToRemove: string[] = [];

  if (result.aiDetected) {
    labelsToAdd.push(config.aiGeneratedLabel);
  } else {
    labelsToRemove.push(config.aiGeneratedLabel);
  }

  if (!result.passed) {
    labelsToAdd.push(config.lowQualityLabel);
    labelsToRemove.push(config.highQualityLabel);
  } else {
    labelsToAdd.push(config.highQualityLabel);
    labelsToRemove.push(config.lowQualityLabel);
  }

  for (const label of labelsToAdd) {
    try {
      await ensureLabelExists(octokit, owner, repo, label);
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: prNumber,
        labels: [label],
      });
      core.info(`Added label: "${label}"`);
    } catch (e) {
      core.warning(`Could not add label "${label}": ${(e as Error).message}`);
    }
  }

  const { data: currentLabels } = await octokit.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: prNumber,
  });

  for (const label of labelsToRemove) {
    if (currentLabels.some((l) => l.name === label)) {
      try {
        await octokit.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: prNumber,
          name: label,
        });
        core.info(`Removed label: "${label}"`);
      } catch (e) {
        core.warning(`Could not remove label "${label}": ${(e as Error).message}`);
      }
    }
  }
}

async function ensureLabelExists(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  labelName: string
): Promise<void> {
  const labelColors: Record<string, string> = {
    "ai-generated": "e4e669",
    "needs-improvement": "d93f0b",
    "quality-verified": "0e8a16",
  };

  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: labelName });
  } catch {
    const color = labelColors[labelName] ?? "cccccc";
    try {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: labelName,
        color,
        description: `Applied by AI Contribution Quality Filter`,
      });
    } catch {
      // Label might have been created concurrently — ignore
    }
  }
}

run();

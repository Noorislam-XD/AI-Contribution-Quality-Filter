import * as core from "@actions/core";
import * as github from "@actions/github";
import { minimatch } from "minimatch";
import { detectAiSignals, calculateAiConfidence, detectLanguage } from "./detector.js";
import { scoreFile, aggregateScore, isAnalyzableFile } from "./scorer.js";
import { buildPrComment } from "./commenter.js";
import { runLlmAnalysis, buildCombinedDiff, blendScores } from "./llm-analyzer.js";
import { saveScoreHistory, writeWorkflowSummary } from "./history.js";
import { submitReview } from "./reviewer.js";
import {
  checkContributor,
  buildTrustedComment,
  buildBlockedComment,
} from "./allowlist.js";
import type {
  ActionConfig,
  AnalysisResult,
  AnalysisSummary,
  FileAnalysis,
  LlmProvider,
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

    // --- Allowlist / blocklist check ---
    const allowlistConfig = {
      trustedContributors: config.trustedContributors,
      blockedContributors: config.blockedContributors,
      trustBots: config.trustBots,
      trustedOrg: config.trustedOrg,
      blockedScoreCap: config.blockedScoreCap,
      skipAnalysisForTrusted: config.skipAnalysisForTrusted,
    };

    const contributorCheck = await checkContributor(prAuthor, octokit, allowlistConfig);

    if (contributorCheck.status === "trusted" && config.skipAnalysisForTrusted) {
      core.info(`⭐ Trusted contributor: ${contributorCheck.reason} — skipping analysis.`);
      core.setOutput("quality-score", "100");
      core.setOutput("ai-detected", "false");
      core.setOutput("ai-confidence", "0");
      core.setOutput("files-analyzed", "0");
      core.setOutput("passed", "true");
      if (config.commentOnPr) {
        await octokit.rest.issues.createComment({
          owner: repoOwner, repo: repoName, issue_number: prNumber,
          body: buildTrustedComment(prAuthor, contributorCheck.reason),
        });
      }
      if (config.labelPr) {
        try {
          await octokit.rest.issues.addLabels({
            owner: repoOwner, repo: repoName, issue_number: prNumber,
            labels: [config.highQualityLabel],
          });
        } catch { /* non-fatal */ }
      }
      return;
    }

    if (contributorCheck.status === "blocked") {
      core.info(`🚫 Blocked contributor: ${contributorCheck.reason}`);
      core.setOutput("quality-score", String(config.blockedScoreCap));
      core.setOutput("ai-detected", "true");
      core.setOutput("ai-confidence", "1");
      core.setOutput("files-analyzed", "0");
      core.setOutput("passed", "false");
      if (config.commentOnPr) {
        await octokit.rest.issues.createComment({
          owner: repoOwner, repo: repoName, issue_number: prNumber,
          body: buildBlockedComment(prAuthor, contributorCheck.reason, config.blockedScoreCap, true),
        });
      }
      if (config.labelPr) {
        try {
          await octokit.rest.issues.addLabels({
            owner: repoOwner, repo: repoName, issue_number: prNumber,
            labels: [config.aiGeneratedLabel, config.lowQualityLabel],
          });
        } catch { /* non-fatal */ }
      }
      if (config.failOnLowQuality) {
        core.setFailed(`PR by @${prAuthor} rejected — contributor is on the blocklist.`);
      }
      return;
    }

    if (contributorCheck.status === "trusted") {
      core.info(`⭐ Trusted contributor: ${contributorCheck.reason} — running analysis with trusted flag.`);
    }

    if (config.llmProvider) {
      core.info(`LLM analysis enabled: ${config.llmProvider} / ${config.llmModel}`);
    } else {
      core.info("LLM analysis: disabled (no API key — using heuristics only)");
    }

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

    // --- Heuristic analysis (always runs) ---
    const fileAnalyses: FileAnalysis[] = [];

    for (const file of filesToAnalyze) {
      core.info(`  → Heuristic: ${file.filename}`);
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
      const { score, deductions } = scoreFile(file.filename, patch, aiSignals, aiConfidence);

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

    let heuristicScore = aggregateScore(fileAnalyses);
    let heuristicAiConfidence =
      fileAnalyses.length > 0
        ? Math.max(...fileAnalyses.map((f) => f.aiConfidence))
        : 0;

    // --- LLM analysis (optional) ---
    let llmAnalysis = null;
    let finalScore = heuristicScore;
    let finalAiConfidence = heuristicAiConfidence;

    if (config.llmProvider && config.llmApiKey) {
      const combinedDiff = buildCombinedDiff(
        filesToAnalyze.map((f) => ({
          filename: f.filename,
          patch: f.patch ?? "",
          linesAdded: fileAnalyses.find((a) => a.filename === f.filename)?.linesAdded ?? 0,
        }))
      );
      const languages = [...new Set(fileAnalyses.map((f) => f.language))].filter(
        (l) => l !== "Unknown"
      );

      llmAnalysis = await runLlmAnalysis(
        combinedDiff,
        languages,
        config.llmProvider,
        config.llmApiKey,
        config.llmModel
      );

      if (llmAnalysis) {
        const blended = blendScores(heuristicAiConfidence, heuristicScore, llmAnalysis);
        finalScore = blended.qualityScore;
        finalAiConfidence = blended.aiConfidence;
        core.info(`  Blended score: heuristic=${heuristicScore} + LLM=${llmAnalysis.quality_score} → ${finalScore}`);
        core.info(`  Blended AI confidence: ${Math.round(heuristicAiConfidence * 100)}% + ${Math.round(llmAnalysis.ai_probability * 100)}% → ${Math.round(finalAiConfidence * 100)}%`);
      }
    }

    const aiDetected = finalAiConfidence >= config.aiDetectionThreshold;
    const passed = finalScore >= config.minQualityScore;
    const summary = buildSummary(fileAnalyses, prFiles as PullRequestFile[], llmAnalysis);

    const result: AnalysisResult = {
      repoOwner,
      repoName,
      prNumber,
      prTitle,
      prAuthor,
      filesAnalyzed: fileAnalyses.length,
      totalFilesInPr: prFiles.length,
      qualityScore: finalScore,
      aiDetected,
      aiConfidence: finalAiConfidence,
      llmAnalysis,
      fileAnalyses,
      summary,
      passed,
      timestamp: new Date().toISOString(),
    };

    core.info(`\n📊 Analysis complete:`);
    core.info(`   Quality Score: ${finalScore}/100`);
    core.info(`   AI Detected: ${aiDetected} (${Math.round(finalAiConfidence * 100)}%)`);
    core.info(`   Passed: ${passed} (threshold: ${config.minQualityScore})`);

    core.setOutput("quality-score", String(finalScore));
    core.setOutput("ai-detected", String(aiDetected));
    core.setOutput("ai-confidence", String(finalAiConfidence.toFixed(3)));
    core.setOutput("files-analyzed", String(fileAnalyses.length));
    core.setOutput("passed", String(passed));

    if (config.commentOnPr) {
      await postOrUpdateComment(octokit, repoOwner, repoName, prNumber, result, config.minQualityScore);
    }

    if (config.labelPr) {
      await manageLabels(octokit, repoOwner, repoName, prNumber, result, config);
    }

    // --- Automated review (request changes / approve / close) ---
    const hasReviewAction =
      config.requestChangesOnLowQuality ||
      config.autoApproveOnPass ||
      config.autoCloseOnLowQuality;

    if (hasReviewAction) {
      try {
        await submitReview(octokit, result, {
          requestChangesOnLowQuality: config.requestChangesOnLowQuality,
          requestChangesThreshold: config.requestChangesThreshold,
          autoApproveOnPass: config.autoApproveOnPass,
          autoCloseOnLowQuality: config.autoCloseOnLowQuality,
          autoCloseThreshold: config.autoCloseThreshold,
          autoCloseComment: config.autoCloseComment,
        });
      } catch (e) {
        core.warning(
          `Automated review failed: ${(e as Error).message}. ` +
          `Make sure the workflow has "pull-requests: write" permission.`
        );
      }
    }

    // --- Score history tracking ---
    if (config.trackHistory) {
      try {
        await saveScoreHistory(octokit, result, config.historyBranch);
      } catch (e) {
        core.warning(
          `Could not save score history: ${(e as Error).message}. ` +
          `Make sure the workflow has "contents: write" permission and the branch "${config.historyBranch}" exists.`
        );
      }
    }

    // --- Workflow summary ---
    await writeWorkflowSummary(result, null).catch(() => {
      // Non-fatal
    });

    if (!passed && config.failOnLowQuality) {
      core.setFailed(
        `PR quality score ${finalScore}/100 is below the required threshold of ${config.minQualityScore}/100.`
      );
    } else if (!passed) {
      core.warning(
        `PR quality score ${finalScore}/100 is below the threshold of ${config.minQualityScore}/100.`
      );
    } else {
      core.info(`✅ PR passed quality check with score ${finalScore}/100.`);
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
  const openaiKey = core.getInput("openai-api-key") || null;
  const anthropicKey = core.getInput("anthropic-api-key") || null;

  let llmProvider: LlmProvider | null = null;
  let llmApiKey: string | null = null;
  let llmModel = "";

  if (openaiKey) {
    llmProvider = "openai";
    llmApiKey = openaiKey;
    llmModel = core.getInput("llm-model") || "gpt-4o-mini";
  } else if (anthropicKey) {
    llmProvider = "anthropic";
    llmApiKey = anthropicKey;
    llmModel = core.getInput("llm-model") || "claude-3-haiku-20240307";
  }

  const defaultBranch =
    github.context.payload.repository?.default_branch as string | undefined ?? "main";

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
    llmProvider,
    llmApiKey,
    llmModel,
    trackHistory: core.getInput("track-history") !== "false",
    historyBranch: core.getInput("history-branch") || defaultBranch,
    requestChangesOnLowQuality: core.getInput("request-changes-on-low-quality") === "true",
    requestChangesThreshold: parseInt(
      core.getInput("request-changes-threshold") ||
        core.getInput("min-quality-score") ||
        "50",
      10
    ),
    autoApproveOnPass: core.getInput("auto-approve-on-pass") === "true",
    autoCloseOnLowQuality: core.getInput("auto-close-on-low-quality") === "true",
    autoCloseThreshold: parseInt(core.getInput("auto-close-threshold") || "20", 10),
    autoCloseComment: core.getInput("auto-close-comment") || "",
    trustedContributors: core
      .getInput("trusted-contributors")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    blockedContributors: core
      .getInput("blocked-contributors")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trustBots: core.getInput("trust-bots") !== "false",
    trustedOrg: core.getInput("trusted-org") || null,
    blockedScoreCap: parseInt(core.getInput("blocked-score-cap") || "0", 10),
    skipAnalysisForTrusted: core.getInput("skip-analysis-for-trusted") !== "false",
  };
}

function isExcluded(filename: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern, { matchBase: true }));
}

function buildSummary(
  fileAnalyses: FileAnalysis[],
  allFiles: PullRequestFile[],
  llm: import("./types.js").LlmAnalysis | null
): AnalysisSummary {
  const totalLinesAdded = fileAnalyses.reduce((s, f) => s + f.linesAdded, 0);
  const totalLinesRemoved = fileAnalyses.reduce((s, f) => s + f.linesRemoved, 0);

  const signalCounts = new Map<string, number>();
  for (const f of fileAnalyses) {
    for (const s of f.aiSignals) {
      signalCounts.set(s.description, (signalCounts.get(s.description) ?? 0) + s.matches);
    }
  }
  const llmIndicators = llm?.ai_indicators ?? [];
  const topAiSignals = [
    ...llmIndicators,
    ...[...signalCounts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
  ].slice(0, 6);

  const deductionCounts = new Map<string, number>();
  for (const f of fileAnalyses) {
    for (const d of f.qualityDeductions) {
      deductionCounts.set(d.reason, (deductionCounts.get(d.reason) ?? 0) + d.points);
    }
  }
  const llmIssues = llm?.quality_issues ?? [];
  const topQualityIssues = [
    ...llmIssues,
    ...[...deductionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r),
  ].slice(0, 6);

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

  const hasDocumentation = allFiles.some((f) => /\.(md|rst|txt)$/.test(f.filename));

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
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    core.info("Updated existing quality report comment.");
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
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
      await octokit.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [label] });
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
        await octokit.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name: label });
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
      // Created concurrently — ignore
    }
  }
}

run();

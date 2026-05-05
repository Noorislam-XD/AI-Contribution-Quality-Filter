import * as core from "@actions/core";
import * as github from "@actions/github";
import type { AnalysisResult } from "./types.js";

const REVIEW_MARKER = "<!-- ai-quality-filter-review -->";

export async function submitReview(
  octokit: ReturnType<typeof github.getOctokit>,
  result: AnalysisResult,
  config: ReviewConfig
): Promise<void> {
  const { repoOwner: owner, repoName: repo, prNumber, qualityScore, aiDetected, aiConfidence, passed } = result;

  const shouldRequestChanges =
    config.requestChangesOnLowQuality &&
    qualityScore < config.requestChangesThreshold;

  const shouldAutoApprove =
    config.autoApproveOnPass &&
    passed &&
    !aiDetected;

  const shouldClose =
    config.autoCloseOnLowQuality &&
    qualityScore < config.autoCloseThreshold;

  // Remove any previous review from this action before posting a new one
  await dismissPreviousReview(octokit, owner, repo, prNumber);

  if (shouldRequestChanges) {
    const body = buildRequestChangesBody(result, config.requestChangesThreshold);
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: "REQUEST_CHANGES",
      body: REVIEW_MARKER + "\n" + body,
    });
    core.info(`🔴 Requested changes on PR #${prNumber} (score ${qualityScore} < threshold ${config.requestChangesThreshold})`);
  } else if (shouldAutoApprove) {
    const body = buildApproveBody(result);
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: "APPROVE",
      body: REVIEW_MARKER + "\n" + body,
    });
    core.info(`✅ Auto-approved PR #${prNumber} (score ${qualityScore}/100, no AI detected)`);
  } else {
    core.info(`ℹ️ No automated review submitted (score ${qualityScore}/100, passed=${passed}, ai=${aiDetected})`);
  }

  if (shouldClose) {
    await closePr(octokit, owner, repo, prNumber, result, config.autoCloseThreshold, config.autoCloseComment);
  }
}

async function dismissPreviousReview(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  try {
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    const botLogin = (await octokit.rest.users.getAuthenticated()).data.login;

    for (const review of reviews) {
      if (
        review.user?.login === botLogin &&
        review.body?.includes(REVIEW_MARKER) &&
        review.state === "CHANGES_REQUESTED"
      ) {
        try {
          await octokit.rest.pulls.dismissReview({
            owner,
            repo,
            pull_number: prNumber,
            review_id: review.id,
            message: "Dismissed by AI Contribution Quality Filter — re-analyzing updated PR.",
          });
          core.info(`Dismissed previous review #${review.id}`);
        } catch (e) {
          core.warning(`Could not dismiss previous review: ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    core.warning(`Could not list previous reviews: ${(e as Error).message}`);
  }
}

async function closePr(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  result: AnalysisResult,
  threshold: number,
  customComment: string
): Promise<void> {
  const comment = customComment || buildAutoCloseComment(result, threshold);

  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment,
    });

    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      state: "closed",
    });

    core.info(`🚫 Auto-closed PR #${prNumber} (score ${result.qualityScore} < auto-close threshold ${threshold})`);
  } catch (e) {
    core.warning(`Could not auto-close PR: ${(e as Error).message}`);
  }
}

function buildRequestChangesBody(result: AnalysisResult, threshold: number): string {
  const { qualityScore, aiDetected, aiConfidence, summary, llmAnalysis } = result;

  const scoreBar = buildBar(qualityScore);
  const topIssues = summary.topQualityIssues.slice(0, 4);
  const topSignals = summary.topAiSignals.slice(0, 3);
  const suggestions = llmAnalysis?.suggestions ?? [];

  const issuesBlock =
    topIssues.length > 0
      ? `**Issues found:**\n${topIssues.map((i) => `- ${i}`).join("\n")}`
      : "";

  const aiBlock = aiDetected
    ? `\n\n**AI code signals detected (${Math.round(aiConfidence * 100)}% confidence):**\n${topSignals.map((s) => `- ${s}`).join("\n")}`
    : "";

  const suggestionsBlock =
    suggestions.length > 0
      ? `\n\n**To resolve these issues:**\n${suggestions.map((s) => `- ${s}`).join("\n")}`
      : `\n\n**To resolve these issues:**\n- Review and refactor AI-generated sections with proper domain context\n- Add error handling around I/O operations and API calls\n- Write tests for new functionality\n- Use descriptive, meaningful names for variables and functions`;

  return `## 🔴 Changes Requested — Quality Score Below Threshold

This PR scored **${qualityScore}/100**, which is below the required minimum of **${threshold}/100**.

\`${scoreBar}\` **${qualityScore}/100**

${issuesBlock}${aiBlock}${suggestionsBlock}

Please address the issues above and push an update. The quality check will re-run automatically.

---
*Automated review by [AI Contribution Quality Filter](https://github.com/Noorislam-XD/AI-Contribution-Quality-Filter)*`;
}

function buildApproveBody(result: AnalysisResult): string {
  const { qualityScore, summary } = result;
  const scoreBar = buildBar(qualityScore);

  return `## ✅ Quality Check Passed

This PR scored **${qualityScore}/100** and no AI-generated code was detected.

\`${scoreBar}\` **${qualityScore}/100**

${summary.hasTests ? "✅ Tests detected" : ""}
${summary.languagesDetected.length > 0 ? `📝 Languages: ${summary.languagesDetected.join(", ")}` : ""}

---
*Automated review by [AI Contribution Quality Filter](https://github.com/Noorislam-XD/AI-Contribution-Quality-Filter)*`;
}

function buildAutoCloseComment(result: AnalysisResult, threshold: number): string {
  const { qualityScore, aiDetected, aiConfidence, prAuthor } = result;

  return `## 🚫 Pull Request Closed — Quality Too Low

Hi @${prAuthor}, this PR has been automatically closed because the quality score (**${qualityScore}/100**) is below the auto-close threshold of **${threshold}/100**.

${aiDetected ? `AI-generated code was detected with **${Math.round(aiConfidence * 100)}% confidence**. ` : ""}This repository requires genuine, well-written contributions.

**To re-open this PR:**
1. Review the full quality report in the comment above
2. Significantly improve the code quality — refactor, add tests, fix naming, add error handling
3. Open a new PR with the improved changes

---
*Automated by [AI Contribution Quality Filter](https://github.com/Noorislam-XD/AI-Contribution-Quality-Filter)*`;
}

function buildBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}

export interface ReviewConfig {
  requestChangesOnLowQuality: boolean;
  requestChangesThreshold: number;
  autoApproveOnPass: boolean;
  autoCloseOnLowQuality: boolean;
  autoCloseThreshold: number;
  autoCloseComment: string;
}

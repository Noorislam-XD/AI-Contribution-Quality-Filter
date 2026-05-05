import * as core from "@actions/core";
import * as github from "@actions/github";

// Well-known GitHub automation bots that should always be trusted
const GITHUB_BOTS = new Set([
  "dependabot[bot]",
  "dependabot-preview[bot]",
  "renovate[bot]",
  "github-actions[bot]",
  "snyk-bot",
  "greenkeeper[bot]",
  "renovate-approve",
  "allcontributors[bot]",
  "imgbot[bot]",
  "pre-commit-ci[bot]",
  "semantic-release-bot",
  "mergify[bot]",
  "stale[bot]",
  "netlify[bot]",
  "vercel[bot]",
  "codecov[bot]",
  "sonarcloud[bot]",
]);

export type ContributorStatus = "trusted" | "blocked" | "normal";

export interface ContributorCheck {
  status: ContributorStatus;
  reason: string;
}

export async function checkContributor(
  author: string,
  octokit: ReturnType<typeof github.getOctokit>,
  config: AllowlistConfig
): Promise<ContributorCheck> {
  // 1. Check explicit blocklist first (highest priority)
  if (matchesPatternList(author, config.blockedContributors)) {
    return {
      status: "blocked",
      reason: `@${author} is on the contributor blocklist`,
    };
  }

  // 2. Check explicit trusted list
  if (matchesPatternList(author, config.trustedContributors)) {
    return {
      status: "trusted",
      reason: `@${author} is on the trusted contributors list`,
    };
  }

  // 3. Check built-in GitHub bots
  if (config.trustBots && isBot(author)) {
    return {
      status: "trusted",
      reason: `@${author} is a trusted GitHub automation bot`,
    };
  }

  // 4. Check org membership (optional — requires read:org scope)
  if (config.trustedOrg) {
    const isMember = await checkOrgMembership(octokit, author, config.trustedOrg);
    if (isMember) {
      return {
        status: "trusted",
        reason: `@${author} is a member of the trusted organization @${config.trustedOrg}`,
      };
    }
  }

  return { status: "normal", reason: "" };
}

function matchesPatternList(username: string, patterns: string[]): boolean {
  const lowerUser = username.toLowerCase();
  for (const pattern of patterns) {
    const lower = pattern.trim().toLowerCase();
    if (!lower) continue;
    // Wildcard suffix: "myorg-*" matches "myorg-bot", "myorg-ci", etc.
    if (lower.endsWith("*")) {
      const prefix = lower.slice(0, -1);
      if (lowerUser.startsWith(prefix)) return true;
    } else {
      if (lowerUser === lower) return true;
    }
  }
  return false;
}

function isBot(username: string): boolean {
  return GITHUB_BOTS.has(username) || username.endsWith("[bot]");
}

async function checkOrgMembership(
  octokit: ReturnType<typeof github.getOctokit>,
  username: string,
  org: string
): Promise<boolean> {
  try {
    const { status } = await octokit.rest.orgs.checkMembershipForUser({
      org,
      username,
    });
    return status === 204;
  } catch {
    // 302 = not a member, 404 = not found — either way not a member
    return false;
  }
}

export function buildTrustedComment(author: string, reason: string): string {
  return `## ✅ Trusted Contributor — Quality Check Skipped

@${author} is recognized as a trusted contributor (${reason.replace(`@${author} is `, "")}).

The detailed AI detection and quality scoring analysis has been skipped for this PR.

---
*Automated by [AI Contribution Quality Filter](https://github.com/Noorislam-XD/AI-Contribution-Quality-Filter)*`;
}

export function buildBlockedComment(
  author: string,
  reason: string,
  qualityScore: number,
  isAnalysisSkipped: boolean
): string {
  const analysisNote = isAnalysisSkipped
    ? "This PR has been automatically failed without detailed analysis."
    : `The PR was analyzed and scored **${qualityScore}/100**, but the blocklist override applies.`;

  return `## 🚫 Blocked Contributor

@${author} is on this repository's contributor blocklist.

${analysisNote}

If you believe this is a mistake, please contact the repository maintainers directly.

---
*Automated by [AI Contribution Quality Filter](https://github.com/Noorislam-XD/AI-Contribution-Quality-Filter)*`;
}

export interface AllowlistConfig {
  trustedContributors: string[];
  blockedContributors: string[];
  trustBots: boolean;
  trustedOrg: string | null;
  blockedScoreCap: number;
  skipAnalysisForTrusted: boolean;
}

export function parseAllowlistConfig(): AllowlistConfig {
  const trustedContributors = core
    .getInput("trusted-contributors")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const blockedContributors = core
    .getInput("blocked-contributors")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const trustedOrg = core.getInput("trusted-org") || null;
  const trustBots = core.getInput("trust-bots") !== "false";
  const blockedScoreCap = parseInt(core.getInput("blocked-score-cap") || "0", 10);
  const skipAnalysisForTrusted = core.getInput("skip-analysis-for-trusted") !== "false";

  return {
    trustedContributors,
    blockedContributors,
    trustBots,
    trustedOrg,
    blockedScoreCap,
    skipAnalysisForTrusted,
  };
}

import type {
  FileAnalysis,
  QualityDeduction,
  AiSignal,
} from "./types.js";

const SKIPPED_EXTENSIONS = new Set([
  "lock", "min.js", "min.css", "map", "snap", "svg",
  "png", "jpg", "jpeg", "gif", "ico", "woff", "woff2",
  "ttf", "eot", "pdf", "zip", "tar", "gz",
]);

export function isAnalyzableFile(filename: string): boolean {
  const parts = filename.split(".");
  if (parts.length < 2) return true;
  const ext = parts[parts.length - 1].toLowerCase();
  if (SKIPPED_EXTENSIONS.has(ext)) return false;
  if (filename.endsWith(".min.js") || filename.endsWith(".min.css")) return false;
  return true;
}

export function scoreFile(
  filename: string,
  patch: string,
  aiSignals: AiSignal[],
  aiConfidence: number
): { score: number; deductions: QualityDeduction[] } {
  let score = 100;
  const deductions: QualityDeduction[] = [];

  const addedLines = patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removedLines = patch
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const addedCode = addedLines.map((l) => l.slice(1)).join("\n");

  if (addedLines.length > 500) {
    const penalty = Math.min(Math.floor((addedLines.length - 500) / 100) * 3, 15);
    deductions.push({
      reason: `Very large file change (${addedLines.length} lines added)`,
      points: penalty,
      category: "code_size",
    });
    score -= penalty;
  }

  if (aiConfidence > 0.4) {
    const penalty = Math.round(aiConfidence * 30);
    deductions.push({
      reason: `AI-generated code detected (${Math.round(aiConfidence * 100)}% confidence)`,
      points: penalty,
      category: "ai_detection",
    });
    score -= penalty;
  }

  const hasErrorHandling =
    /try\s*\{/.test(addedCode) ||
    /catch\s*\(/.test(addedCode) ||
    /\.catch\(/.test(addedCode) ||
    /except\s+/.test(addedCode) ||
    /rescue\s+/.test(addedCode) ||
    /Result</.test(addedCode) ||
    /if\s+err\s*!=\s*nil/.test(addedCode);

  const hasCodeLogic =
    addedLines.length > 20 &&
    (/function\s+\w+/.test(addedCode) ||
      /class\s+\w+/.test(addedCode) ||
      /def\s+\w+/.test(addedCode) ||
      /fn\s+\w+/.test(addedCode));

  if (hasCodeLogic && !hasErrorHandling && addedLines.length > 30) {
    deductions.push({
      reason: "No error handling found in significant code changes",
      points: 8,
      category: "error_handling",
    });
    score -= 8;
  }

  const testPatterns = [
    /\b(it|test|describe|expect|assert|should)\b/,
    /import.*\b(jest|vitest|mocha|chai|pytest|rspec)\b/i,
    /(\.spec\.|\.test\.|_test\.|_spec\.)/,
    /def test_/,
    /#\[test\]/,
    /@Test/,
  ];
  const isTestFile = testPatterns.some(
    (p) => p.test(filename) || p.test(addedCode)
  );

  const duplicateScore = detectDuplication(addedLines);
  if (duplicateScore > 0.3 && addedLines.length > 20) {
    const penalty = Math.min(Math.round(duplicateScore * 20), 15);
    deductions.push({
      reason: `Code duplication detected (${Math.round(duplicateScore * 100)}% duplicate blocks)`,
      points: penalty,
      category: "code_duplication",
    });
    score -= penalty;
  }

  const namingIssues = countNamingIssues(addedCode);
  if (namingIssues > 5) {
    const penalty = Math.min(Math.floor(namingIssues / 3) * 2, 10);
    deductions.push({
      reason: `Poor naming conventions (${namingIssues} single-letter or overly abbreviated identifiers)`,
      points: penalty,
      category: "naming",
    });
    score -= penalty;
  }

  const complexityScore = estimateComplexity(addedCode);
  if (complexityScore > 10) {
    const penalty = Math.min(Math.floor((complexityScore - 10) / 5) * 3, 10);
    deductions.push({
      reason: `High cyclomatic complexity estimate (~${complexityScore} branches)`,
      points: penalty,
      category: "complexity",
    });
    score -= penalty;
  }

  return {
    score: Math.max(score, 0),
    deductions,
  };
}

function detectDuplication(lines: string[]): number {
  const nonEmptyLines = lines
    .map((l) => l.replace(/^[+-]/, "").trim())
    .filter((l) => l.length > 5);

  if (nonEmptyLines.length < 10) return 0;

  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of nonEmptyLines) {
    if (seen.has(line)) {
      duplicates++;
    } else {
      seen.add(line);
    }
  }
  return duplicates / nonEmptyLines.length;
}

function countNamingIssues(code: string): number {
  const singleLetterVars = code.match(/\b(?:var|let|const|int|string|bool)\s+([a-z])\b/g) ?? [];
  const abbreviatedNames = code.match(/\b[a-z]{1,2}[A-Z][a-z]/g) ?? [];
  return singleLetterVars.length + abbreviatedNames.length;
}

function estimateComplexity(code: string): number {
  const branchKeywords = [
    /\bif\b/g,
    /\belse if\b/g,
    /\belif\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bswitch\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\b\?\s*:/g,
    /&&|\|\|/g,
  ];

  let complexity = 1;
  for (const pattern of branchKeywords) {
    const matches = code.match(pattern);
    if (matches) complexity += matches.length;
  }
  return complexity;
}

export function aggregateScore(fileAnalyses: FileAnalysis[]): number {
  if (fileAnalyses.length === 0) return 100;

  const totalWeight = fileAnalyses.reduce(
    (sum, f) => sum + Math.max(f.linesAdded, 1),
    0
  );

  const weightedScore = fileAnalyses.reduce((sum, f) => {
    const weight = Math.max(f.linesAdded, 1) / totalWeight;
    return sum + f.qualityScore * weight;
  }, 0);

  return Math.round(weightedScore);
}

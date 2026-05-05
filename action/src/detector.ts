import type { AiSignal, AiSignalType } from "./types.js";

const AI_COMMENT_PHRASES = [
  /\/\/\s*this (function|method|class|component|module|file)/i,
  /\/\/\s*this (returns|takes|accepts|provides|handles|performs)/i,
  /\/\/\s*(note that|note:|important:|remember that)/i,
  /\/\/\s*the (above|following|below) (code|function|method|snippet)/i,
  /\/\*\*?\s*\n?\s*\*?\s*this (function|method|class)/i,
  /\/\/\s*example (usage|use|of)/i,
  /\/\/\s*initialize (the|a|an)/i,
  /\/\/\s*create (a|an|the) new/i,
  /\/\/\s*check if/i,
  /\/\/\s*handle (the|any|all|error)/i,
  /\/\/\s*return (the|a|an)/i,
  /\/\/\s*set (the|a|an)/i,
  /\/\/\s*(first|then|finally|next|after that|lastly),?\s/i,
  /#\s*this (function|method|class|module)/i,
  /#\s*(note:|note that|important:)/i,
];

const GENERIC_NAMING_PATTERNS = [
  /\b(result|results|response|data|item|items|element|elements|obj|object|temp|tmp|val|value|flag)\b/g,
  /\b(myFunction|myMethod|myClass|myVariable|myObject|myArray|myList)\b/g,
  /\b(foo|bar|baz|qux|lorem|ipsum|test123|example)\b/g,
  /\b(handleClick|handleChange|handleSubmit|handleEvent|handleInput)\b/gi,
];

const BOILERPLATE_PATTERNS = [
  /console\.log\(["'`]Hello,?\s*(World|world)!?["'`]\)/,
  /function\s+\w+\s*\(\s*\)\s*\{\s*\/\/\s*TODO/i,
  /\/\/\s*TODO:\s*implement/i,
  /\/\/\s*TODO:\s*add (your|the) (logic|code|implementation) here/i,
  /placeholder (text|content|data)/i,
  /lorem ipsum/i,
  /your (code|logic|implementation) here/i,
  /\/\*\s*\n?\s*\*\s*@param\s*\{\w+\}\s*\w+\s*-\s*The\s+\w+\s*\n/i,
];

const EXCESSIVE_DOCSTRING_PATTERNS = [
  /@param\s*\{[^}]+\}\s*\w+\s*-\s*(The|A|An)\s+\w+\s+(parameter|argument|value)/i,
  /@returns\s*\{[^}]+\}\s*(The|A|An)\s+\w+/i,
  /\/\*\*[\s\S]{0,500}?@param[\s\S]{0,200}?@returns[\s\S]{0,100}?\*\//,
];

const PERFECT_STRUCTURE_PATTERNS = [
  /^(\s{2}|\s{4}|\t)+/gm,
];

export function detectAiSignals(
  code: string,
  filename: string
): AiSignal[] {
  const signals: AiSignal[] = [];
  const lines = code.split("\n");
  const totalLines = lines.length;
  if (totalLines === 0) return signals;

  const commentLines = lines.filter((l) =>
    l.trim().startsWith("//") ||
    l.trim().startsWith("#") ||
    l.trim().startsWith("*") ||
    l.trim().startsWith("/*") ||
    l.trim().startsWith("*/")
  ).length;
  const commentRatio = commentLines / totalLines;

  if (commentRatio > 0.35 && totalLines > 10) {
    signals.push({
      type: "verbose_comments",
      description: `High comment density (${Math.round(commentRatio * 100)}% of lines are comments)`,
      weight: 0.25,
      matches: commentLines,
    });
  }

  let aiPhraseMatches = 0;
  for (const pattern of AI_COMMENT_PHRASES) {
    const matches = code.match(pattern);
    if (matches) aiPhraseMatches += matches.length;
  }
  if (aiPhraseMatches > 0) {
    signals.push({
      type: "ai_comment_phrases",
      description: `Found ${aiPhraseMatches} AI-typical comment phrase(s) (e.g. "This function...", "Note that...")`,
      weight: 0.3,
      matches: aiPhraseMatches,
    });
  }

  let genericMatches = 0;
  for (const pattern of GENERIC_NAMING_PATTERNS) {
    const matches = code.match(pattern);
    if (matches) genericMatches += matches.length;
  }
  const genericDensity = genericMatches / Math.max(totalLines, 1);
  if (genericDensity > 0.5) {
    signals.push({
      type: "generic_naming",
      description: `High density of generic identifiers (result, data, item, response...) — ${genericMatches} occurrences`,
      weight: 0.2,
      matches: genericMatches,
    });
  }

  let boilerplateMatches = 0;
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(code)) boilerplateMatches++;
  }
  if (boilerplateMatches > 0) {
    signals.push({
      type: "boilerplate_patterns",
      description: `Found ${boilerplateMatches} boilerplate pattern(s) (TODO placeholders, Hello World, lorem ipsum...)`,
      weight: 0.25,
      matches: boilerplateMatches,
    });
  }

  let docstringMatches = 0;
  for (const pattern of EXCESSIVE_DOCSTRING_PATTERNS) {
    if (pattern.test(code)) docstringMatches++;
  }
  if (docstringMatches > 0) {
    signals.push({
      type: "excessive_docstrings",
      description: `Overly verbose docstrings matching AI generation patterns`,
      weight: 0.15,
      matches: docstringMatches,
    });
  }

  const repetitionScore = detectRepetitivePatterns(lines);
  if (repetitionScore > 3) {
    signals.push({
      type: "repetitive_patterns",
      description: `Repetitive code blocks detected (${repetitionScore} similar structures)`,
      weight: 0.15,
      matches: repetitionScore,
    });
  }

  return signals;
}

function detectRepetitivePatterns(lines: string[]): number {
  const blockSignatures = new Map<string, number>();
  const blockSize = 4;

  for (let i = 0; i <= lines.length - blockSize; i++) {
    const block = lines
      .slice(i, i + blockSize)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("|");
    if (block.length > 20) {
      blockSignatures.set(block, (blockSignatures.get(block) ?? 0) + 1);
    }
  }

  let repetitions = 0;
  for (const count of blockSignatures.values()) {
    if (count > 1) repetitions += count - 1;
  }
  return repetitions;
}

export function calculateAiConfidence(signals: AiSignal[]): number {
  if (signals.length === 0) return 0;

  let confidence = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const matchFactor = Math.min(signal.matches / 5, 1);
    confidence += signal.weight * matchFactor;
    totalWeight += signal.weight;
  }

  const normalizedConfidence = totalWeight > 0 ? confidence / totalWeight : 0;
  const signalCountBoost = Math.min(signals.length * 0.05, 0.2);

  return Math.min(normalizedConfidence + signalCountBoost, 1);
}

export function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const languageMap: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript/React",
    js: "JavaScript",
    jsx: "JavaScript/React",
    py: "Python",
    rb: "Ruby",
    go: "Go",
    rs: "Rust",
    java: "Java",
    cs: "C#",
    cpp: "C++",
    c: "C",
    php: "PHP",
    swift: "Swift",
    kt: "Kotlin",
    sh: "Shell",
    bash: "Bash",
    yml: "YAML",
    yaml: "YAML",
    json: "JSON",
    md: "Markdown",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    sql: "SQL",
    vue: "Vue",
    svelte: "Svelte",
  };
  return languageMap[ext] ?? (ext.toUpperCase() || "Unknown");
}

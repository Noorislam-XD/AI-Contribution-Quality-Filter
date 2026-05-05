import * as core from "@actions/core";
import type { LlmAnalysis, LlmProvider } from "./types.js";

const MAX_DIFF_CHARS = 12000;
const MAX_FILES_FOR_LLM = 8;

const SYSTEM_PROMPT = `You are an expert code reviewer specializing in detecting AI-generated code and assessing code quality in pull requests.

Your job is to analyze a code diff and return a structured JSON assessment. Be honest, specific, and actionable.

AI-generated code typically has these characteristics:
- Generic, non-descriptive variable names (result, data, item, response, element)
- Comments that explain obvious things ("This function returns...", "Initialize the variable")
- Perfect boilerplate structure with no personal style
- Overly verbose JSDoc/docstrings auto-generated for every parameter
- Placeholder TODO comments with generic descriptions
- Repeated structural patterns copy-pasted across functions
- No contextual understanding of the surrounding codebase
- Hallmark phrases like "Note that", "It's important to", "This ensures that"
- Functions that do one generic thing with a name like handleX, processY, manageZ

Quality issues to look for:
- Missing error handling around I/O, API calls, parsing
- Code duplication that should be extracted into helpers
- Poor or misleading naming
- Overly complex functions (too many branches / responsibilities)
- Missing input validation
- Security antipatterns (eval, innerHTML, SQL concatenation, exposed secrets)
- Performance issues (unnecessary loops, missing memoization, redundant fetches)

IMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;

const USER_PROMPT_TEMPLATE = (diff: string, languages: string) => `Analyze this pull request diff and return your assessment as JSON.

Languages detected: ${languages}

Diff:
\`\`\`diff
${diff}
\`\`\`

Return this exact JSON structure:
{
  "ai_probability": <float 0.0-1.0, how likely this is AI-generated>,
  "quality_score": <integer 0-100, overall code quality>,
  "ai_indicators": [<up to 5 specific strings describing AI patterns found, empty array if none>],
  "quality_issues": [<up to 6 specific strings describing quality problems found, empty array if none>],
  "suggestions": [<up to 4 actionable improvement suggestions>],
  "reasoning": "<2-3 sentence overall assessment of this contribution>"
}`;

export async function runLlmAnalysis(
  diffContent: string,
  languages: string[],
  provider: LlmProvider,
  apiKey: string,
  model: string
): Promise<LlmAnalysis | null> {
  const truncatedDiff = diffContent.slice(0, MAX_DIFF_CHARS);
  const langStr = languages.join(", ") || "Unknown";

  try {
    core.info(`  🤖 Running LLM analysis via ${provider} (${model})...`);

    let raw: string;
    if (provider === "openai") {
      raw = await callOpenAi(truncatedDiff, langStr, apiKey, model);
    } else {
      raw = await callAnthropic(truncatedDiff, langStr, apiKey, model);
    }

    const parsed = parseJsonResponse(raw);
    if (!parsed) {
      core.warning(`LLM returned invalid JSON — falling back to heuristics only.`);
      return null;
    }

    core.info(`  ✅ LLM analysis complete. AI probability: ${Math.round(parsed.ai_probability * 100)}%, Quality: ${parsed.quality_score}/100`);
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`LLM analysis failed (${msg}) — falling back to heuristics only.`);
    return null;
  }
}

async function callOpenAi(
  diff: string,
  languages: string,
  apiKey: string,
  model: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT_TEMPLATE(diff, languages) },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? "";
}

async function callAnthropic(
  diff: string,
  languages: string,
  apiKey: string,
  model: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: USER_PROMPT_TEMPLATE(diff, languages) },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return json.content[0]?.text ?? "";
}

function parseJsonResponse(raw: string): LlmAnalysis | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");

    const obj = JSON.parse(cleaned) as Record<string, unknown>;

    const ai_probability = clamp(Number(obj["ai_probability"] ?? 0), 0, 1);
    const quality_score = clamp(Math.round(Number(obj["quality_score"] ?? 70)), 0, 100);
    const ai_indicators = toStringArray(obj["ai_indicators"]);
    const quality_issues = toStringArray(obj["quality_issues"]);
    const suggestions = toStringArray(obj["suggestions"]);
    const reasoning = typeof obj["reasoning"] === "string" ? obj["reasoning"] : "";

    return { ai_probability, quality_score, ai_indicators, quality_issues, suggestions, reasoning };
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 8);
}

export function buildCombinedDiff(
  files: Array<{ filename: string; patch: string; linesAdded: number }>
): string {
  const sorted = [...files]
    .sort((a, b) => b.linesAdded - a.linesAdded)
    .slice(0, MAX_FILES_FOR_LLM);

  const parts: string[] = [];
  let totalChars = 0;

  for (const file of sorted) {
    const header = `\n--- ${file.filename}\n`;
    const chunk = header + file.patch;
    if (totalChars + chunk.length > MAX_DIFF_CHARS) {
      const remaining = MAX_DIFF_CHARS - totalChars;
      if (remaining > 200) {
        parts.push(chunk.slice(0, remaining) + "\n... [truncated]");
      }
      break;
    }
    parts.push(chunk);
    totalChars += chunk.length;
  }

  return parts.join("\n");
}

export function blendScores(
  heuristicAiConfidence: number,
  heuristicQualityScore: number,
  llm: LlmAnalysis
): { aiConfidence: number; qualityScore: number } {
  const aiConfidence = heuristicAiConfidence * 0.35 + llm.ai_probability * 0.65;
  const qualityScore = Math.round(heuristicQualityScore * 0.45 + llm.quality_score * 0.55);
  return {
    aiConfidence: Math.min(aiConfidence, 1),
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
  };
}

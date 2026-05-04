/**
 * Robust AI Response Parser
 *
 * Handles extraction of JSON from AI responses that may include:
 * - Pure JSON strings
 * - JSON wrapped in markdown code blocks (```json ... ```)
 * - Multiple JSON code blocks (returns first valid one)
 * - JSON with trailing/leading whitespace
 * - JSON with BOM characters
 * - Partial or malformed JSON (best-effort recovery)
 *
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import { JSOX } from "jsox";

export type ParseResult<T = unknown> = {
    ok: boolean;
    data?: T;
    raw?: string;
    error?: string;
    source?: "direct" | "markdown_block" | "recovered" | "fallback";
};

/**
 * Regex patterns for extracting JSON from various formats.
 * Ordered by specificity - most specific patterns first.
 */
const JSON_EXTRACTION_PATTERNS = [
    // ```json ... ``` or ```JSON ... ``` (case insensitive)
    /```json\s*\n?([\s\S]*?)\n?```/i,
    // ```toon ... ``` (custom format used in project)
    /```toon\s*\n?([\s\S]*?)\n?```/i,
    // Generic code block ``` ... ```
    /```\s*\n?([\s\S]*?)\n?```/,
    // JSON in curly braces (object)
    /(\{[\s\S]*\})/,
    // JSON array
    /(\[[\s\S]*\])/,
] as const;

/**
 * Clean raw text from common issues before parsing.
 */
const cleanRawText = (text: string): string => {
    if (!text || typeof text !== "string") return "";

    return text
        // Remove BOM
        .replace(/^\uFEFF/, "")
        // Remove zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        // Normalize line endings
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Trim whitespace
        .trim();
};

/**
 * Attempt to fix common JSON issues.
 */
const attemptJSONRecovery = (text: string): string => {
    let cleaned = text;

    // Remove trailing commas before ] or }
    cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");

    // Fix unescaped newlines in strings (very basic)
    // This is a simple heuristic - won't catch all cases
    cleaned = cleaned.replace(/:\s*"([^"]*)\n([^"]*)"/g, (match, p1, p2) => {
        return `: "${p1}\\n${p2}"`;
    });

    // Remove control characters except newlines and tabs
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    return cleaned;
};

/**
 * Try to parse JSON using multiple strategies.
 */
export const tryParseJSON = <T = unknown>(text: string): { ok: boolean; data?: T; error?: string } => {
    if (!text) return { ok: false, error: "Empty input" };

    // Strategy 1: Direct JSOX parse (more lenient than JSON.parse)
    try {
        const data = JSOX.parse(text) as T;
        return { ok: true, data };
    } catch { /* continue */ }

    // Strategy 2: Standard JSON.parse
    try {
        const data = JSON.parse(text) as T;
        return { ok: true, data };
    } catch { /* continue */ }

    // Strategy 3: Try with recovery
    try {
        const recovered = attemptJSONRecovery(text);
        const data = JSOX.parse(recovered) as T;
        return { ok: true, data };
    } catch { /* continue */ }

    // Strategy 4: Try removing any leading/trailing non-JSON characters
    try {
        const match = text.match(/^[^{[]*([{\[][\s\S]*[}\]])[^}\]]*$/);
        if (match?.[1]) {
            const data = JSOX.parse(match[1]) as T;
            return { ok: true, data };
        }
    } catch { /* continue */ }

    return { ok: false, error: "Failed to parse JSON with all strategies" };
};

/**
 * Extract JSON from AI response text.
 * Handles markdown code blocks, raw JSON, and various edge cases.
 *
 * @param response - Raw AI response string
 * @returns ParseResult with extracted data or error
 */
export const extractJSONFromAIResponse = <T = unknown>(response: string | null | undefined): ParseResult<T> => {
    if (response == null) {
        return { ok: false, error: "Response is null or undefined" };
    }

    if (typeof response !== "string") {
        // If already an object, return as-is
        if (typeof response === "object") {
            return { ok: true, data: response as T, source: "direct" };
        }
        return { ok: false, error: `Expected string, got ${typeof response}` };
    }

    const cleaned = cleanRawText(response);
    if (!cleaned) {
        return { ok: false, error: "Response is empty after cleaning", raw: response };
    }

    // First, try direct parsing (fastest path)
    const directResult = tryParseJSON<T>(cleaned);
    if (directResult.ok) {
        return { ok: true, data: directResult.data, raw: response, source: "direct" };
    }

    // Try extracting from markdown code blocks
    for (const pattern of JSON_EXTRACTION_PATTERNS) {
        const match = cleaned.match(pattern);
        if (match?.[1]) {
            const extracted = cleanRawText(match[1]);
            const result = tryParseJSON<T>(extracted);
            if (result.ok) {
                return {
                    ok: true,
                    data: result.data,
                    raw: response,
                    source: "markdown_block"
                };
            }
        }
    }

    // Try to find any JSON-like structure and parse it
    const jsonLikeMatch = cleaned.match(/(\{[\s\S]+\}|\[[\s\S]+\])/);
    if (jsonLikeMatch?.[1]) {
        const recovered = attemptJSONRecovery(jsonLikeMatch[1]);
        const result = tryParseJSON<T>(recovered);
        if (result.ok) {
            return {
                ok: true,
                data: result.data,
                raw: response,
                source: "recovered"
            };
        }
    }

    // Last resort: return as text in a structured format
    return {
        ok: false,
        error: "Could not extract valid JSON from response",
        raw: response
    };
};

/**
 * Parse AI response with guaranteed JSON output.
 * Falls back to a wrapper object if parsing fails.
 *
 * @param response - Raw AI response
 * @param fallbackKey - Key to use for wrapping raw text (default: "data")
 */
export const parseAIResponseSafe = <T = unknown>(
    response: string | null | undefined,
    fallbackKey: string = "data"
): { ok: boolean; data: T | { [key: string]: string }; raw?: any; source: ParseResult["source"]; wasRecovered: boolean; error?: string } => {
    const result = extractJSONFromAIResponse<T>(response) as { ok: boolean; data?: T; error?: string; source: ParseResult["source"]; raw?: any };

    if (result.ok && result.data !== undefined) {
        return {
            raw: result.raw || response,
            ok: true,
            data: result.data,
            source: result.source,
            wasRecovered: result.source === "recovered",
            error: result.error || undefined
        };
    }

    // Return fallback wrapper
    return {
        raw: result.raw || response,
        ok: false,
        data: { [fallbackKey]: result.raw || String(response) } as { [key: string]: string },
        source: "fallback",
        wasRecovered: false,
        error: result.error || undefined
    };
};

/**
 * Extract all JSON blocks from a response (for responses with multiple JSON objects).
 */
export const extractAllJSONBlocks = <T = unknown>(response: string): ParseResult<T>[] => {
    if (!response || typeof response !== "string") return [];

    const results: ParseResult<T>[] = [];
    const cleaned = cleanRawText(response);

    // Find all markdown code blocks
    const blockPattern = /```(?:json|toon)?\s*\n?([\s\S]*?)\n?```/gi;
    let match: RegExpExecArray | null;

    while ((match = blockPattern.exec(cleaned)) !== null) {
        if (match[1]) {
            const extracted = cleanRawText(match[1]);
            const result = tryParseJSON<T>(extracted);
            if (result.ok) {
                results.push({
                    ok: true,
                    data: result.data,
                    raw: match[0],
                    source: "markdown_block"
                });
            }
        }
    }

    // If no markdown blocks found, try direct parse
    if (results.length === 0) {
        const directResult = extractJSONFromAIResponse<T>(response);
        if (directResult.ok) {
            results.push(directResult);
        }
    }

    return results;
};

/**
 * Strict JSON instructions to include in AI prompts.
 * Following OpenAI Responses API best practices.
 *
 * @see https://platform.openai.com/docs/api-reference/responses
 */
export const STRICT_JSON_INSTRUCTIONS = `
CRITICAL OUTPUT FORMAT REQUIREMENTS:

1. Your response MUST be ONLY valid JSON - no markdown, no explanations, no prose.
2. Do NOT wrap the JSON in code blocks (\`\`\`json or \`\`\`).
3. Do NOT include any text before or after the JSON object.
4. The response must start with { or [ and end with } or ].
5. All strings must be properly escaped (newlines as \\n, quotes as \\").
6. Use null for missing/unknown values, not undefined or empty strings.
7. Numbers should be unquoted. Booleans should be true/false (lowercase).
8. Arrays should not have trailing commas.
9. The JSON must be parseable by JSON.parse() without modification.

If you cannot provide the requested data, return: {"error": "description of the issue", "ok": false}
`;

/**
 * Shorter version of JSON instructions for context-limited prompts.
 */
export const COMPACT_JSON_INSTRUCTIONS = `OUTPUT ONLY: Valid JSON. No markdown, no code blocks, no explanations. Start with { or [, end with } or ]. All strings escaped. Must pass JSON.parse().`;

/**
 * Build a complete prompt that enforces JSON output.
 */
export const buildJSONEnforcedPrompt = (
    basePrompt: string,
    outputSchema?: string
): string => {
    const schemaHint = outputSchema
        ? `\n\nExpected output schema:\n${outputSchema}`
        : "";

    return `${basePrompt}${schemaHint}\n\n${STRICT_JSON_INSTRUCTIONS}`;
};


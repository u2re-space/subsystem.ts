/*
 * Filename: process-api-result.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-api-result.ts
 * FIND:process
 *
 * Leaf: pull display text from Process / OpenAI / share-target payloads.
 * WHY: SW, Vite, and the page must share one extractor — no native aliases.
 */

const asTrimmed = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

const fromChoices = (value: unknown): string => {
    if (!Array.isArray(value) || !value.length) return "";
    const first = value[0] as { message?: { content?: unknown }; text?: unknown };
    return asTrimmed(first?.message?.content) || asTrimmed(first?.text);
};

const fromRecognized = (value: unknown): string => {
    const text = asTrimmed(value);
    if (text) return text;
    if (!Array.isArray(value) || !value.length) return "";
    return value
        .map((item) => (typeof item === "string" ? item : item == null ? "" : JSON.stringify(item)))
        .filter(Boolean)
        .join("\n")
        .trim();
};

const fromRecord = (row: Record<string, unknown>): string => {
    if (row.ok === false || row.success === false) return "";
    const inner = row.result && typeof row.result === "object"
        ? (row.result as Record<string, unknown>)
        : null;
    const candidates = [
        row.data,
        inner?.data,
        inner?.text,
        inner?.content,
        row.text,
        row.content,
        row.verbose_data,
        inner?.verbose_data,
        row.output_text,
        inner?.output_text
    ];
    for (const item of candidates) {
        const text = asTrimmed(item);
        if (text) return text;
    }
    const recognized = fromRecognized(row.recognized_data ?? inner?.recognized_data);
    if (recognized) return recognized;
    const choices = fromChoices(row.choices ?? inner?.choices);
    if (choices) return choices;
    if (typeof inner?.result === "string") return inner.result.trim();
    return "";
};

/** Display text for chat / pipeline. Empty when the payload is a failed envelope. */
export const readProcessApiResultText = (json: unknown): string => {
    if (json == null) return "";
    if (typeof json === "string") {
        const trimmed = json.trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                return readProcessApiResultText(JSON.parse(trimmed)) || trimmed;
            } catch {
                return trimmed;
            }
        }
        return trimmed;
    }
    if (typeof json !== "object") return String(json).trim();
    return fromRecord(json as Record<string, unknown>);
};

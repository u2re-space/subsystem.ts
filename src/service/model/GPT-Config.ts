import { canParseURL } from "core/utils/Runtime";
export type DataKind = "math" | "url" | "output_text" | "input_text" | "image" | "image_url" | "text" | "input_image" | "input_url" | "json" | "markdown" | "code" | "entity" | "structured" | "unknown" | "svg" | "xml";
export type DataInput = {
    dataSource: string | Blob | File | any,
    dataKind?: DataKind | null,
    context?: DataContext | null
}

export type DataContext = {
    existingData?: any;
    entityType?: string;
    operation?: "create" | "modify" | "merge" | "analyze" | "extract";
    filters?: DataFilter[];
    searchTerms?: string[];
    priority?: "low" | "medium" | "high";
}

export type DataFilter = {
    field: string;
    operator: "eq" | "neq" | "contains" | "startsWith" | "endsWith" | "gt" | "lt" | "gte" | "lte" | "in" | "nin" | "exists" | "regex";
    value: any;
    caseSensitive?: boolean;
}

export type ModificationInstruction = {
    action: "update" | "delete" | "merge" | "append" | "replace" | "transform";
    target: string;
    value?: any;
    conditions?: DataFilter[];
    transformFn?: string;
}

//
export const PROMPT_COMPUTE_EFFORT = (data: DataInput): "low" | "medium" | "high" => {
    const context = data?.context;

    // High effort for complex operations
    if (context?.operation === "merge" || context?.operation === "modify") return "high";
    if (context?.filters && context.filters.length > 3) return "high";
    if (data?.dataKind === "math") return "high";
    if (data?.dataKind === "structured" || data?.dataKind === "entity") return "high";

    // Blob/File handling
    if (data?.dataSource instanceof Blob || data?.dataSource instanceof File) {
        const size = data.dataSource.size;
        if (size > 1024 * 1024) return "high"; // >1MB (keep existing logic for effort calculation)
        if (data?.dataKind === "image") return "medium";
        return "medium";
    }

    // String handling with context
    if (typeof data?.dataSource === "string") {
        const len = data.dataSource.length;
        if (len > 10000) return "high";
        if (data?.dataSource?.includes?.("math")) return "high";
        if (data?.dataKind === "json" || data?.dataKind === "code") return "medium";
        if (context?.searchTerms?.length) return "medium";
        return "medium";
    }

    // Object handling
    if (typeof data?.dataSource === "object" && data?.dataSource !== null) {
        const keys = Object.keys(data.dataSource);
        if (keys.length > 20) return "high";
        if (context?.existingData) return "high";
        return "medium";
    }

    return "medium";
}

//
export const COMPUTE_TEMPERATURE = (data: DataInput): number => {
    const context = data?.context;

    // Deterministic operations need low temperature
    if (context?.operation === "extract" || context?.operation === "analyze") return 0.1;
    if (context?.operation === "modify" && context?.existingData) return 0.2;
    if (data?.dataKind === "math") return 0.1;
    if (data?.dataKind === "json" || data?.dataKind === "structured") return 0.2;
    if (data?.dataKind === "code") return 0.3;

    // Creative operations can use higher temperature
    if (context?.operation === "create") return 0.6;

    // Default by kind
    if (data?.dataKind === "url") return 0.3;
    if (data?.dataKind === "input_image") return 0.4;
    if (data?.dataKind === "input_text") return 0.5;
    if (data?.dataKind === "markdown") return 0.5;

    return 0.4;
}

//
export const typesForKind: Record<DataKind, "input_text" | "image_url" | "input_image" | "input_url" | "text_search_result" | "json_schema" | "json_schema_search_result"> = {
    "math": "input_text",
    "url": "input_image",
    "text": "input_text",
    "input_text": "input_text",
    "output_text": "input_text",
    "image_url": "input_image",
    "image": "input_image",
    "input_image": "input_image",
    "input_url": "input_image",
    "json": "input_text",
    "markdown": "input_text",
    "code": "input_text",
    "entity": "input_text",
    "structured": "input_text",
    "unknown": "input_text",
    "svg": "input_text",
    "xml": "input_text"
}

//
export const getDataKindByMIMEType = (mime: string): DataKind => {
    if (!mime) return "input_text";
    const lower = mime.toLowerCase();
    if (lower.includes("image")) return "input_image";
    if (lower.includes("json")) return "json";
    if (lower.includes("javascript") || lower.includes("typescript")) return "code";
    if (lower.includes("markdown") || lower.includes("md")) return "markdown";
    if (lower.includes("url")) return "input_url";
    if (lower.includes("text/html")) return "markdown";
    if (lower.includes("text/plain")) return "input_text";
    return "input_text";
}

//
export const detectDataKindFromContent = (content: string): DataKind => {
    if (!content || typeof content !== "string") return "input_text";

    const trimmed = content.trim();

    // Check for JSON
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try { JSON.parse(trimmed); return "json"; } catch { /* not valid JSON */ }
    }

    // Check for URL
    if (canParseURL(trimmed)) return "url";

    // Check for SVG - treat as XML/text, not image
    if (trimmed.includes('<svg') && trimmed.includes('</svg>')) return "xml";

    // Check for base64 image - only if the entire content is a data URL
    if (trimmed.startsWith("data:image/") && trimmed.includes(";base64,") && !trimmed.includes("\n") && trimmed.length < 100000) {
        // Additional validation: try to parse as data URL
        try {
            const url = new URL(trimmed);
            if (url.protocol === "data:" && url.pathname.startsWith("image/")) {
                return "input_image";
            }
        } catch {
            // Not a valid data URL
        }
    }

    // Check for math expressions
    if (/\$\$[\s\S]+\$\$|\$[^$]+\$|\\begin\{equation\}/.test(trimmed)) return "math";

    // Check for code
    if (/```[\s\S]+```|^(function|const|let|var|class|import|export)\s/m.test(trimmed)) return "code";

    // Check for markdown
    if (/^#{1,6}\s|^\*\*|^-\s|\[.+\]\(.+\)|^>\s/m.test(trimmed)) return "markdown";

    return "input_text";
}

//
export const actionWithDataType = (data: DataInput): string => {
    const context = data?.context;
    const kindType = typesForKind?.[data?.dataKind || "input_text"];

    // Build context-aware prompt based on operation
    const contextPrompt = buildContextPrompt(context);

    switch (kindType) {
        case "input_image":
            return `${contextPrompt}

Recognize data from image, also preferred to orient by fonts in image.

After recognition, do not include or remember image itself.

---

In (\`recognized_data\` key), can be written phone numbers, emails, URLs, dates, times, codes, etc. Additional formatting rules:

In recognized from image data (what you seen in image), do:
- If textual content, format as Markdown string (multiline).
- If phone number, format as as correct phone number (in normalized format).
  - Also, if phone numbers (for example starts with +7, format as 8), replace to correct regional code.
  - Remove brackets, parentheses, spaces or other symbols from phone number.
  - Trim spaces from phone number.
- If email, format as as correct email (in normalized format), and trim spaces from email.
- If URL, format as as correct URL (in normalized format), and unicode codes to human readable, and trim spaces from URL.
- If date, format as as correct date (in normalized format).
- If time, format as as correct time (in normalized format).
- If math (expression, equation, formula), format as $KaTeX$
- If table (or looks alike table), format as | table |
- If image, format as [$image$]($image$)
- If code, format as \`\`\`$code$\`\`\` (multiline) or \`$code$\` (single-line)
- If JSON, format as correct JSON string, and trim spaces from JSON string.
- If other, format as $text$.
- If seen alike list, format as list (in markdown format).

---

Some additional actions:
- Collect some special data tags and keywords (if has any).
- Also, can you provide in markdown pre-formatted free-form analyzed or recognized verbose data (in \`verbose_data\` key).

---

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { or [ and end with } or ].

Expected output structure:
{
    "keywords_and_tags": ["string array"],
    "recognized_data": ["any array"],
    "verbose_data": "markdown string",
    "using_ready": true,
    "confidence": 0.95,
    "suggested_type": "document_type"
}
`;

        case "input_text":
            return `${contextPrompt}

Analyze text and extract specific or special data from it, also normalize data by those rules...

---

In (\`recognized_data\` key), can be written phone numbers, emails, URLs, dates, times, codes, etc. Additional formatting rules:

Normalize phone numbers, emails, URLs, dates, times, codes, etc for best efforts and by those rules.
- If phone number, format as as correct phone number (in normalized format).
  - If phone numbers (for example starts with +7, format as 8), replace to correct regional code.
  - Trim spaces from phone numbers, emails, URLs, dates, times, codes, etc.
  - Remove brackets, parentheses, spaces or other symbols from phone numbers.
- If email, format as as correct email (in normalized format), and trim spaces from email.
- If URL, format as as correct URL (in normalized format), and unicode codes to human readable, and trim spaces from URL.
- If date, format as as correct date (in normalized format).
- If time, format as as correct time (in normalized format).
- If math, format as $KaTeX$
- If table, format as | table |
- If image, format as [$image$]($image$)
- If code, format as \`\`\`$code$\`\`\` (multiline) or \`$code$\` (single-line)
- If JSON, format as correct JSON string, and trim spaces from JSON string.
- If other, format as $text$.
- If seen alike list, format as list (in markdown format).

---

Some additional actions:
- Collect some special data tags and keywords (if has any).
- Also, can you provide in markdown pre-formatted free-form analyzed or recognized verbose data (in \`verbose_data\` key).
- Detect entity type if applicable (task, event, person, place, service, item, etc.)

---

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { or [ and end with } or ].

Expected output structure:
{
    "keywords_and_tags": ["string array"],
    "recognized_data": ["any array"],
    "verbose_data": "markdown string",
    "using_ready": true,
    "confidence": 0.95,
    "suggested_type": "entity_type",
    "suggested_modifications": []
}
`;
    }
    return contextPrompt || "";
}

//
const buildContextPrompt = (context?: DataContext | null): string => {
    if (!context) return "";

    const parts: string[] = [];

    if (context.operation) {
        const opDescriptions: Record<string, string> = {
            create: "Create new data entries based on provided information.",
            modify: "Modify existing data with provided changes while preserving structure.",
            merge: "Intelligently merge new data with existing data, avoiding duplicates.",
            analyze: "Analyze and extract structured information from the data.",
            extract: "Extract specific data points matching the criteria."
        };
        parts.push(`Operation: ${opDescriptions[context.operation] || context.operation}`);
    }

    if (context.entityType) {
        parts.push(`Target entity type: ${context.entityType}`);
    }

    if (context.existingData) {
        parts.push(`Existing data context provided - consider for merge/update operations.`);
    }

    if (context.filters?.length) {
        const filterDesc = context.filters.map(f =>
            `${f.field} ${f.operator} ${JSON.stringify(f.value)}`
        ).join(", ");
        parts.push(`Apply filters: ${filterDesc}`);
    }

    if (context.searchTerms?.length) {
        parts.push(`Search terms: ${context.searchTerms.join(", ")}`);
    }

    if (context.priority) {
        parts.push(`Priority level: ${context.priority}`);
    }

    return parts.length ? `Context:\n${parts.join("\n")}\n\n---\n` : "";
}

//
export const buildModificationPrompt = (instructions: ModificationInstruction[]): string => {
    if (!instructions?.length) return "";

    const parts = instructions.map((inst, i) => {
        const condStr = inst.conditions?.length
            ? ` when ${inst.conditions.map(c => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`).join(" AND ")}`
            : "";

        switch (inst.action) {
            case "update":
                return `${i + 1}. UPDATE field "${inst.target}" to ${JSON.stringify(inst.value)}${condStr}`;
            case "delete":
                return `${i + 1}. DELETE field "${inst.target}"${condStr}`;
            case "merge":
                return `${i + 1}. MERGE into "${inst.target}" with ${JSON.stringify(inst.value)}${condStr}`;
            case "append":
                return `${i + 1}. APPEND ${JSON.stringify(inst.value)} to "${inst.target}"${condStr}`;
            case "replace":
                return `${i + 1}. REPLACE "${inst.target}" with ${JSON.stringify(inst.value)}${condStr}`;
            case "transform":
                return `${i + 1}. TRANSFORM "${inst.target}" using: ${inst.transformFn}${condStr}`;
            default:
                return "";
        }
    }).filter(Boolean);

    return parts.length
        ? `\nModification instructions:\n${parts.join("\n")}\n`
        : "";
}

//
export const DATA_MODIFICATION_PROMPT = `
You are a data modification assistant. Your task is to modify existing data based on the provided instructions.

Rules for modification:
1. Preserve the original data structure unless explicitly asked to change it.
2. Apply modifications in order, one by one.
3. Validate data types match the schema.
4. Return the complete modified entity, not just the changes.
5. If a modification cannot be applied, include it in the "errors" array with explanation.

CRITICAL: Output ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { and end with }.

Expected output structure:
{
    "modified_entity": { /* complete modified entity */ },
    "changes_made": [ /* list of applied changes */ ],
    "errors": [ /* list of failed modifications with reasons */ ],
    "warnings": [ /* non-critical issues */ ]
}
`;

//
export const DATA_SELECTION_PROMPT = `
You are a data selection and filtering assistant. Your task is to find and select data matching the criteria.

Selection rules:
1. Apply all filters in order (AND logic by default).
2. Rank results by relevance to search terms.
3. Include confidence scores for fuzzy matches.
4. Group similar results to avoid duplicates.

CRITICAL: Output ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { and end with }.

Expected output structure:
{
    "selected_items": [ /* items matching criteria */ ],
    "total_matches": number,
    "filter_stats": { /* breakdown by filter */ },
    "suggestions": [ /* related items that might be relevant */ ]
}
`;

//
export const ENTITY_MERGE_PROMPT = `
You are an entity merging assistant. Your task is to intelligently merge multiple entities or data sources.

Merge rules:
1. Prefer newer/more complete data when conflicts arise.
2. Combine arrays without duplicates.
3. Merge nested objects recursively.
4. Preserve IDs and relationships.
5. Track the source of each merged field.

CRITICAL: Output ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { and end with }.

Expected output structure:
{
    "merged_entity": { /* result of merge */ },
    "conflicts_resolved": [ /* list of conflicts and how they were resolved */ ],
    "sources_used": [ /* which source contributed what */ ],
    "merge_confidence": number
}
`;

import { isBase64Like, parseDataUrl } from "fest/lure";

export interface LogSanitizerOptions {
    maxStringLength?: number;
    maxArrayLength?: number;
    maxObjectKeys?: number;
    maxDepth?: number;
}

const DEFAULT_OPTIONS: Required<LogSanitizerOptions> = {
    maxStringLength: 180,
    maxArrayLength: 8,
    maxObjectKeys: 20,
    maxDepth: 3
};

const isFileLike = (value: unknown): value is File =>
    typeof File !== "undefined" && value instanceof File;

const isBlobLike = (value: unknown): value is Blob =>
    typeof Blob !== "undefined" && value instanceof Blob;

const summarizeString = (value: string, maxStringLength: number): string => {
    if (!value) return value;

    const parsedDataUrl = parseDataUrl(value);
    if (parsedDataUrl) {
        const type = parsedDataUrl.mimeType || "application/octet-stream";
        return `[data-url ${type}, length=${value.length}]`;
    }

    if (value.length > maxStringLength && isBase64Like(value)) {
        return `[base64-like string, length=${value.length}]`;
    }

    if (value.length > maxStringLength) {
        return `${value.slice(0, maxStringLength)}... [truncated ${value.length - maxStringLength} chars]`;
    }

    return value;
};

const summarizeFormData = (formData: FormData, options: Required<LogSanitizerOptions>): Record<string, unknown> => {
    const entries = Array.from(formData.entries());
    const keys = [...new Set(entries.map(([key]) => key))];

    const preview: Record<string, unknown> = {};
    for (const key of keys.slice(0, options.maxObjectKeys)) {
        const values = formData.getAll(key);
        preview[key] = values.slice(0, options.maxArrayLength).map((entry) => {
            if (typeof entry === "string") return summarizeString(entry, options.maxStringLength);
            if (isFileLike(entry)) return { file: entry.name, type: entry.type, size: entry.size };
            return summarizeForLog(entry, options);
        });
    }

    return {
        kind: "FormData",
        keyCount: keys.length,
        keys,
        preview
    };
};

const summarizeRecord = (
    value: Record<string, unknown>,
    options: Required<LogSanitizerOptions>,
    depth: number,
    seen: WeakSet<object>
): Record<string, unknown> | string => {
    if (depth >= options.maxDepth) return `[object depth>${options.maxDepth}]`;
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    const entries = Object.entries(value);
    const sliced = entries.slice(0, options.maxObjectKeys);
    const summary: Record<string, unknown> = {};

    for (const [key, entryValue] of sliced) {
        summary[key] = summarizeUnknown(entryValue, options, depth + 1, seen);
    }

    if (entries.length > options.maxObjectKeys) {
        summary.__truncatedKeys = entries.length - options.maxObjectKeys;
    }

    return summary;
};

const summarizeUnknown = (
    value: unknown,
    options: Required<LogSanitizerOptions>,
    depth: number,
    seen: WeakSet<object>
): unknown => {
    if (value == null) return value;
    if (typeof value === "string") return summarizeString(value, options.maxStringLength);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;

    if (typeof FormData !== "undefined" && value instanceof FormData) {
        return summarizeFormData(value, options);
    }

    if (isFileLike(value)) {
        return { file: value.name, type: value.type, size: value.size };
    }

    if (isBlobLike(value)) {
        return { blob: true, type: value.type, size: value.size };
    }

    if (Array.isArray(value)) {
        if (depth >= options.maxDepth) return `[array(${value.length}) depth>${options.maxDepth}]`;

        const summary = value.slice(0, options.maxArrayLength).map((item) => summarizeUnknown(item, options, depth + 1, seen));
        if (value.length > options.maxArrayLength) {
            summary.push(`[${value.length - options.maxArrayLength} more items]`);
        }
        return summary;
    }

    if (typeof value === "object") {
        return summarizeRecord(value as Record<string, unknown>, options, depth, seen);
    }

    return String(value);
};

export const summarizeForLog = (value: unknown, partialOptions: LogSanitizerOptions = {}): unknown => {
    const options: Required<LogSanitizerOptions> = {
        ...DEFAULT_OPTIONS,
        ...partialOptions
    };
    return summarizeUnknown(value, options, 0, new WeakSet<object>());
};

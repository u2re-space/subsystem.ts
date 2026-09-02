/*
 * Filename: sw-unwrap.ts
 * FullPath: modules/projects/subsystem/src/routing/channel/sw-unwrap.ts
 * FIND:sw-page
 *
 * Leaf unwrap for SW / Uniform mail. No destination aliases.
 */

const PROTOCOL_MAIL_TYPES = new Set(["request", "response", "invoke", "ack", "act", "ask"]);

export type UnwrappedSwMessage = {
    type: string;
    data: unknown;
    command?: unknown;
    operations?: unknown;
    results?: unknown;
    raw: Record<string, unknown>;
};

const inferMailType = (row: Record<string, unknown>, type: string, data: unknown): string => {
    if (type && !PROTOCOL_MAIL_TYPES.has(type)) return type;
    const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    if (row.type === "workcenter-command" || row.command) return "workcenter-command";
    if (Array.isArray(row.operations) || Array.isArray(payload?.operations)) return "pending-operations";
    if (Array.isArray(row.results)) return "commit-to-clipboard";
    if (payload && (payload.rawData != null || payload.source === "share-target") && payload.content != null) {
        return "share-target-result";
    }
    if (
        row.type === "share-received" ||
        payload?.source === "share-target" ||
        payload?.fileCount != null ||
        Array.isArray(payload?.files)
    ) {
        return type === "share-target-input" ? "share-target-input" : "share-received";
    }
    if (payload && (payload.success === true || payload.success === false || payload.fallback != null)) {
        return "ai-result";
    }
    return type || "ai-result";
};

/**
 * Unwrap SW / Uniform envelopes so page listeners see the app verb + payload.
 * WHY: workers wrap mail in protocol fields; chat must still see `ai-result`.
 */
export const unwrapSwInteropMessage = (value: unknown): UnwrappedSwMessage | null => {
    if (value == null) return null;
    if (typeof value !== "object") {
        return { type: "ai-result", data: value, raw: { data: value } };
    }
    const row = value as Record<string, unknown>;
    const nested = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
    const type = inferMailType(
        row,
        String(row.what || (typeof row.type === "string" ? row.type : "") || nested?.type || ""),
        row.data ?? row.payload ?? nested?.data ?? row
    );
    return {
        type,
        data: row.data ?? row.payload ?? nested?.data ?? row,
        command: row.command ?? nested?.command,
        operations: row.operations ?? nested?.operations,
        results: row.results ?? nested?.results,
        raw: row
    };
};

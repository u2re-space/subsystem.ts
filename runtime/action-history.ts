export interface ActionInput {
    type?: string;
    text?: string;
    files?: File[];
    recognizedData?: unknown;
    recognizedContent?: string;
    [key: string]: unknown;
}

export interface ActionContext {
    source: string;
    sessionId?: string;
}

export interface ActionEntry {
    id: string;
    action: string;
    input: ActionInput;
    context: ActionContext;
    status: "completed" | "failed" | "pending";
    result?: { type?: string; content?: string; processingTime?: number };
    timestamp: number;
}

const entries: ActionEntry[] = [];

export const actionHistory = {
    add(entry: ActionEntry): void {
        entries.unshift(entry);
    },
    getRecentEntries(limit = 20): ActionEntry[] {
        return entries.slice(0, limit);
    },
    getStats() {
        return {
            total: entries.length,
            completed: entries.filter((entry) => entry.status === "completed").length,
            failed: entries.filter((entry) => entry.status === "failed").length
        };
    }
};

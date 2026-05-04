export interface WireTargetEntry {
    id: string;
    label?: string;
}

export function parseWireTargetList(value: unknown): WireTargetEntry[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === "string" ? { id: entry.trim() } : entry as WireTargetEntry))
            .filter((entry) => Boolean(entry?.id));
    }
    if (typeof value !== "string") return [];
    return value
        .split(/[,\s]+/)
        .map((id) => ({ id: id.trim() }))
        .filter((entry) => Boolean(entry.id));
}

export function wireTargetNodeIds(entries: WireTargetEntry[]): string[] {
    return entries.map((entry) => entry.id).filter(Boolean);
}

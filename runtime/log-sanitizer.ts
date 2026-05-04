export function summarizeForLog(value: unknown): string {
    if (typeof value === "string") return value.slice(0, 240);
    try {
        return JSON.stringify(value)?.slice(0, 240) ?? "";
    } catch {
        return String(value);
    }
}

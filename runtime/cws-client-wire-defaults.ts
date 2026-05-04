export function resolveWireArchetype(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "airpad";
}

export function resolveWireConnectionType(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "auto";
}

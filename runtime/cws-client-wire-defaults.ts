/**
 * Fallback archetype / connection hints for websocket handshake construction.
 *
 * NOTE: NativeScript (`apps/CWSAndroid`) advertises archetype `nativescript-cwsp` — see `cwsp-shared/airpad-cwsp-client-parity`.
 */
export function resolveWireArchetype(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "airpad";
}

export function resolveWireConnectionType(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "auto";
}

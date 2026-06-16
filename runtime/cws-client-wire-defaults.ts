/**
 * Fallback archetype / connection hints for websocket handshake construction.
 *
 * NOTE: CWSAndroid (Java) advertises archetype `java-cwsp`; AirPad PWA uses `airpad`.
 * Gateway accepts `connectionType=first-order` while identity keeps exchanger semantics.
 *
 * @see runtime/cwsp/endpoint/server/socket/client-contract.ts
 * @see airpad-cwsp-client-parity.ts
 */
export const CWSP_WIRE_ENVELOPE_V2 = "v2";
export const CWSP_WIRE_ARCHETYPE_AIRPAD = "airpad";
export const CWSP_WIRE_ARCHETYPE_JAVA = "java-cwsp";
export const CWSP_WIRE_CONNECTION_EXCHANGER = "exchanger-initiator";
/** Wire query value when logical type is exchanger-* (gateway compatibility). */
export const CWSP_WIRE_CONNECTION_GATEWAY = "first-order";

export function resolveWireArchetype(value: unknown): string {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw) return raw;
    return CWSP_WIRE_ARCHETYPE_AIRPAD;
}

export function resolveWireConnectionType(value: unknown): string {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!raw || raw === "auto") return CWSP_WIRE_CONNECTION_GATEWAY;
    if (raw.includes("exchanger")) return CWSP_WIRE_CONNECTION_GATEWAY;
    return typeof value === "string" ? value.trim() : CWSP_WIRE_CONNECTION_GATEWAY;
}

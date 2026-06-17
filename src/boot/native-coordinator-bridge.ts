/**
 * Capacitor/CWSAndroid: route coordinator acts through Java {@code CwspRuntime} when it owns `/ws`.
 * WHY: WebView hub connect is skipped to avoid duplicate clientId sessions; AirPad must not queue on a dead socket.
 *
 * CWSAndroid {@code CwsBridgePlugin} channels:
 * - coordinator:act / coordinator:ask — JSON envelope with ts+perfTs on input/clipboard payload
 * - coordinator:binary — base64 legacy 8-byte frame (bytes 6–7 = perfTsLo)
 * - coordinator:status — { connected: boolean }
 */
import { invokeCwsNative, isCapacitorCwsNativeShell } from "com/routing/native/cws-bridge";
import {
    annotateCoordinatorPayload,
    shouldAnnotateCoordinatorPayload
} from "cwsp-shared/input-command-timing";
import { isPreferNativeWebsocketEnabled } from "views/airpad/config/config";
import { nativeShellOwnsExclusiveHubWebsocket } from "./hub-socket-boot";

let nativeConnectedCache = false;
let nativeStatusCheckedAt = 0;
const NATIVE_STATUS_TTL_MS = 1200;

export const shouldUseNativeCoordinatorTransport = (): boolean =>
    nativeShellOwnsExclusiveHubWebsocket() && isCapacitorCwsNativeShell() && isPreferNativeWebsocketEnabled();

export const refreshNativeCoordinatorStatus = async (): Promise<boolean> => {
    if (!shouldUseNativeCoordinatorTransport()) {
        nativeConnectedCache = false;
        return false;
    }
    try {
        const result = await invokeCwsNative("coordinator:status", {});
        const connected = Boolean((result.echo as { connected?: boolean })?.connected ?? result.ok);
        nativeConnectedCache = connected;
        nativeStatusCheckedAt = Date.now();
        return connected;
    } catch {
        nativeConnectedCache = false;
        nativeStatusCheckedAt = Date.now();
        return false;
    }
};

export const isNativeCoordinatorConnected = (): boolean => {
    if (!shouldUseNativeCoordinatorTransport()) return false;
    if (Date.now() - nativeStatusCheckedAt > NATIVE_STATUS_TTL_MS) {
        void refreshNativeCoordinatorStatus();
    }
    return nativeConnectedCache;
};

const nativeWirePayload = (what: string, payload: unknown): unknown => {
    if (!shouldAnnotateCoordinatorPayload(what)) return payload ?? {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload ?? {};
    return annotateCoordinatorPayload(payload as Record<string, unknown>);
};

export const sendNativeCoordinatorBinary = async (data: ArrayBuffer | Uint8Array): Promise<boolean> => {
    if (!shouldUseNativeCoordinatorTransport()) return false;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
    const b64 = btoa(binary);
    try {
        const result = await invokeCwsNative("coordinator:binary", { data: b64, encoding: "base64" });
        const sent = Boolean((result.echo as { sent?: boolean })?.sent ?? result.ok);
        if (sent) {
            nativeConnectedCache = true;
            nativeStatusCheckedAt = Date.now();
        }
        return sent;
    } catch {
        nativeConnectedCache = false;
        nativeStatusCheckedAt = Date.now();
        return false;
    }
};

export const sendNativeCoordinatorDispatch = async (input: {
    op: "act" | "ask";
    what: string;
    payload: unknown;
    nodes?: string[];
    uuid?: string;
}): Promise<unknown> => {
    const result = await invokeCwsNative("coordinator:dispatch", {
        what: input.what,
        payload: nativeWirePayload(input.what, input.payload),
        nodes: input.nodes ?? [],
        uuid: input.uuid ?? "",
        op: input.op
    });
    const echo = (result.echo ?? {}) as { result?: unknown; body?: string };
    if (echo.result !== undefined) return echo.result;
    if (typeof echo.body === "string" && echo.body.trim()) {
        try {
            const parsed = JSON.parse(echo.body) as { result?: unknown; payload?: unknown; data?: unknown };
            return parsed.result ?? parsed.payload ?? parsed.data ?? echo.body;
        } catch {
            return echo.body;
        }
    }
    return echo.result ?? null;
};

export const sendNativeCoordinatorEnvelope = async (input: {
    op: "act" | "ask";
    what: string;
    payload: unknown;
    nodes?: string[];
    uuid?: string;
}): Promise<boolean> => {
    if (!shouldUseNativeCoordinatorTransport()) return false;
    const channel = input.op === "ask" ? "coordinator:ask" : "coordinator:act";
    try {
        const result = await invokeCwsNative(channel, {
            what: input.what,
            payload: nativeWirePayload(input.what, input.payload),
            nodes: input.nodes ?? [],
            uuid: input.uuid ?? "",
            op: input.op
        });
        const sent = Boolean((result.echo as { sent?: boolean })?.sent ?? result.ok);
        if (sent) {
            nativeConnectedCache = true;
            nativeStatusCheckedAt = Date.now();
        }
        return sent;
    } catch {
        nativeConnectedCache = false;
        nativeStatusCheckedAt = Date.now();
        return false;
    }
};

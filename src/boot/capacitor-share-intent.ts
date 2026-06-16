/**
 * Capacitor share / process-text bridge (Android → WebView → CWSP clipboard fan-out).
 *
 * MainActivity triggers `cws:shareIntent` via {@code bridge.triggerWindowJSEvent}.
 * This module listens and broadcasts text through the coordinator when connected.
 */

import { isCapacitorNative } from "./capacitor-permissions";
import { isCapacitorCwsNativeShell } from "com/routing/native/cws-bridge";

type ShareIntentDetail = { text?: string; action?: string } | string;

const parseShareText = (detail: ShareIntentDetail | null | undefined): string => {
    if (detail == null) return "";
    if (typeof detail === "string") {
        const trimmed = detail.trim();
        if (!trimmed) return "";
        try {
            const parsed = JSON.parse(trimmed) as { text?: string };
            return String(parsed?.text || trimmed).trim();
        } catch {
            return trimmed;
        }
    }
    return String(detail.text || "").trim();
};

const readDestinationNodes = (settings: Record<string, unknown>): string[] => {
    const cwsp = (settings.cwsp && typeof settings.cwsp === "object")
        ? (settings.cwsp as Record<string, unknown>)
        : {};
    const raw =
        String(cwsp.shareIntentDestinationIds || cwsp.destinationNodeIds || "*").trim() || "*";
    if (raw === "*" || raw.toLowerCase() === "any") return ["*"];
    return raw
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
};

let installed = false;

export const installCapacitorShareIntentBridge = (): void => {
    if (!isCapacitorNative() || installed) return;
    // CWSAndroid: NativeScript owns SEND/PROCESS_TEXT via Activity intent + native `/ws`.
    if (isCapacitorCwsNativeShell()) return;
    installed = true;

    const handler = (ev: Event): void => {
        void (async () => {
            const text = parseShareText((ev as CustomEvent<ShareIntentDetail>).detail);
            if (!text) return;

            const [{ loadSettings }, ws] = await Promise.all([
                import("com/config/Settings"),
                import("shared/transport/websocket")
            ]);

            const settings = loadSettings() as Record<string, unknown>;
            const nodes = readDestinationNodes(settings);
            ws.connectWS();
            ws.sendCoordinatorAct("clipboard:update", { text, source: "android-share" }, nodes);
        })().catch(() => { /* best-effort */ });
    };

    window.addEventListener("cws:shareIntent", handler);
};

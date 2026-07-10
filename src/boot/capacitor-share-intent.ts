/**
 * Capacitor share / process-text bridge (Android → WebView → CWSP clipboard fan-out).
 *
 * Primary path: {@code ShareActivity} fans out via native /ws without opening MainActivity.
 * This module is a secondary path when WebView is already alive and receives
 * {@code cws:shareIntent} / asset handoff events.
 */

import { isCapacitorNative } from "./capacitor-permissions";
import { isCapacitorCwsNativeShell } from "com/routing/native/cws-bridge";
import { splitMultiValueList } from "cwsp-shared/multi-value-list";

type ShareAsset = {
    hash?: string;
    name?: string;
    mimeType?: string;
    type?: string;
    size?: number;
    source?: string;
    data?: string;
};

type ShareIntentDetail = {
    text?: string;
    action?: string;
    asset?: ShareAsset;
} | string;

const parseSharePayload = (
    detail: ShareIntentDetail | null | undefined
): { text: string; asset: ShareAsset | null } => {
    if (detail == null) return { text: "", asset: null };
    if (typeof detail === "string") {
        const trimmed = detail.trim();
        if (!trimmed) return { text: "", asset: null };
        try {
            const parsed = JSON.parse(trimmed) as { text?: string; asset?: ShareAsset };
            return {
                text: String(parsed?.text || "").trim() || (parsed?.asset ? "" : trimmed),
                asset: parsed?.asset && typeof parsed.asset === "object" ? parsed.asset : null
            };
        } catch {
            return { text: trimmed, asset: null };
        }
    }
    return {
        text: String(detail.text || "").trim(),
        asset: detail.asset && typeof detail.asset === "object" ? detail.asset : null
    };
};

const readDestinationNodes = (settings: Record<string, unknown>): string[] => {
    const cwsp = (settings.cwsp && typeof settings.cwsp === "object")
        ? (settings.cwsp as Record<string, unknown>)
        : {};
    const raw =
        String(cwsp.shareIntentDestinationIds || cwsp.destinationNodeIds || "*").trim() || "*";
    if (raw === "*" || raw.toLowerCase() === "any") return ["*"];
    return splitMultiValueList(raw);
};

let installed = false;

export const installCapacitorShareIntentBridge = (): void => {
    if (!isCapacitorNative() || installed) return;
    // CWSAndroid: NativeScript owns SEND/PROCESS_TEXT via Activity intent + native `/ws`.
    if (isCapacitorCwsNativeShell()) return;
    installed = true;

    const handler = (ev: Event): void => {
        void (async () => {
            const { text, asset } = parseSharePayload(
                (ev as CustomEvent<ShareIntentDetail>).detail
            );
            if (!text && !asset) return;

            const [{ loadSettings }, ws] = await Promise.all([
                import("com/config/Settings"),
                import("shared/transport/websocket")
            ]);

            const settings = loadSettings() as Record<string, unknown>;
            const nodes = readDestinationNodes(settings);
            ws.connectWS();
            if (asset) {
                ws.sendCoordinatorAct(
                    "clipboard:update",
                    { asset, source: "android-share" },
                    nodes
                );
            }
            if (text) {
                ws.sendCoordinatorAct(
                    "clipboard:update",
                    { text, source: "android-share" },
                    nodes
                );
            }
        })().catch(() => { /* best-effort */ });
    };

    window.addEventListener("cws:shareIntent", handler);
};

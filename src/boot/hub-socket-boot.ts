/**
 * Unified hub transport: WebSocket to cwsp / endpoint (same stack as AirPad), optional background connection.
 * Used from main PWA boot, Settings save, and CRX shells so clipboard coordinator works outside the AirPad view.
 *
 * Filename: hub-socket-boot.ts
 * FullPath: modules/projects/subsystem/src/boot/hub-socket-boot.ts
 * Change date and time: 14.05.00_19.07.2026
 * Reason for changes: SW-safe DOM checks (no bare `window`) for CRX service worker.
 */

import { loadSettings, shouldDeferCrxHubSocketBootstrap } from "com/other/config/Settings";
import type { AppSettings } from "com/other/config/SettingsTypes";
import {
    applyAirpadRuntimeFromAppSettings,
    getRemoteHost,
    isClipboardHubBootstrapEnabled,
    isMaintainHubSocketConnectionEnabled,
    isNeutralinoNodeClipboardHubOwned,
    isPreferNativeWebsocketEnabled
} from "views/airpad/config/config";
// WHY: static — CRX SW calls applyHubSocketFromSettings; dynamic import() is illegal there.
import {
    connectWS,
    getWS,
    initWebSocket,
    isWSConnected,
    reconnectTransportAfterLifecycleResume
} from "./websocket";

/** After this long in the background, force a full reconnect (zombie TCP / suspended workers). */
const PWA_STALE_BACKGROUND_MS = 12_000;

let hubLifecycleRecoveryInstalled = false;
let lastDocumentHiddenAt = 0;

/** True only in real DOM pages — never use bare `window` (throws in MV3 SW). */
const canUseDomWindow = (): boolean => {
    try {
        const g = globalThis as typeof globalThis & { window?: unknown; document?: unknown };
        return Boolean(g.window && g.document);
    } catch {
        return false;
    }
};

const isCapacitorNativePlatform = (): boolean => {
    try {
        const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

/**
 * True when native Android (Capacitor/NativeScript) owns fleet `/ws`.
 * INVARIANT: WebView must not open a second `/ws` with the same clientId.
 * AirPad input goes through CwsBridge → CwspWsClient instead.
 */
export function nativeShellOwnsExclusiveHubWebsocket(): boolean {
    if (!isPreferNativeWebsocketEnabled()) return false;
    try {
        if ((globalThis as { __CWS_NATIVE__?: boolean }).__CWS_NATIVE__ === true) return true;
    } catch {
        /* ignore */
    }
    // WHY: Capacitor CwspBridgeService + CwspWsClient is the canonical Android /ws.
    return isCapacitorNativePlatform();
}

/**
 * Neutralino/WebNative: Node clipboard-hub owns the fleet `/ws` clipboard session.
 * INVARIANT: WebView must not open a second `/ws` with the same clientId (kicks the hub).
 */
export function nodeClipboardHubOwnsExclusiveWebsocket(): boolean {
    return isNeutralinoNodeClipboardHubOwned();
}

/** Any shell where WebView browser WebSocket must stay dark for fleet hub. */
export function backendOwnsExclusiveHubWebsocket(): boolean {
    return nativeShellOwnsExclusiveHubWebsocket() || nodeClipboardHubOwnsExclusiveWebsocket();
}

function shouldRunHubRecovery(): boolean {
    if (backendOwnsExclusiveHubWebsocket()) return false;
    if (!isMaintainHubSocketConnectionEnabled() && !isClipboardHubBootstrapEnabled()) return false;
    if (!getRemoteHost().trim()) return false;
    return true;
}

/**
 * PWA / mobile: restore hub ↔ endpoint after suspend, offline, or bfcache restore.
 * Requires Settings → maintain hub socket + a remote host (same rules as {@link applyHubSocketFromSettings}).
 */
export function installAirpadHubLifecycleRecovery(): void {
    if (hubLifecycleRecoveryInstalled || !canUseDomWindow()) {
        return;
    }
    hubLifecycleRecoveryInstalled = true;

    const doc = (globalThis as typeof globalThis & { document: Document }).document;
    const win = (globalThis as typeof globalThis & { window: Window }).window;

    doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState !== "hidden") return;
        lastDocumentHiddenAt = Date.now();
    });

    const schedule = (fn: () => void) => {
        globalThis.setTimeout(fn, 280);
    };

    const recoverAfterVisibility = () => {
        if (!shouldRunHubRecovery()) return;
        void (async () => {
            initWebSocket(null);
            const live = Boolean(getWS()?.connected);
            const stale =
                lastDocumentHiddenAt > 0 && Date.now() - lastDocumentHiddenAt >= PWA_STALE_BACKGROUND_MS;
            if (stale && (live || isWSConnected())) {
                reconnectTransportAfterLifecycleResume("visibility");
                return;
            }
            if (!live && !isWSConnected()) {
                connectWS();
            }
        })();
    };

    const recoverAfterNetworkOrRestore = (reason: string) => {
        if (!shouldRunHubRecovery()) return;
        void (() => {
            initWebSocket(null);
            reconnectTransportAfterLifecycleResume(reason);
        })();
    };

    doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState !== "visible") return;
        schedule(recoverAfterVisibility);
    });

    win.addEventListener("online", () => schedule(() => recoverAfterNetworkOrRestore("online")));

    win.addEventListener("pageshow", (ev) => {
        if (!(ev as PageTransitionEvent).persisted) return;
        schedule(() => recoverAfterNetworkOrRestore("bfcache"));
    });
}

/**
 * Load stored settings, apply AirPad / shell runtime, then connect or disconnect the hub socket.
 */
export async function bootHubSocketFromStoredSettings(): Promise<void> {
    const settings = await loadSettings();
    await applyHubSocketFromSettings(settings);
}

/**
 * Apply after boot or any settings mutation (Save, storage sync). Idempotent with {@link applyAirpadRuntimeFromAppSettings}.
 */
export async function applyHubSocketFromSettings(settings: AppSettings): Promise<void> {
    installAirpadHubLifecycleRecovery();
    if (await shouldDeferCrxHubSocketBootstrap(settings)) {
        return;
    }
    applyAirpadRuntimeFromAppSettings(settings);

    // WHY: Capacitor Java / NativeScript owns exclusive `/ws` — do not open WebView socket.
    if (nativeShellOwnsExclusiveHubWebsocket()) {
        return;
    }
    // WHY: Neutralino/WebNative Node clipboard-hub owns LAN clipboard `/ws` — do not
    // open a WebView browser WebSocket (same clientId → gateway kicks the hub).
    if (nodeClipboardHubOwnsExclusiveWebsocket()) {
        return;
    }

    if (!isMaintainHubSocketConnectionEnabled() && !isClipboardHubBootstrapEnabled()) {
        // Do not disconnect: user may still use a manual AirPad "WS" connection.
        return;
    }

    const host = getRemoteHost().trim();
    if (!host) {
        return;
    }

    initWebSocket(null);
    connectWS();
}

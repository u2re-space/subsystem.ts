/**
 * Unified hub transport: WebSocket to cwsp / endpoint (same stack as AirPad), optional background connection.
 * Used from main PWA boot, Settings save, and CRX shells so clipboard coordinator works outside the AirPad view.
 *
 * Filename: hub-socket-boot.ts
 * FullPath: apps/CWSP-reborn/src/frontend/submodules/shells/boot/hub-socket-boot.ts
 * Change date and time: 18.45.00_13.07.2026
 * Reason for changes: Capacitor Java CwspBridgeService owns /ws exclusively (like Neutralino Node hub).
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

/** After this long in the background, force a full reconnect (zombie TCP / suspended workers). */
const PWA_STALE_BACKGROUND_MS = 12_000;

let hubLifecycleRecoveryInstalled = false;
let lastDocumentHiddenAt = 0;

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
    if (hubLifecycleRecoveryInstalled || typeof window === "undefined" || typeof document === "undefined") {
        return;
    }
    hubLifecycleRecoveryInstalled = true;

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") return;
        lastDocumentHiddenAt = Date.now();
    });

    const schedule = (fn: () => void) => {
        globalThis.setTimeout(fn, 280);
    };

    const recoverAfterVisibility = () => {
        if (!shouldRunHubRecovery()) return;
        void (async () => {
            const {
                connectWS,
                getWS,
                initWebSocket,
                isWSConnected,
                reconnectTransportAfterLifecycleResume
            } = await import("./websocket");
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
        void (async () => {
            const { initWebSocket, reconnectTransportAfterLifecycleResume } = await import("./websocket");
            initWebSocket(null);
            reconnectTransportAfterLifecycleResume(reason);
        })();
    };

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        schedule(recoverAfterVisibility);
    });

    window.addEventListener("online", () => schedule(() => recoverAfterNetworkOrRestore("online")));

    window.addEventListener("pageshow", (ev) => {
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

    const { initWebSocket, connectWS } = await import("./websocket");
    initWebSocket(null);
    connectWS();
}

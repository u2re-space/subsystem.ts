/**
 * Unified hub transport: WebSocket to cwsp / endpoint (same stack as AirPad), optional background connection.
 * Used from main PWA boot, Settings save, and CRX shells so clipboard coordinator works outside the AirPad view.
 */

import type { AppSettings } from "core/config/SettingsTypes";
import { loadSettings, shouldDeferCrxHubSocketBootstrap } from "core/config/Settings";
import {
    applyAirpadRuntimeFromAppSettings,
    getRemoteHost,
    isMaintainHubSocketConnectionEnabled,
    isPreferNativeWebsocketEnabled
} from "views/airpad/config/config";
import { isCapacitorCwsNativeShell } from "shared/native/cws-bridge";

/** After this long in the background, force a full reconnect (zombie TCP / suspended workers). */
const PWA_STALE_BACKGROUND_MS = 12_000;

let hubLifecycleRecoveryInstalled = false;
let lastDocumentHiddenAt = 0;

function shouldRunHubRecovery(): boolean {
    if (isCapacitorCwsNativeShell() && isPreferNativeWebsocketEnabled()) return false;
    if (!isMaintainHubSocketConnectionEnabled()) return false;
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
    installAirpadHubLifecycleRecovery();
    const settings = await loadSettings();
    await applyHubSocketFromSettings(settings);
}

/**
 * Apply after any settings mutation (Save, storage sync). Idempotent with {@link applyAirpadRuntimeFromAppSettings}.
 */
export async function applyHubSocketFromSettings(settings: AppSettings): Promise<void> {
    if (await shouldDeferCrxHubSocketBootstrap(settings)) {
        return;
    }
    applyAirpadRuntimeFromAppSettings(settings);

    // WHY: native shells can own the socket lifecycle themselves, so the web
    // hub should stand down when the user prefers native websocket transport.
    if (isCapacitorCwsNativeShell() && isPreferNativeWebsocketEnabled()) {
        return;
    }

    if (!isMaintainHubSocketConnectionEnabled()) {
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

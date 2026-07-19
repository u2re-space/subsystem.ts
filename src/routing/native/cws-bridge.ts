/*
 * Filename: cws-bridge.ts
 * FullPath: modules/projects/subsystem/src/routing/native/cws-bridge.ts
 * Change date and time: 14.45.00_19.07.2026
 * Reason for changes: Idempotent CwsBridge registerPlugin (CRX SW loads capacitor chunk + dynamic import).
 */
/**
 * Unified CWSP bridge: Capacitor WebView / CWSAndroid (Kotlin) ↔ TypeScript.
 * Native implementation: `runtime/CWSAndroid/plugins/capacitor-cws-bridge/android` (@CapacitorPlugin name CwsBridge).
 */
import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin, WebPlugin } from "@capacitor/core";
import { createProtocolEnvelope, isProtocolEnvelope, normalizeProtocolEnvelope, type UniformProtocolEnvelope } from "fest/uniform";
import { withTimeout } from "fest/core";
import {
    AIRPAD_REMOTE_CONFIG_STORAGE_KEY,
    CWSP_REMOTE_CONFIG_SYNC_CHANNEL,
    appSettingsShellToNativeExtras,
    appSettingsToRemoteConnectionV1,
    stringifyCwspRemoteConnectionV1
} from "cwsp-shared/airpad-cwsp-client-parity";
import { createInteropEnvelope } from "../channel/UniformInterop";

export interface CwsShellInfo {
    shell: string;
    bridge: string;
    native: boolean;
    platform?: string;
}

export interface CwsBridgeInvokeResult {
    ok: boolean;
    channel: string;
    echo: Record<string, unknown>;
    appSettings?: Record<string, unknown>;
    nativeSettings?: Record<string, unknown> | string;
    envelope?: UniformProtocolEnvelope<Record<string, unknown>>;
}

export type CwsNativeIpcInput = {
    channel?: string;
    payload?: Record<string, unknown>;
    envelope?: UniformProtocolEnvelope<Record<string, unknown>>;
};

export interface CwsBridgePluginContract {
    getShellInfo(): Promise<CwsShellInfo>;
    invoke(options: {
        channel: string;
        payload?: Record<string, unknown>;
        envelope?: UniformProtocolEnvelope<Record<string, unknown>>;
    }): Promise<CwsBridgeInvokeResult>;
    addListener(
        eventName: "nativeMessage",
        listenerFunc: (event: { payload?: Record<string, unknown> }) => void
    ): Promise<PluginListenerHandle>;
    removeAllListeners(): Promise<void>;
}

type CwsBridgeGlobal = typeof globalThis & {
    __CWS_BRIDGE_PLUGIN__?: CwsBridgePluginContract;
    Capacitor?: { Plugins?: Record<string, unknown> };
};

class CwsBridgeWeb extends WebPlugin implements CwsBridgePluginContract {
    async getShellInfo(): Promise<CwsShellInfo> {
        return {
            shell: "browser",
            bridge: "cws-bridge",
            native: false,
            platform: typeof globalThis.navigator !== "undefined" ? "web" : "unknown"
        };
    }

    async invoke(options: {
        channel: string;
        payload?: Record<string, unknown>;
        envelope?: UniformProtocolEnvelope<Record<string, unknown>>;
    }): Promise<CwsBridgeInvokeResult> {
        const envelope = normalizeBridgeEnvelope(options.channel, options.payload, options.envelope);
        return {
            ok: true,
            channel: options.channel,
            echo: { ...(options.payload ?? {}) },
            envelope
        };
    }
}

/**
 * WHY: CRX bundles `@capacitor/core` with a first `registerPlugin("CwsBridge")`, then
 * Settings dynamic-imports this module and would register again → console warn.
 * INVARIANT: one Capacitor plugin proxy per JS realm.
 */
const registerCwsBridgeOnce = (): CwsBridgePluginContract => {
    const g = globalThis as CwsBridgeGlobal;
    if (g.__CWS_BRIDGE_PLUGIN__) return g.__CWS_BRIDGE_PLUGIN__;
    const existing = g.Capacitor?.Plugins?.CwsBridge as CwsBridgePluginContract | undefined;
    if (existing) {
        g.__CWS_BRIDGE_PLUGIN__ = existing;
        return existing;
    }
    const plugin = registerPlugin<CwsBridgePluginContract>("CwsBridge", {
        web: () => new CwsBridgeWeb()
    });
    g.__CWS_BRIDGE_PLUGIN__ = plugin;
    return plugin;
};

export const CwsBridge = registerCwsBridgeOnce();

declare global {
    interface Window {
        __CWS_SHELL_INFO__?: CwsShellInfo;
        electronBridge?: {
            setThemeColor?: (color: string, symbolColor?: string) => void;
            getShellInfo?: () => Promise<CwsShellInfo>;
            invoke?: (input: {
                channel?: string;
                payload?: Record<string, unknown>;
                envelope?: UniformProtocolEnvelope<Record<string, unknown>>;
            }) => Promise<CwsBridgeInvokeResult>;
        };
    }
}

let bridgeInitDone = false;

const normalizeBridgeEnvelope = (
    channel: string,
    payload?: Record<string, unknown>,
    envelope?: UniformProtocolEnvelope<Record<string, unknown>>
): UniformProtocolEnvelope<Record<string, unknown>> => {
    if (envelope && isProtocolEnvelope(envelope)) {
        return normalizeProtocolEnvelope(envelope);
    }
    const interop = createInteropEnvelope<Record<string, unknown>>({
        purpose: "invoke",
        protocol: "service",
        transport: "service-worker",
        type: "invoke",
        op: "invoke",
        source: "webview",
        destination: "native",
        srcChannel: "webview",
        dstChannel: "native",
        payload: payload ?? {},
        data: payload ?? {}
    });
    return createProtocolEnvelope<Record<string, unknown>>({
        ...interop,
        path: ["cws-bridge", channel]
    });
};

const normalizeInvokeResultEnvelope = (
    channel: string,
    payload: Record<string, unknown>,
    result: CwsBridgeInvokeResult
): UniformProtocolEnvelope<Record<string, unknown>> => {
    if (result?.envelope && isProtocolEnvelope(result.envelope)) {
        return normalizeProtocolEnvelope(result.envelope);
    }
    const interop = createInteropEnvelope<Record<string, unknown>>({
        purpose: "invoke",
        protocol: "service",
        transport: "service-worker",
        type: result.ok ? "response" : "ack",
        op: "invoke",
        source: "native",
        destination: "webview",
        srcChannel: "native",
        dstChannel: "webview",
        payload,
        data: payload
    });
    return createProtocolEnvelope<Record<string, unknown>>({
        ...interop,
        path: ["cws-bridge", channel]
    });
};

/**
 * Initialize the native bridge surface and normalize inbound native messages.
 *
 * AI-READ: this is the TypeScript side of the WebView/native boundary, so it
 * is one of the first places to inspect when networking works natively but not
 * through the web shell or vice versa.
 */
export async function initCwsNativeBridge(): Promise<CwsShellInfo | null> {
    if (bridgeInitDone) {
        return typeof globalThis.window !== "undefined" ? globalThis.window.__CWS_SHELL_INFO__ ?? null : null;
    }
    bridgeInitDone = true;
    const electronInfoFn = globalThis.window?.electronBridge?.getShellInfo;
    if (typeof electronInfoFn === "function") {
        try {
            const info = await electronInfoFn();
            if (typeof globalThis.window !== "undefined") {
                globalThis.window.__CWS_SHELL_INFO__ = info;
            }
            return info;
        } catch {
            /* fallback to capacitor/web plugin */
        }
    }
    try {
        const info = await CwsBridge.getShellInfo();
        if (typeof globalThis.window !== "undefined") {
            globalThis.window.__CWS_SHELL_INFO__ = info;
        }
        try {
            await CwsBridge.addListener("nativeMessage", (event) => {
                const payload = (event && typeof event.payload === "object" && event.payload != null)
                    ? (event.payload as Record<string, unknown>)
                    : {};
                const envelopeRaw = payload?.envelope;
                const envelope = (
                    envelopeRaw && typeof envelopeRaw === "object" && isProtocolEnvelope(envelopeRaw)
                )
                    ? normalizeProtocolEnvelope(envelopeRaw as UniformProtocolEnvelope<Record<string, unknown>>)
                    : createProtocolEnvelope<Record<string, unknown>>(createInteropEnvelope<Record<string, unknown>>({
                        purpose: "mail",
                        protocol: "service",
                        transport: "service-worker",
                        type: "act",
                        op: "deliver",
                        source: "native",
                        destination: "webview",
                        srcChannel: "native",
                        dstChannel: "webview",
                        payload,
                        data: payload
                    }));
                globalThis.dispatchEvent(new CustomEvent("cws-native-message", { detail: { event, envelope, payload } }));
            });
        } catch {
            /* no native bridge */
        }
        return info;
    } catch {
        return null;
    }
}

/** Detect the Capacitor/CWSAndroid shell where native networking may replace browser transport rules. */
export const isCapacitorCwsNativeShell = (): boolean => {
    try {
        const c = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

/** Detect the Electron shell, which uses its own invoke bridge instead of Capacitor plugins. */
export const isElectronCwsNativeShell = (): boolean => {
    try {
        return Boolean(globalThis.window?.electronBridge?.invoke);
    } catch {
        return false;
    }
};

/** Report whether frontend code can rely on native IPC instead of web-only fallbacks. */
export const isCwsNativeIpcAvailable = (): boolean => {
    if (isElectronCwsNativeShell()) return true;
    // WHY: Capacitor CWSAndroid always has a native bridge once CwsBridgePlugin is registered.
    if (isCapacitorCwsNativeShell()) return true;
    try {
        const shell = globalThis.window?.__CWS_SHELL_INFO__;
        return Boolean(shell?.native);
    } catch {
        return false;
    }
};

/** Opaque channel → Kotlin/Compose (override {@code CwsBridgePlugin.invoke} in CWSAndroid for real routing). */
export async function invokeCwsNative(
    channel: string,
    payload?: Record<string, unknown>
): Promise<CwsBridgeInvokeResult> {
    const envelope = normalizeBridgeEnvelope(channel, payload);
    const result = await CwsBridge.invoke({ channel, payload, envelope });
    return {
        ...result,
        envelope: normalizeInvokeResultEnvelope(channel, payload ?? {}, result)
    };
}

/**
 * Canonical IPC invoker for frontend modules:
 * - Uses CWSAndroid native bridge envelope transport when available
 * - Falls back to web plugin-compatible invoke otherwise
 */
export async function invokeCwsPlatformIPC(input: CwsNativeIpcInput): Promise<CwsBridgeInvokeResult> {
    const channel = (input.channel || "").trim()
        || (Array.isArray(input.envelope?.path) && input.envelope?.path.length
            ? String(input.envelope.path[input.envelope.path.length - 1] || "").trim()
            : "")
        || "default";
    const payload = (input.payload && typeof input.payload === "object") ? input.payload : {};
    const envelope = normalizeBridgeEnvelope(channel, payload, input.envelope);
    const electronInvoke = globalThis.window?.electronBridge?.invoke;
    if (typeof electronInvoke === "function") {
        const result = await electronInvoke({ channel, payload, envelope });
        return {
            ...result,
            envelope: normalizeInvokeResultEnvelope(channel, payload, result)
        };
    }
    if (!isCwsNativeIpcAvailable()) {
        const result = await CwsBridge.invoke({ channel, payload, envelope });
        return {
            ...result,
            envelope: normalizeInvokeResultEnvelope(channel, payload, result)
        };
    }
    try {
        const result = await CwsBridge.invoke({ channel, payload, envelope });
        return {
            ...result,
            envelope: normalizeInvokeResultEnvelope(channel, payload, result)
        };
    } catch (error) {
        console.warn("[cws-bridge] native invoke failed:", error);
        // WHY: On CWSAndroid, web fallback reports ok:true but never writes prefs.db.
        if (isCapacitorCwsNativeShell()) {
            return {
                ok: false,
                channel,
                echo: { ...(payload ?? {}), error: String(error instanceof Error ? error.message : error) },
                envelope: normalizeInvokeResultEnvelope(channel, payload, {
                    ok: false,
                    channel,
                    echo: payload ?? {}
                })
            };
        }
        const web = new CwsBridgeWeb();
        const result = await web.invoke({ channel, payload, envelope });
        return {
            ...result,
            envelope: normalizeInvokeResultEnvelope(channel, payload, result)
        };
    }
}

export async function getNativeUnifiedSettings(): Promise<Record<string, unknown> | null> {
    try {
        const result = await invokeCwsPlatformIPC({ channel: "settings:get" });
        if (!result?.ok) return null;
        return result.appSettings && typeof result.appSettings === "object" ? result.appSettings : null;
    } catch {
        return null;
    }
}

export type NativeSettingsPatchResult = {
    ok: boolean;
    error?: string;
};

/** Patch native-side settings through the same bridge used by transport/runtime configuration. */
export async function patchNativeUnifiedSettings(appSettings: Record<string, unknown>): Promise<boolean> {
    const result = await patchNativeUnifiedSettingsDetailed(appSettings);
    return result.ok;
}

export async function patchNativeUnifiedSettingsDetailed(
    appSettings: Record<string, unknown>
): Promise<NativeSettingsPatchResult> {
    try {
        const blob = appSettingsToRemoteConnectionV1(appSettings);
        const airpadJson = stringifyCwspRemoteConnectionV1(blob);
        const shellPatch = appSettingsShellToNativeExtras(appSettings);

        try {
            globalThis.localStorage?.setItem?.(AIRPAD_REMOTE_CONFIG_STORAGE_KEY, airpadJson);
        } catch {
            /* WebView storage optional */
        }
        try {
            const ch = new BroadcastChannel(CWSP_REMOTE_CONFIG_SYNC_CHANNEL);
            ch.postMessage({ airpadJson, shellPatch });
            ch.close();
        } catch {
            /* optional */
        }

        const result = await withTimeout(
            invokeCwsPlatformIPC({
                channel: "settings:patch",
                payload: { appSettings, airpadJson, shellPatch }
            }),
            6000,
            "settings:patch timed out"
        ).catch((error: unknown) => ({
            ok: false,
            channel: "settings:patch",
            echo: { error: String(error instanceof Error ? error.message : error) }
        }));
        const echo = result?.echo as Record<string, unknown> | undefined;
        const ok =
            result?.ok === true ||
            (result?.ok !== false && !echo?.error && result?.channel === "settings:patch");
        if (!ok) {
            const err = String(echo?.error ?? "settings:patch rejected");
            return { ok: false, error: err };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
}

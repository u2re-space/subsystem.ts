/**
 * Unified CWSP bridge: Capacitor WebView / CWSAndroid (Kotlin) ↔ TypeScript.
 * Native implementation: `runtime/CWSAndroid/plugins/capacitor-cws-bridge/android` (@CapacitorPlugin name CwsBridge).
 */
import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin, WebPlugin } from "@capacitor/core";
import { createProtocolEnvelope, isProtocolEnvelope, normalizeProtocolEnvelope, type UniformProtocolEnvelope } from "fest/uniform";
import { createInteropEnvelope } from "com/core/UniformInterop";

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

export const CwsBridge = registerPlugin<CwsBridgePluginContract>("CwsBridge", {
    web: () => new CwsBridgeWeb()
});

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
    if (!isCapacitorCwsNativeShell()) return false;
    try {
        const shell = globalThis.window?.__CWS_SHELL_INFO__;
        return Boolean(shell?.native);
    } catch {
        return true;
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
    const result = await CwsBridge.invoke({ channel, payload, envelope });
    return {
        ...result,
        envelope: normalizeInvokeResultEnvelope(channel, payload, result)
    };
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

/** Patch native-side settings through the same bridge used by transport/runtime configuration. */
export async function patchNativeUnifiedSettings(appSettings: Record<string, unknown>): Promise<boolean> {
    try {
        const result = await invokeCwsPlatformIPC({ channel: "settings:patch", payload: { appSettings } });
        return Boolean(result?.ok);
    } catch {
        return false;
    }
}

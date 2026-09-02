/*
 * Filename: ingress-host.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/ingress-host.ts
 * FIND:ingress-host
 * TAG:sw-page,sku
 *
 * One page-side inbox for PWA SW, CRX chrome.runtime, and Capacitor/Java mail.
 * INVARIANT: unwrap then ingestSwClientMessage — same verbs as Process SW.
 */
import { bindSwPageBridge, ingestSwClientMessage } from "./sw-page-bridge.ts";

let bound = false;

const applyChromeRuntimeMail = (value: unknown): boolean => ingestSwClientMessage(value);

const applyNativeEvent = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === "string") {
        try {
            return applyNativeEvent(JSON.parse(value) as unknown);
        } catch {
            return ingestSwClientMessage({ type: "share-received", data: { text: value, source: "share-target" } });
        }
    }
    if (typeof value !== "object") return ingestSwClientMessage(value);
    const row = value as Record<string, unknown>;
    const inner = row.payload ?? row.data ?? row.envelope ?? row;
    return ingestSwClientMessage(inner);
};

/** Bind SW + CRX + native inboxes. Idempotent. */
export const bindIngressHosts = (): (() => void) => {
    if (bound) return () => undefined;
    bound = true;
    const unbindSw = bindSwPageBridge();

    const onNative = (event: Event): void => {
        applyNativeEvent((event as CustomEvent<{ payload?: unknown; envelope?: unknown }>).detail);
    };
    globalThis.addEventListener?.("cws-native-message", onNative);

    type ChromeRuntime = {
        id?: string;
        onMessage?: {
            addListener?: (fn: (msg: unknown, _s?: unknown, sendResponse?: (value?: unknown) => void) => boolean) => void;
            removeListener?: (fn: (...args: never[]) => unknown) => void;
        };
    };
    let chromeListener: ((msg: unknown, _s?: unknown, sendResponse?: (value?: unknown) => void) => boolean) | null = null;
    try {
        const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
        if (runtime?.id && runtime.onMessage?.addListener) {
            chromeListener = (msg, _sender, sendResponse) => {
                applyChromeRuntimeMail(msg);
                try {
                    sendResponse?.({ ok: true });
                } catch {
                    /* channel already closed */
                }
                return false;
            };
            runtime.onMessage.addListener(chromeListener);
        }
    } catch {
        /* PWA / Capacitor */
    }

    return () => {
        bound = false;
        unbindSw();
        globalThis.removeEventListener?.("cws-native-message", onNative);
        try {
            const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
            if (chromeListener && runtime?.onMessage?.removeListener) {
                runtime.onMessage.removeListener(chromeListener);
            }
        } catch {
            /* ignore */
        }
    };
};

export { applyChromeRuntimeMail as applyHostMail };

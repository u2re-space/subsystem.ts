/**
 * Chrome extension runtime/broadcast helpers without importing `fest/uniform`.
 * Pulling the full uniform bundle into the MV3 service worker drags Vite preload/DOM
 * and worsens com-app ↔ com-service chunk cycles.
 *
 * Logic mirrors `modules/projects/uniform.ts` newer/utils (Wrappers + index).
 */

type CrxSender = chrome.runtime.MessageSender;
type CrxSendResponse = (response: unknown) => void;
type CrxListener = (event: unknown, sender: CrxSender, sendResponse: CrxSendResponse) => void | Promise<void>;

const runtimeListenerRegistry = new Map<string, Set<CrxListener>>();
let runtimeListenerInstalled = false;

const ensureRuntimeListener = () => {
    if (runtimeListenerInstalled) return;
    runtimeListenerInstalled = true;

    chrome?.runtime?.onMessage?.addListener?.((message: unknown, sender: CrxSender, sendResponse: CrxSendResponse) => {
        const m = message as { channelName?: string; target?: string };
        const channelName = (m?.channelName ?? m?.target) as string | undefined;
        if (!channelName) return;

        const listeners = runtimeListenerRegistry.get(channelName);
        if (!listeners || listeners.size === 0) return;

        const event = {
            data: message,
            origin: sender?.url || "chrome-extension",
            source: sender,
        };

        for (const listener of listeners) {
            try {
                const out = listener(event, sender, sendResponse);
                if (out && typeof (out as Promise<void>)?.catch === "function") {
                    (out as Promise<void>).catch((error) =>
                        console.error("[ChromeExtensionBroadcastChannel] Listener error:", error),
                    );
                }
            } catch (error) {
                console.error("[ChromeExtensionBroadcastChannel] Listener error:", error);
            }
        }

        return true;
    });
};

/**
 * BroadcastChannel-like API over `chrome.runtime` messaging.
 */
export class ChromeExtensionBroadcastChannel {
    private listeners: Set<CrxListener> = new Set();

    constructor(private channelName: string) {
        ensureRuntimeListener();
    }

    addEventListener(
        type: "message",
        listener: (event: unknown, sender: CrxSender, sendResponse: CrxSendResponse) => void | Promise<void>,
    ) {
        if (type !== "message") return;
        this.listeners.add(listener);
        let set = runtimeListenerRegistry.get(this.channelName);
        if (!set) {
            set = new Set();
            runtimeListenerRegistry.set(this.channelName, set);
        }
        set.add(listener);
    }

    removeEventListener(
        type: "message",
        listener: (event: unknown, sender: CrxSender, sendResponse: CrxSendResponse) => void | Promise<void>,
    ) {
        if (type !== "message") return;
        this.listeners.delete(listener);
        runtimeListenerRegistry.get(this.channelName)?.delete(listener);
    }

    postMessage(message: unknown) {
        const messageWithChannel = {
            ...(typeof message === "object" && message != null ? message : { data: message }),
            channelName: this.channelName,
            source: "broadcast-channel",
        };

        chrome?.runtime?.sendMessage?.(messageWithChannel, () => void 0);
    }

    close() {
        for (const listener of this.listeners) {
            runtimeListenerRegistry.get(this.channelName)?.delete(listener);
        }
        this.listeners.clear();
    }
}

export const createChromeExtensionBroadcast = (channelName: string): BroadcastChannel => {
    return new ChromeExtensionBroadcastChannel(channelName) as unknown as BroadcastChannel;
};

const detectChromeExtensionContext = (): boolean => {
    try {
        return typeof chrome !== "undefined" && !!chrome?.runtime?.id;
    } catch {
        return false;
    }
};

/** Minimal WorkerChannel shape used by CrxRuntimeChannel */
export type ChromeExtensionRuntimeChannel = {
    request: (method: string, args?: unknown[]) => Promise<unknown>;
    close: () => void;
};

export const createChromeExtensionRuntimeChannel = (channelName: string, options: { metadata?: Record<string, unknown> } = {}): ChromeExtensionRuntimeChannel => {
    if (!detectChromeExtensionContext()) {
        return {
            async request() {
                throw new Error("Chrome extension messaging not available in this context");
            },
            close() {},
        };
    }
    const context = "chrome-extension";
    return {
        async request(method: string, args: unknown[] = []) {
            return new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage(
                        {
                            id: `crx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                            type: method,
                            source: context,
                            target: channelName,
                            data: args?.length === 1 ? args[0] : args,
                            metadata: { timestamp: Date.now(), ...(options?.metadata ?? {}) },
                        },
                        (response) => {
                            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                            else resolve(response);
                        },
                    );
                } catch (error) {
                    reject(error);
                }
            });
        },
        close() {},
    };
};

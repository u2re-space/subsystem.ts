/*
 * Filename: toast.ts
 * FullPath: modules/projects/subsystem/src/boot/toast.ts
 * Change date and time: 13.35.00_19.07.2026
 * Reason for changes: Fix CRX/content-script toast design — Shadow DOM isolation, no light-dark/@layer.
 */
/**
 * Standalone toast layer (forked from `fl.ui` `misc/Toast.ts`, zero framework deps).
 * Kept in subsystem so CrossWord / PWA / CRX need not import `fest/fl-ui` for toasts.
 *
 * Works in PWA, Chrome extension (content script / popup), and main-thread pages.
 *
 * WHY (CRX): host-page CSS often wins over `@layer` + `light-dark()` styles injected into
 * the light DOM, producing unreadable / “broken” toasts. The layer lives in open Shadow DOM
 * with explicit colors so page styles cannot restyle the pills.
 */

export type ToastKind = "info" | "success" | "warning" | "error";
export type ToastPosition = "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface ToastOptions {
    message: string;
    kind?: ToastKind;
    duration?: number;
    persistent?: boolean;
    position?: ToastPosition;
    onClick?: () => void;
}

export interface ToastLayerConfig {
    containerId?: string;
    position?: ToastPosition;
    maxToasts?: number;
    zIndex?: number;
}

// Default configuration
const DEFAULT_CONFIG: Required<ToastLayerConfig> = {
    containerId: "rs-toast-layer",
    position: "bottom",
    maxToasts: 5,
    zIndex: 2147483647
};

const DEFAULT_DURATION = 3000;
const TRANSITION_DURATION = 200;
/** Suppress the same toast repeating within this window (main thread + broadcast). */
const DEDUPE_WINDOW_MS = 400;

let lastToastFingerprint = "";
let lastToastFingerprintAt = 0;

const toastFingerprint = (opts: ToastOptions): string =>
    `${opts.kind || "info"}\0${opts.position || DEFAULT_CONFIG.position}\0${opts.message}`;

const hasVisibleDuplicate = (layer: HTMLElement, message: string, kind: ToastKind): boolean => {
    for (const el of Array.from(layer?.children ?? [])) {
        if (
            el instanceof HTMLElement &&
            el.classList.contains("rs-toast") &&
            el.getAttribute("data-kind") === kind &&
            el.textContent === message
        ) {
            return true;
        }
    }
    return false;
};

/**
 * Self-contained toast CSS (Shadow DOM).
 * INVARIANT: no `light-dark()`, no `@layer`, no host CSS variables for color —
 * content scripts must look identical on every page.
 */
const TOAST_STYLES = `
:host {
    all: initial !important;
    position: fixed !important;
    inset: 0 !important;
    display: block !important;
    pointer-events: none !important;
    z-index: var(--shell-toast-z, 2147483647) !important;
    overflow: visible !important;
}

.rs-toast-layer {
    position: fixed;
    z-index: 1;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 20px;
    gap: 8px;
    max-block-size: 80dvh;
    max-block-size: 80dvb;
    overflow: hidden;
    box-sizing: border-box;
    margin: 0;
    border: none;
    background: transparent;
}

.rs-toast-layer[data-position="bottom"],
.rs-toast-layer:not([data-position]) {
    inset-block-end: 24px;
    inset-block-start: auto;
    inset-inline: 0;
    justify-content: flex-end;
}

.rs-toast-layer[data-position="top"] {
    inset-block-start: 24px;
    inset-block-end: auto;
    inset-inline: 0;
    justify-content: flex-start;
}

.rs-toast-layer[data-position="top-left"] {
    inset-block-start: 24px;
    inset-inline-start: 16px;
    inset-inline-end: auto;
    align-items: flex-start;
}

.rs-toast-layer[data-position="top-right"] {
    inset-block-start: 24px;
    inset-inline-end: 16px;
    inset-inline-start: auto;
    align-items: flex-end;
}

.rs-toast-layer[data-position="bottom-left"] {
    inset-block-end: 24px;
    inset-inline-start: 16px;
    inset-inline-end: auto;
    align-items: flex-start;
}

.rs-toast-layer[data-position="bottom-right"] {
    inset-block-end: 24px;
    inset-inline-end: 16px;
    inset-inline-start: auto;
    align-items: flex-end;
}

.rs-toast {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 14px;
    max-inline-size: min(90vw, 28rem);
    inline-size: fit-content;
    min-block-size: 2.25rem;
    box-sizing: border-box;

    border-radius: 10px;
    border: 1px solid rgba(248, 250, 252, 0.14);
    background-color: #0f172a;
    color: #f8fafc;
    box-shadow: 0 10px 28px rgba(2, 6, 23, 0.45);

    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    text-align: center;

    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;

    opacity: 0;
    transform: translateY(12px) scale(0.96);
    transition:
        opacity 180ms ease-out,
        transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.rs-toast[data-visible] {
    opacity: 1;
    transform: translateY(0) scale(1);
}

.rs-toast:active {
    transform: scale(0.98);
}

.rs-toast[data-kind="info"] {
    background-color: #0f172a;
    color: #f8fafc;
    border-color: rgba(148, 163, 184, 0.35);
}

.rs-toast[data-kind="success"] {
    background-color: #166534;
    color: #f0fdf4;
    border-color: rgba(187, 247, 208, 0.35);
}

.rs-toast[data-kind="warning"] {
    background-color: #b45309;
    color: #fffbeb;
    border-color: rgba(253, 230, 138, 0.4);
}

.rs-toast[data-kind="error"] {
    background-color: #b91c1c;
    color: #fef2f2;
    border-color: rgba(254, 202, 202, 0.4);
}

@media (prefers-reduced-motion: reduce) {
    .rs-toast,
    .rs-toast[data-visible] {
        transition-duration: 0ms;
        transform: none;
    }
}

@media print {
    :host,
    .rs-toast-layer,
    .rs-toast {
        display: none !important;
    }
}
`;

// Toast layer instances per config (points at the flex container inside the shadow root)
const toastLayers = new Map<string, HTMLElement>();
const toastHosts = new Map<string, HTMLElement>();

type ToastMount = {
    host: HTMLElement;
    layer: HTMLElement;
};

/**
 * Get or create an isolated toast mount (host + Shadow DOM layer).
 */
const getToastMount = (config: Required<ToastLayerConfig>, doc: Document = document): ToastMount => {
    const key = `${config.containerId}-${config.position}`;

    const cachedLayer = toastLayers.get(key);
    const cachedHost = toastHosts.get(key);
    if (cachedLayer?.isConnected && cachedHost?.isConnected) {
        cachedLayer.setAttribute("data-position", config.position);
        cachedHost.style.setProperty("--shell-toast-z", String(config.zIndex));
        return { host: cachedHost, layer: cachedLayer };
    }

    toastLayers.delete(key);
    toastHosts.delete(key);

    let host = doc.getElementById(config.containerId);
    if (!host) {
        host = doc.createElement("div");
        host.id = config.containerId;
        // WHY: light-DOM host still needs a hardened box — some pages style bare divs aggressively.
        host.setAttribute("data-cwsp-toast-host", "");
        host.style.cssText = [
            "all: initial",
            "position: fixed",
            "inset: 0",
            "display: block",
            "pointer-events: none",
            `z-index: ${config.zIndex}`,
            "overflow: visible",
            "margin: 0",
            "padding: 0",
            "border: none",
            "background: transparent",
        ].join(";");
        (doc.body || doc.documentElement).appendChild(host);
    }

    host.style.setProperty("--shell-toast-z", String(config.zIndex));

    let shadow = host.shadowRoot;
    if (!shadow) {
        shadow = host.attachShadow({ mode: "open" });
    }

    let styleEl = shadow.querySelector("style[data-rs-toast]") as HTMLStyleElement | null;
    if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.setAttribute("data-rs-toast", "");
        styleEl.textContent = TOAST_STYLES;
        shadow.insertBefore(styleEl, shadow.firstChild);
    } else {
        // Refresh styles when toast module is updated / SW reloads content script.
        styleEl.textContent = TOAST_STYLES;
    }

    let layer = shadow.querySelector(".rs-toast-layer") as HTMLElement | null;
    if (!layer) {
        layer = doc.createElement("div");
        layer.className = "rs-toast-layer";
        layer.setAttribute("aria-live", "polite");
        layer.setAttribute("aria-atomic", "true");
        shadow.appendChild(layer);
    }

    layer.setAttribute("data-position", config.position);

    toastLayers.set(key, layer);
    toastHosts.set(key, host);
    return { host, layer };
};

/**
 * Broadcast toast to all clients (for service worker context)
 */
const broadcastToast = (options: ToastOptions): void => {
    try {
        const channel = new BroadcastChannel("rs-toast");
        channel.postMessage({ type: "show-toast", options });
        channel.close();
    } catch (e) {
        console.warn("[Toast] Broadcast failed:", e);
    }
};

/**
 * Create and show a toast notification
 *
 * @param options - Toast options object or message string
 * @returns The created toast element, or null if in service worker context
 */
export const showToast = (options: ToastOptions | string): HTMLElement | null => {
    // Handle string shorthand
    const opts: ToastOptions = typeof options === "string" ? { message: options } : options;

    const {
        message,
        kind = "info",
        duration = DEFAULT_DURATION,
        persistent = false,
        position = DEFAULT_CONFIG.position,
        onClick
    } = opts;

    // Validate message
    if (!message) return null;

    const fp = toastFingerprint(opts);
    const now = Date.now();
    if (fp === lastToastFingerprint && now - lastToastFingerprintAt < DEDUPE_WINDOW_MS) {
        return null;
    }

    // Check for document availability (service worker context)
    if (typeof document === "undefined") {
        lastToastFingerprint = fp;
        lastToastFingerprintAt = now;
        broadcastToast(opts);
        return null;
    }

    const config: Required<ToastLayerConfig> = {
        ...DEFAULT_CONFIG,
        position
    };

    const { layer } = getToastMount(config);

    if (hasVisibleDuplicate(layer, message, kind)) {
        lastToastFingerprint = fp;
        lastToastFingerprintAt = now;
        return null;
    }

    lastToastFingerprint = fp;
    lastToastFingerprintAt = now;

    // Limit number of toasts
    while (layer.children.length >= config.maxToasts) {
        layer.firstChild?.remove();
    }

    // Create toast element
    const toast = document.createElement("div");
    toast.className = "rs-toast";
    toast.setAttribute("data-kind", kind);
    toast.setAttribute("role", kind === "error" || kind === "warning" ? "alert" : "status");
    toast.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    toast.textContent = message;

    layer.appendChild(toast);

    // Trigger enter animation
    globalThis?.requestAnimationFrame?.(() => {
        toast.setAttribute("data-visible", "");
    });

    let hideTimer: number | null = null;

    const removeToast = () => {
        if (hideTimer !== null) {
            globalThis.clearTimeout(hideTimer);
            hideTimer = null;
        }
        toast.removeAttribute("data-visible");
        globalThis?.setTimeout?.(() => {
            toast.remove();
            // Clean up mount maps if empty (keep host for reuse)
            if (!layer.childElementCount) {
                const key = `${config.containerId}-${config.position}`;
                toastLayers.delete(key);
            }
        }, TRANSITION_DURATION);
    };

    // Auto-remove after duration (unless persistent)
    if (!persistent) {
        hideTimer = globalThis?.setTimeout?.(removeToast, duration);
    }

    // Click handler (dismisses toast)
    toast.addEventListener("click", () => {
        onClick?.();
        removeToast();
    });

    // Pointer down handler (dismisses toast on tap/click)
    toast.addEventListener("pointerdown", () => {
        if (hideTimer !== null) {
            globalThis.clearTimeout(hideTimer);
            hideTimer = null;
        }
        removeToast();
    }, { once: true });

    return toast;
};

/**
 * Convenience methods for different toast kinds
 */
export const showSuccess = (message: string, duration?: number): HTMLElement | null =>
    showToast({ message, kind: "success", duration });

export const showError = (message: string, duration?: number): HTMLElement | null =>
    showToast({ message, kind: "error", duration });

export const showWarning = (message: string, duration?: number): HTMLElement | null =>
    showToast({ message, kind: "warning", duration });

export const showInfo = (message: string, duration?: number): HTMLElement | null =>
    showToast({ message, kind: "info", duration });

/**
 * Listen for toast broadcasts (call in main thread contexts)
 *
 * @returns Cleanup function to stop listening
 */
export const listenForToasts = (): (() => void) => {
    if (typeof BroadcastChannel === "undefined") return () => {};

    const channel = new BroadcastChannel("rs-toast");
    const handler = (event: MessageEvent) => {
        if (event.data?.type === "show-toast" && event.data?.options) {
            showToast(event.data.options);
        }
    };
    channel.addEventListener("message", handler);
    return () => {
        channel.removeEventListener("message", handler);
        channel.close();
    };
};

/**
 * Clear all toasts from a layer
 *
 * @param position - Position of the layer to clear (default: "bottom")
 */
export const clearToasts = (position: ToastPosition = DEFAULT_CONFIG.position): void => {
    const key = `${DEFAULT_CONFIG.containerId}-${position}`;
    const layer = toastLayers.get(key);
    if (layer) {
        layer.innerHTML = "";
    }
};

/**
 * Initialize toast listener for receiving broadcasts
 * Call this in main thread contexts (content scripts, popup, etc.)
 *
 * @returns Cleanup function to stop listening
 */
export const initToastReceiver = (): (() => void) => {
    return listenForToasts();
};

/**
 * Close and remove toast layer
 *
 * @param position - Position of the layer to close (default: "bottom")
 */
export const closeToastLayer = (position: ToastPosition = DEFAULT_CONFIG.position): void => {
    const key = `${DEFAULT_CONFIG.containerId}-${position}`;
    const host = toastHosts.get(key);
    const layer = toastLayers.get(key);
    if (layer) {
        layer.remove();
        toastLayers.delete(key);
    }
    if (host) {
        host.remove();
        toastHosts.delete(key);
    }
};

// Default export for convenience
export default {
    show: showToast,
    success: showSuccess,
    error: showError,
    warning: showWarning,
    info: showInfo,
    clear: clearToasts,
    close: closeToastLayer,
    listen: listenForToasts,
    init: initToastReceiver
};

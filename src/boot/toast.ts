/**
 * Standalone toast layer (forked from `fl.ui` `misc/Toast.ts`, zero framework deps).
 * Kept in subsystem so CrossWord / PWA / CRX need not import `fest/fl-ui` for toasts.
 *
 * Works in PWA, Chrome extension (content script / popup), and main-thread pages.
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

// Toast CSS styles (inlined for isolation)
const TOAST_STYLES = `
@layer viewer-toast {
    .rs-toast-layer {
        position: fixed;
        z-index: var(--shell-toast-z, 2147483647);
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1rem;
        gap: 0.5rem;
        max-block-size: 80dvb;
        overflow: hidden;
        box-sizing: border-box;
    }

    .rs-toast-layer[data-position="bottom"],
    .rs-toast-layer:not([data-position]) {
        inset-block-end: 10dvb;
        inset-inline: 0;
        justify-content: flex-end;
    }

    .rs-toast-layer[data-position="top"] {
        inset-block-start: 10dvb;
        inset-inline: 0;
        justify-content: flex-start;
    }

    .rs-toast-layer[data-position="top-left"] {
        inset-block-start: 10dvb;
        inset-inline-start: 0;
        align-items: flex-start;
    }

    .rs-toast-layer[data-position="top-right"] {
        inset-block-start: 10dvb;
        inset-inline-end: 0;
        align-items: flex-end;
    }

    .rs-toast-layer[data-position="bottom-left"] {
        inset-block-end: 10dvb;
        inset-inline-start: 0;
        align-items: flex-start;
    }

    .rs-toast-layer[data-position="bottom-right"] {
        inset-block-end: 10dvb;
        inset-inline-end: 0;
        align-items: flex-end;
    }

    .rs-toast {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        max-inline-size: min(90vw, 32rem);
        inline-size: fit-content;

        border-radius: var(--toast-radius, 0.5rem);
        background-color: var(--toast-bg, light-dark(#fafbfc, #1e293b));
        box-shadow: var(--toast-shadow, 0 6px 14px rgba(0, 0, 0, 0.45));
        backdrop-filter: blur(12px) saturate(140%);
        color: var(--toast-text, light-dark(#000000, #ffffff));

        font-family: var(--toast-font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: var(--toast-font-size, 0.875rem);
        font-weight: var(--toast-font-weight, 500);
        letter-spacing: 0.01em;
        line-height: 1.4;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;

        pointer-events: auto;
        user-select: none;
        cursor: default;

        opacity: 0;
        transform: translateY(100%) scale(0.9);
        transition:
            opacity 160ms ease-out,
            transform 160ms cubic-bezier(0.16, 1, 0.3, 1),
            background-color 100ms ease;
    }

    .rs-toast[data-visible] {
        opacity: 1;
        transform: translateY(0) scale(1);
    }

    .rs-toast:active {
        transform: scale(0.98);
    }

    .rs-toast[data-kind="success"] {
        --toast-bg: var(--color-success, var(--color-success, #22c55e));
    }

    .rs-toast[data-kind="warning"] {
        --toast-bg: var(--color-warning, var(--color-warning, #f59e0b));
    }

    .rs-toast[data-kind="error"] {
        --toast-bg: var(--color-error, var(--color-error, #ef4444));
    }

    @media (prefers-reduced-motion: reduce) {
        .rs-toast,
        .rs-toast[data-visible] {
            transition-duration: 0ms;
            transform: none;
        }
    }

    @media print {
        .rs-toast-layer, .rs-toast {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            position: absolute !important;
            inset: 0 !important;
            z-index: -1 !important;
            inline-size: 0 !important;
            block-size: 0 !important;
            max-inline-size: 0 !important;
            max-block-size: 0 !important;
            min-inline-size: 0 !important;
            min-block-size: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            overflow: hidden !important;
        }
    }
}
`;

// Track style injection per document
const injectedDocs = new WeakSet<Document>();

// Toast layer instances per config
const toastLayers = new Map<string, HTMLElement>();

/**
 * Ensure styles are injected into the document
 */
const ensureStyles = (doc: Document = document): void => {
    if (injectedDocs.has(doc)) return;

    const style = doc.createElement("style");
    style.id = "__rs-toast-styles__";
    style.textContent = TOAST_STYLES;
    (doc.head || doc.documentElement).appendChild(style);
    injectedDocs.add(doc);
};

/**
 * Get or create a toast layer container
 */
const getToastLayer = (config: Required<ToastLayerConfig>, doc: Document = document): HTMLElement => {
    const key = `${config.containerId}-${config.position}`;

    if (toastLayers.has(key)) {
        const existing = toastLayers.get(key)!;
        if (existing.isConnected) return existing;
        toastLayers.delete(key);
    }

    ensureStyles(doc);

    let layer = doc.getElementById(config.containerId);
    if (!layer) {
        layer = doc.createElement("div");
        layer.id = config.containerId;
        layer.className = "rs-toast-layer";
        layer.setAttribute("aria-live", "polite");
        layer.setAttribute("aria-atomic", "true");
        // Content scripts may run at document_start before <body> exists.
        (doc.body || doc.documentElement).appendChild(layer);
    }

    layer.setAttribute("data-position", config.position);
    layer.style.setProperty("--shell-toast-z", String(config.zIndex));

    toastLayers.set(key, layer);
    return layer;
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

    const layer = getToastLayer(config);

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
            // Clean up layer if empty
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
    const layer = toastLayers.get(key);
    if (layer) {
        layer.remove();
        toastLayers.delete(key);
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

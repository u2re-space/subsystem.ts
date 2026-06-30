/**
 * Unified Overlay System
 * Standalone, works in: PWA, Chrome Extension content scripts, vanilla JS
 * Provides overlay, selection box, hints, and integrated toast/clipboard
 */

import { initClipboardReceiver } from "core/modules/Clipboard";
import { showToast as toastShow, initToastReceiver, type ToastOptions } from "./toast";

export interface OverlayConfig {
    prefix?: string;
    zIndex?: number;
}

export interface OverlayElements {
    overlay: HTMLDivElement | null;
    box: HTMLDivElement | null;
    hint: HTMLDivElement | null;
    sizeBadge: HTMLDivElement | null;
    toast: HTMLDivElement | null;
}

const DEFAULT_CONFIG: Required<OverlayConfig> = {
    prefix: "sel-dom",
    zIndex: 2147483647
};

const createOverlayStyles = (prefix: string, zIndex: number): string => `
html > .${prefix}-overlay,
body > .${prefix}-overlay,
.${prefix}-overlay[popover] {
    position: fixed !important;
    inset: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    background-color: transparent !important;
    background-image: none !important;
    z-index: ${zIndex} !important;
    display: none;
    visibility: hidden;
    pointer-events: none;
    box-sizing: border-box !important;
    inline-size: 100vw !important;
    block-size: 100vh !important;
    max-inline-size: 100vw !important;
    max-block-size: 100vh !important;
    overflow: visible !important;
    cursor: crosshair !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-user-drag: none !important;
    outline: none !important;
}

html > .${prefix}-overlay:popover-open,
body > .${prefix}-overlay:popover-open,
.${prefix}-overlay[popover]:popover-open {
    display: block !important;
    visibility: visible !important;
    pointer-events: auto !important;
}

html > .${prefix}-overlay::backdrop,
body > .${prefix}-overlay::backdrop,
.${prefix}-overlay[popover]::backdrop {
    position: fixed !important;
    inset: 0 !important;
    background: rgba(0, 0, 0, 0.35) !important;
    pointer-events: auto !important;
    cursor: crosshair !important;
    z-index: ${zIndex - 1} !important;
}

.${prefix}-overlay .${prefix}-box,
.${prefix}-box {
    position: fixed !important;
    overflow: visible !important;
    border: 2px solid #4da3ff !important;
    background: rgba(77, 163, 255, 0.15) !important;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4) !important;
    pointer-events: none !important;
    -webkit-user-drag: none !important;
    box-sizing: border-box !important;
    z-index: 1 !important;
}

.${prefix}-overlay .${prefix}-hint,
.${prefix}-hint {
    position: fixed !important;
    inset-inline-start: 50% !important;
    inset-block-start: 50% !important;
    transform: translate(-50%, -50%) !important;
    background: rgba(0, 0, 0, 0.8) !important;
    color: #fff !important;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif !important;
    padding: 10px 16px !important;
    border-radius: 8px !important;
    pointer-events: none !important;
    -webkit-user-drag: none !important;
    inline-size: max-content !important;
    block-size: max-content !important;
    z-index: 2 !important;
    white-space: nowrap !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4) !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
}

.${prefix}-hint:empty {
    display: none !important;
    visibility: hidden !important;
}

.${prefix}-overlay .${prefix}-size-badge,
.${prefix}-box .${prefix}-size-badge,
.${prefix}-size-badge {
    position: absolute !important;
    transform: translate(6px, 6px) !important;
    background: #1e293b !important;
    color: #fff !important;
    font: 11px/1.3 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace !important;
    padding: 4px 8px !important;
    border-radius: 4px !important;
    pointer-events: none !important;
    -webkit-user-drag: none !important;
    inline-size: max-content !important;
    block-size: max-content !important;
    z-index: 3 !important;
    white-space: nowrap !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
}

.${prefix}-size-badge:empty {
    display: none !important;
    visibility: hidden !important;
}

html > .${prefix}-toast,
body > .${prefix}-toast,
.${prefix}-toast {
    position: fixed !important;
    inset-inline-start: 50% !important;
    inset-block-end: 24px !important;
    inset-block-start: auto !important;
    inset-inline-end: auto !important;
    transform: translateX(-50%) !important;
    background: rgba(0, 0, 0, 0.9) !important;
    color: #fff !important;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif !important;
    padding: 10px 16px !important;
    border-radius: 8px !important;
    pointer-events: none !important;
    -webkit-user-drag: none !important;
    inline-size: max-content !important;
    block-size: max-content !important;
    z-index: ${zIndex} !important;
    white-space: nowrap !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
    opacity: 0;
    visibility: hidden;
    transition: opacity 200ms ease-out, visibility 200ms ease-out !important;
    margin: 0 !important;
    border: none !important;
    box-sizing: border-box !important;
}

.${prefix}-toast.is-visible {
    opacity: 1 !important;
    visibility: visible !important;
}

.${prefix}-toast:empty {
    display: none !important;
}
`;

const injectedDocs = new WeakSet<Document>();
const overlayInstances = new Map<string, OverlayElements>();

let _receiversInitialized = false;

const initReceivers = (): void => {
    if (_receiversInitialized) return;
    _receiversInitialized = true;
    initToastReceiver();
    initClipboardReceiver();
};

const injectStyles = (config: Required<OverlayConfig>, doc: Document = document): void => {
    if (injectedDocs.has(doc)) return;

    const styleId = `__${config.prefix}-styles__`;
    if (doc.getElementById(styleId)) {
        injectedDocs.add(doc);
        return;
    }

    const style = doc.createElement("style");
    style.id = styleId;
    style.textContent = createOverlayStyles(config.prefix, config.zIndex);
    (doc.head || doc.documentElement).appendChild(style);
    injectedDocs.add(doc);
};

const createElements = (config: Required<OverlayConfig>, doc: Document = document): OverlayElements => {
    const key = config.prefix;

    if (overlayInstances.has(key)) {
        const existing = overlayInstances.get(key)!;
        if (existing.overlay?.isConnected) return existing;
        overlayInstances.delete(key);
    }

    // Avoid injecting overlay nodes during document_start before <html> is fully wired.
    if (!doc?.documentElement) {
        return { overlay: null, box: null, hint: null, sizeBadge: null, toast: null };
    }

    injectStyles(config, doc);
    initReceivers();

    const overlay = doc.createElement("div");
    overlay.className = `${config.prefix}-overlay`;
    overlay.draggable = false;
    overlay.tabIndex = -1;
    overlay.popover = "manual";

    const box = doc.createElement("div");
    box.className = `${config.prefix}-box`;
    box.tabIndex = -1;

    const hint = doc.createElement("div");
    hint.className = `${config.prefix}-hint`;
    hint.textContent = "Select area. Esc — cancel";
    hint.tabIndex = -1;

    const sizeBadge = doc.createElement("div");
    sizeBadge.className = `${config.prefix}-size-badge`;
    sizeBadge.textContent = "";
    sizeBadge.tabIndex = -1;

    const toast = doc.createElement("div");
    toast.className = `${config.prefix}-toast`;
    toast.tabIndex = -1;

    box.appendChild(sizeBadge);
    overlay.appendChild(box);
    overlay.appendChild(hint);

    doc.documentElement.appendChild(toast);
    doc.documentElement.appendChild(overlay);

    toast.addEventListener("transitionend", () => {
        if (!toast.classList.contains("is-visible")) {
            toast.textContent = "";
        }
    });

    const elements: OverlayElements = { overlay, box, hint, sizeBadge, toast };
    overlayInstances.set(key, elements);

    return elements;
};

export const getOverlayElements = (config?: Partial<OverlayConfig>): OverlayElements => {
    const fullConfig: Required<OverlayConfig> = { ...DEFAULT_CONFIG, ...config };

    if (typeof document === "undefined") {
        return { overlay: null, box: null, hint: null, sizeBadge: null, toast: null };
    }

    return createElements(fullConfig);
};

export const getOverlay = (config?: Partial<OverlayConfig>): HTMLDivElement | null =>
    getOverlayElements(config).overlay;

export const getBox = (config?: Partial<OverlayConfig>): HTMLDivElement | null =>
    getOverlayElements(config).box;

export const getHint = (config?: Partial<OverlayConfig>): HTMLDivElement | null =>
    getOverlayElements(config).hint;

export const getSizeBadge = (config?: Partial<OverlayConfig>): HTMLDivElement | null =>
    getOverlayElements(config).sizeBadge;

export const getToast = (config?: Partial<OverlayConfig>): HTMLDivElement | null =>
    getOverlayElements(config).toast;

export const showToast = (text: string | ToastOptions, config?: Partial<OverlayConfig>): void => {
    if (typeof text === "object") {
        toastShow(text);
        return;
    }

    try {
        toastShow({ message: text, kind: "info", duration: 1800 });
    } catch {
        const elements = getOverlayElements(config);
        const toast = elements.toast;
        if (!toast) return;

        if (!toast.classList.contains("is-visible")) {
            toast.classList.add("is-visible");
        }

        if (toast.textContent === text) return;
        toast.textContent = text;

        setTimeout(() => {
            if (toast.textContent !== text) return;
            toast.classList.remove("is-visible");
        }, 1800);
    }
};

export const showSelection = (config?: Partial<OverlayConfig>): void => {
    const elements = getOverlayElements(config);
    const { overlay, box, sizeBadge } = elements;
    if (!overlay || !box) return;

    try {
        (overlay as any).showPopover?.();
    } catch (e) {
        console.warn("[Overlay] showPopover failed:", e);
    }

    overlay.style.setProperty("display", "block", "important");

    box.style.left = "0px";
    box.style.top = "0px";
    box.style.width = "0px";
    box.style.height = "0px";

    if (sizeBadge) sizeBadge.textContent = "";
};

export const hideSelection = (config?: Partial<OverlayConfig>): void => {
    const elements = getOverlayElements(config);
    const { overlay, box, sizeBadge } = elements;
    if (!overlay) return;

    overlay.style.removeProperty("display");

    try {
        (overlay as any).hidePopover?.();
    } catch (e) {
        console.warn("[Overlay] hidePopover failed:", e);
    }

    if (box) {
        box.style.left = "0px";
        box.style.top = "0px";
        box.style.width = "0px";
        box.style.height = "0px";
    }

    if (sizeBadge) {
        sizeBadge.textContent = "";
    }
};

export const updateBox = (
    x: number,
    y: number,
    width: number,
    height: number,
    config?: Partial<OverlayConfig>
): void => {
    const elements = getOverlayElements(config);
    const { box, sizeBadge } = elements;
    if (!box) return;

    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

    if (sizeBadge) {
        sizeBadge.textContent = `${Math.round(width)} × ${Math.round(height)}`;
        sizeBadge.style.left = `${width}px`;
        sizeBadge.style.top = `${height}px`;
    }
};

export const setHint = (text: string, config?: Partial<OverlayConfig>): void => {
    const elements = getOverlayElements(config);
    if (elements.hint) {
        elements.hint.textContent = text;
    }
};

/** Prepare overlay CSS/receivers only; DOM nodes are created on first snip/toast use. */
export const initOverlay = (config?: Partial<OverlayConfig>): OverlayElements => {
    if (typeof document === "undefined") {
        return { overlay: null, box: null, hint: null, sizeBadge: null, toast: null };
    }
    const fullConfig: Required<OverlayConfig> = { ...DEFAULT_CONFIG, ...config };
    injectStyles(fullConfig, document);
    initReceivers();
    return { overlay: null, box: null, hint: null, sizeBadge: null, toast: null };
};

// Legacy proxy exports for backward compatibility
export const overlay = new Proxy({} as HTMLDivElement, {
    get: (_, prop) => (getOverlay() as any)?.[prop],
    set: (_, prop, value) => { const o = getOverlay(); if (o) (o as any)[prop] = value; return true; }
});

export const box = new Proxy({} as HTMLDivElement, {
    get: (_, prop) => (getBox() as any)?.[prop],
    set: (_, prop, value) => { const b = getBox(); if (b) (b as any)[prop] = value; return true; }
});

export const hint = new Proxy({} as HTMLDivElement, {
    get: (_, prop) => (getHint() as any)?.[prop],
    set: (_, prop, value) => { const h = getHint(); if (h) (h as any)[prop] = value; return true; }
});

export const sizeBadge = new Proxy({} as HTMLDivElement, {
    get: (_, prop) => (getSizeBadge() as any)?.[prop],
    set: (_, prop, value) => { const s = getSizeBadge(); if (s) (s as any)[prop] = value; return true; }
});

export default {
    getElements: getOverlayElements,
    showToast,
    showSelection,
    hideSelection,
    updateBox,
    setHint,
    init: initOverlay,
    getOverlay,
    getBox,
    getHint,
    getSizeBadge,
    getToast
};

// Intentionally no eager DOM injection: content scripts should only add overlay/toast nodes when used.

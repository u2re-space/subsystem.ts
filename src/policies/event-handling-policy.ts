/**
 * Shared rules for UI event handlers:
 * - Do not use stopImmediatePropagation unless one listener must exclude every other on the same target.
 * - Prefer stopPropagation only to block bubble to known parents (stacked overlays, toolbars).
 * - Avoid document/window capture listeners that call stop* unless strictly scoped to a feature.
 * - Use passive: true when preventDefault is never called.
 */
export function stopBubbling(ev: Event): void {
    ev.stopPropagation();
}

/**
 * Wait until after the next two animation frames so layout/style for freshly inserted nodes
 * is flushed before querying the DOM and attaching listeners (Airpad, overlays, keyboard).
 */
export function waitForDomPaint(): Promise<void> {
    const raf = globalThis.requestAnimationFrame?.bind(globalThis);
    if (typeof raf !== "function") {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        raf(() => {
            raf(() => resolve());
        });
    });
}

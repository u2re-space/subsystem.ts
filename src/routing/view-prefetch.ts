import { ENABLED_VIEW_IDS } from "./views";
import { ViewRegistry } from "./registry";
import type { ViewId } from "shells/types";

/**
 * Low-priority prefetch of view chunks after the focused view is interactive.
 */
function scheduleIdle(fn: () => void, timeoutMs: number): void {
    if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(fn, { timeout: timeoutMs });
    } else {
        globalThis.setTimeout?.(fn, 32);
    }
}

/**
 * Stagger dynamic imports for non-current views so the next navigation is faster
 * without competing with the active view's work.
 */
export function scheduleViewModulePrefetch(currentViewId: ViewId): void {
    const others = ENABLED_VIEW_IDS.filter((id) => id !== currentViewId);
    if (others.length === 0) return;

    let index = 0;
    const step = (): void => {
        const id = others[index++];
        if (!id) return;
        ViewRegistry.prefetchModule(id);
        scheduleIdle(step, 6000);
    };

    scheduleIdle(step, 2500);
}

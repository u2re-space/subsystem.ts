/**
 * View Transition API utilities for shell/view navigation.
 *
 * Wraps `document.startViewTransition()` (Chrome 111+) with:
 *  - Graceful no-op fallback for unsupported browsers
 *  - Direction detection (forward/backward) based on view order
 *  - CSS custom-property bridge so `::view-transition-old/new(active-view)`
 *    can select the correct keyframe via `var(--vt-old-anim)` / `var(--vt-new-anim)`
 *  - Optional Level 2 `types` array (Chrome 125+) for richer CSS targeting
 *
 * CSS side: assign `view-transition-name: active-view` to the currently
 * visible `[data-view]` element, e.g.:
 *
 *   [data-shell-content] > [data-view]:not([hidden]) {
 *     view-transition-name: active-view;
 *   }
 */

export type ViewTransitionDirection = "forward" | "backward" | "fade";

export interface ViewTransitionOptions {
    /** Navigation direction hint for directional slide animations. */
    direction?: ViewTransitionDirection;
    /**
     * CSS View Transitions Level 2 type labels (Chrome 125+).
     * Exposed via `:active-view-transition-type()` in CSS.
     */
    types?: string[];
    /**
     * Runs after the outgoing pseudo-element animation settles (best-effort), or after two
     * consecutive `requestAnimationFrame` callbacks when View Transitions are unsupported.
     * Used to defer view teardown such as dropping document-level adopted stylesheets.
     */
    onTransitionFinished?: () => void;
}

// ─── Minimal typings for the View Transition API ─────────────────────────────

interface ViewTransition {
    /** Resolves after the transition animation finishes. */
    readonly finished: Promise<void>;
    /** Resolves once old/new snapshots are captured and animation is ready. */
    readonly ready: Promise<void>;
    /** Resolves once the update callback has completed. */
    readonly updateCallbackDone: Promise<void>;
    /** Skip the animation and jump straight to the end state. */
    skipTransition(): void;
}

type VTUpdateFn = () => void | Promise<void>;

interface DocumentWithVT extends Document {
    startViewTransition(updateOrOpts: VTUpdateFn | { update: VTUpdateFn; types?: string[] }): ViewTransition;
}

// ─── View order ──────────────────────────────────────────────────────────────

/**
 * Canonical view order used to determine navigation direction.
 * Earlier index = "back", later index = "forward".
 */
export const VIEW_ORDER = [
    "home",
    "viewer",
    "editor",
    "explorer",
    "workcenter",
    "airpad",
    "history",
    "settings",
    "print",
] as const;

type KnownView = (typeof VIEW_ORDER)[number];

// ─── Feature detection ───────────────────────────────────────────────────────

/** `true` when `document.startViewTransition` is available (Chrome 111+). */
export const supportsViewTransitions = (): boolean =>
    typeof document !== "undefined" && "startViewTransition" in document;

// ─── Direction helpers ───────────────────────────────────────────────────────

/**
 * Compute navigation direction based on the ordered view list.
 *
 * Unknown view IDs fall back to `"fade"` (no slide animation).
 */
export function getTransitionDirection(from: string, to: string): ViewTransitionDirection {
    const fi = (VIEW_ORDER as readonly string[]).indexOf(from);
    const ti = (VIEW_ORDER as readonly string[]).indexOf(to);
    if (fi === -1 || ti === -1 || fi === ti) return "fade";
    return fi < ti ? "forward" : "backward";
}

// ─── Main utility ────────────────────────────────────────────────────────────

/**
 * Wrap a DOM mutation in a View Transition, with a transparent fallback.
 *
 * Before starting the transition, `data-vt-direction` is set on `:root` so
 * CSS `::view-transition-old/new(active-view)` can select the right keyframe
 * animation via inherited CSS custom properties.
 *
 * If a transition is already running, the browser will abort the previous one
 * and start the new one — this is intentional and handled gracefully.
 */
export async function withViewTransition(
    update: VTUpdateFn,
    options: ViewTransitionOptions = {},
): Promise<void> {
    const finishOnce = (): void => {
        try {
            options.onTransitionFinished?.();
        } catch (error) {
            console.warn("[view-transition] onTransitionFinished error:", error);
        }
    };
    let finishedCalled = false;
    const guardedFinish = (): void => {
        if (finishedCalled) return;
        finishedCalled = true;
        finishOnce();
    };

    if (!supportsViewTransitions()) {
        await update();
        requestAnimationFrame(() => requestAnimationFrame(guardedFinish));
        return;
    }

    const { direction = "fade", types } = options;

    // Bridge direction to CSS custom properties via a data attribute on :root.
    document.documentElement.dataset.vtDirection = direction;

    const doc = document as DocumentWithVT;

    // Use Level 2 types API when types are provided (Chrome 125+).
    const transition =
        types?.length
            ? doc.startViewTransition({ update, types })
            : doc.startViewTransition(update);

    void transition.finished.then(guardedFinish).catch(guardedFinish);
    globalThis.setTimeout?.(() => guardedFinish(), 1400);

    try {
        // Wait only until the DOM update callback settles. `finished` can stall in some Chromium
        // builds when transitions overlap or animations never complete, which blocks shell
        // `navigate()` and leaves the shell spinner / blank content indefinitely.
        const settled =
            (transition as ViewTransition & { updateCallbackDone?: Promise<void> })
                .updateCallbackDone ?? transition.finished;
        await settled;
    } catch {
        // Expected when a subsequent navigation aborts this transition.
    } finally {
        delete document.documentElement.dataset.vtDirection;
    }
    void transition.finished.catch(() => {
        // Let the visual transition finish without blocking routing/boot.
    });
}

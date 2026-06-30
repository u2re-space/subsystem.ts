/**
 * Light-DOM `slot` assignments for `cw-shell-*` hosts. Layouts project these into shadow `<slot>` nodes.
 *
 * - `content`: default (unnamed) slot — routed views and most UI.
 * - `underlying`: behind content (wallpaper, canvas, speed dial / home when shell hosts them).
 * - `overlay`: above content (toasts, dialogs, menus, tooltips — assign in consuming code).
 *
 * NOTE: Content script shell omits the underlying layer. **Window frames** (`wf-frame`) are not shells:
 * imperative or slotted overlay UI must mount under the parent `cw-shell-*` `[data-shell-overlays]` layer
 * (use {@link resolveOverlayMountPoint} / {@link resolveShellOverlaysMount}).
 */
export const SHELL_SLOT = {
    underlying: "underlying",
    overlay: "overlay",
    /** Default slot: use empty string / omit `slot` on the element. */
    content: "" as const
} as const;

export type ShellOverlaySlotName = typeof SHELL_SLOT.overlay;
export type ShellUnderlyingSlotName = typeof SHELL_SLOT.underlying;

/**
 * Comma-separated selector for {@link Element.closest} — matches `cw-shell-*` tags from shell registration.
 * Keep aligned with `ShellId` values registered via {@link ensureShellElementDefined}.
 */
export const SHELL_HOST_SELECTOR = [
    "cw-shell-base",
    "cw-shell-window",
    "cw-shell-tabbed",
    "cw-shell-minimal",
    "cw-shell-environment",
    "env-shell-container",
    "cw-shell-content",
    "cw-shell-immersive",
    "cw-shell-faint"
].join(",");

/**
 * Nearest shell's shadow `[data-shell-overlays]` for stacking UI above routed views.
 * Walks past `.wf-frame` and other non-shell ancestors to the enclosing shell host (`cw-shell-*` or `env-shell-container`).
 */
export function resolveShellOverlaysMount(from?: Element | null): HTMLElement | null {
    if (!(from instanceof Element) || typeof from.closest !== "function") return null;
    const host = from.closest(SHELL_HOST_SELECTOR) as HTMLElement | null;
    const overlays = host?.shadowRoot?.querySelector?.("[data-shell-overlays]") ?? null;
    return overlays instanceof HTMLElement ? overlays : null;
}

/**
 * Prefer shell overlay layer (from `anchor`'s enclosing shell), then `[data-app-layer="overlay"]`,
 * then `.basic-app`, then `document.body`.
 */
export function resolveOverlayMountPoint(anchor?: Element | null): HTMLElement {
    if (typeof document === "undefined") {
        return undefined as unknown as HTMLElement;
    }
    const shellOverlays = anchor ? resolveShellOverlaysMount(anchor) : null;
    if (shellOverlays) return shellOverlays;

    const appLayer = document.querySelector('[data-app-layer="overlay"]') as HTMLElement | null;
    if (appLayer) return appLayer;

    const basicApp = document.querySelector(".basic-app") as HTMLElement | null;
    if (basicApp) return basicApp;

    return document.body;
}
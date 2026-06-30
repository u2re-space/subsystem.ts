/**
 * CRX Frontend Entry Point
 *
 * Entry point for Chrome extension pages (settings, newtab, markdown viewer, etc.).
 * Boots the **immersive** shell by default (chromeless; `cw-shell-immersive`). Legacy alias `base`
 * still resolves to the same module via BootLoader normalization.
 */

import { bootLoader } from "./BootLoader";
import type { ViewId, Shell, ShellId } from "./types";
import { ViewRegistry } from "shared/routing/registry";
import { initializeLayers } from "shared/routing/layer-manager";
import { pickEnabledView } from "shared/routing/views";
import { getCrxNetworkCoordinator } from "crx/network/Coordinator";
import { ensureAppLayers } from "shared/routing/app-layers";

// ============================================================================
// TYPES
// ============================================================================

export type CrxAppOptions = {
    /** View to display - accepts both shell ViewId and legacy MinimalView names */
    initialView?: ViewId | "markdown" | "markdown-viewer";
    /**
     * Shell for this extension surface. Defaults to `immersive`. Prefer `immersive` for
     * options pages and full-tab extension UIs (`base` is a compatibility alias).
     */
    shell?: ShellId;
    /** Optional URL-style params passed to the launched view */
    viewParams?: Record<string, string>;
    /** Optional initial payload passed to the launched view */
    viewPayload?: unknown;
};

// ============================================================================
// VIEW NAME MAPPING
// ============================================================================

/**
 * Map legacy / CRX-specific view names → canonical ViewId
 */
const CRX_VIEW_MAP: Record<string, ViewId> = {
    "markdown":         "viewer",
    "markdown-viewer":  "viewer",
};

const resolveViewId = (input?: string): ViewId =>
    pickEnabledView((input && CRX_VIEW_MAP[input]) ?? (input as ViewId) ?? "viewer");

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Mount the frontend for a Chrome extension page.
 *
 * - Uses the immersive shell (chrome-less CRX wrapper; boot id `base` aliases the same module).
 * - Loads **vl-basic** (core + component tokens/styles; vl-core alone is too minimal for views).
 * - No channels or preference persistence (CRX pages are single-purpose).
 *
 * @param mountElement - DOM element to mount into
 * @param options      - Optional view configuration
 * @returns The mounted shell instance
 */
export default async function crxFrontend(
    mountElement: HTMLElement,
    options: CrxAppOptions = {},
): Promise<Shell> {
    // CRX pages can bypass main index entry, so initialize layers here too.
    initializeLayers();

    void getCrxNetworkCoordinator().startFromStoredSettings().catch(() => undefined);

    // Same grid shell layer as PWA (`content-row` / `content-column`); ShellBase.mount
    // positions cw-shell-* on those named lines — mounting directly on #app had no lines.
    const layers = ensureAppLayers(mountElement, {
        enableOrientLayer: false,
        enableCanvasLayer: false,
    });

    const view = resolveViewId(options.initialView);
    const hasViewParams = Boolean(options.viewParams && Object.keys(options.viewParams).length > 0);
    const hasPayload = options.viewPayload !== undefined && options.viewPayload !== null;

    const shellId = options.shell ?? "immersive";

    const shell = await bootLoader.boot(layers.shellLayer, {
        styleSystem: "vl-basic",
        shell:       shellId,
        defaultView: view,
        channels:    [],
        rememberChoice: false,
    });

    if (hasViewParams) {
        await shell.navigate(view, options.viewParams);
    }

    if (hasPayload) {
        const loadedView = ViewRegistry.getLoaded(view);
        const asMessageCapable = loadedView as {
            canHandleMessage?: (messageType: string) => boolean;
            handleMessage?: (message: unknown) => Promise<void> | void;
        } | undefined;

        if (asMessageCapable?.canHandleMessage?.("content-load") && asMessageCapable.handleMessage) {
            await asMessageCapable.handleMessage({
                type: "content-load",
                data: options.viewPayload
            });
        } else if (asMessageCapable?.handleMessage) {
            await asMessageCapable.handleMessage({
                type: "launch",
                data: options.viewPayload
            });
        }
    }

    return shell;
}

export { crxFrontend };

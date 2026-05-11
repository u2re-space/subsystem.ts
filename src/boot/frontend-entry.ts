/**
 * Frontend Entry Point (Minimal Shell)
 *
 * Entry point for mounting the Minimal frontend application.
 * Handles URL parameters, share-target data, and auto-processing.
 *
 * Used by:
 * - PWA share target handler
 * - Direct URL loading
 *
 * NOTE: Chrome extension pages use `crx-entry.ts` instead (immersive shell by default).
 */


// Types only — runtime `mountShellApp` is dynamic-imported so this entry chunk does not
// statically pull `channel-unknown` → unified/RecognizeData (would merge AI into `shell-boot-*`
// and cause the extension service worker to import DOM-heavy chunks).
import type { ShellOptions } from "shared/routing/channel-unknown";

/**
 * @deprecated Legacy compatibility options for old shell-based entry.
 * Prefer `loadSubAppWithShell` + routing/BootLoader pipeline.
 */
export type MinimalAppOptions = ShellOptions;

/**
 * Mount the Minimal frontend application
 *
 * @param mountElement - DOM element to mount the application into
 * @param options - Optional configuration for the app
 */
export default async function frontend(
    mountElement: HTMLElement,
    options: ShellOptions = {}
): Promise<void> {
    const { mountShellApp } = await import("shared/routing/channel-unknown");
    /* Hub socket: BootLoader applies settings; duplicate boot removed (default WS maintenance is off). */

    try {
        const { initIngressPWA } = await import("shared/routing/pwa/sw-handling");
        await initIngressPWA();
    } catch (e) {
        console.warn("[Frontend] PWA / share-target ingress failed:", e);
    }

    // Check for markdown content in URL parameters (from launch queue or direct links)
    const urlParams = new URLSearchParams(globalThis.location.search);
    // Share-target payloads: handled by BootLoader.initIngressPWA → handleShareTarget +
    // routeToTransferView. Do NOT consume Cache Storage here (wrong path + clear:true races the router).

    const markdownContent = urlParams.get('markdown-content');

    if (markdownContent) {
        console.log('[Frontend] Loading markdown content from URL parameters');

        // Set the initial view to markdown viewer and pass the content
        options.initialView = 'markdown-viewer';
        options.initialMarkdown = markdownContent;

        // Clean up URL parameters after reading them
        const url = new URL(globalThis.location.href);
        url.searchParams.delete('markdown-content');
        url.searchParams.delete('markdown-filename');
        url.searchParams.delete('shared');
        globalThis?.history?.replaceState?.({}, '', url.pathname + url.hash);
    }

    mountShellApp(mountElement, options);
}

// Named export for explicit usage
export { frontend };

// Export types
export type { ShellOptions };

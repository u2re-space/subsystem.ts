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


import { loadSettings } from "com/config/Settings";
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
    void import("shared/transport/hub-socket-boot")
        .then((m) => m.bootHubSocketFromStoredSettings())
        .catch(() => undefined);

    // Check for markdown content in URL parameters (from launch queue or direct links)
    const urlParams = new URLSearchParams(globalThis.location.search);
    const markdownContent = urlParams.get('markdown-content');
    const sharedFlag = urlParams.get('shared');

    let sharedFilesForAutoAI: File[] | null = null;

    // If this is a share-target navigation, try to pull real files from cache and pass them into Basic.
    // (SW stores only counts in the metadata; files are stored as cache entries + a manifest.)
    if (sharedFlag === "1" || sharedFlag === "true") {
        try {
            const { consumeCachedShareTargetPayload } = await import("shared/pwa/sw-handling");
            const payload = await consumeCachedShareTargetPayload({ clear: true });
            const files = payload?.files ?? [];

            if (files.length > 0) {
                sharedFilesForAutoAI = files;
                // If it's a single markdown file, prefer opening it in the viewer.
                if (files.length === 1 && (files[0].type === "text/markdown" || files[0].name.toLowerCase().endsWith(".md"))) {
                    const md = await files[0].text();
                    options.initialView = "markdown-viewer";
                    options.initialMarkdown = md;
                } else {
                    // Otherwise: open WorkCenter and attach files.
                    (options as any).initialView = "workcenter";
                    (options as any).initialFiles = files;
                }
            }
        } catch (e) {
            // If anything goes wrong, just fall back to existing behavior.
            console.warn("[Frontend] Failed to consume share-target cached files:", e);
        }
    }

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

    // Optional: auto-run AI recognition and auto-copy result to clipboard (enabled by default).
    // This happens after the app is mounted so toasts/receivers are ready.
    if (sharedFilesForAutoAI && sharedFilesForAutoAI.length > 0) {
        queueMicrotask(() => {
            void (async () => {
                const settings = await loadSettings().catch(() => null);
                const auto = (settings?.ai?.autoProcessShared ?? true) !== false;
                const hasKey = Boolean(settings?.ai?.apiKey?.trim?.());
                if (!auto || !hasKey) return;

                try {
                    const { processShareTargetData } = await import("shared/pwa/sw-handling");
                    await processShareTargetData({
                        files: sharedFilesForAutoAI,
                        fileCount: sharedFilesForAutoAI.length,
                        imageCount: sharedFilesForAutoAI.filter(f => (f?.type || "").toLowerCase().startsWith("image/")).length,
                        timestamp: Date.now(),
                        source: "share-cache",
                    } as any, false);
                } catch (e) {
                    console.warn("[Frontend] Auto AI processing failed:", e);
                }
            })();
        });
    }
}

// Named export for explicit usage
export { frontend };

// Export types
export type { ShellOptions };

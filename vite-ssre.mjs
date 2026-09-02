/*
 * Filename: vite-ssre.mjs
 * FullPath: modules/projects/subsystem/vite-ssre.mjs
 * FIND:ssre
 *
 * Shared Vite hook for shells / views: existing index.html is the ssre document
 * base; `/ssre/channel` rides the Vite origin (not core :8434).
 * PWA/SW stay on the host (Process already has VitePWA). This file only lays
 * the SSR channel so later SKUs can opt in without copying plugin wiring.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ssreVite } from "../ssr.e/src/ssre/vite/plugin.ts";
import { processApiVite } from "./src/routing/api/process-api-vite.ts";

export const SSRE_CHANNEL_PATH = "/ssre/channel";

/**
 * @param {string} root — package root that owns `index.html`
 * @param {{ html?: string, pages?: Record<string, string>, htmlAsBase?: boolean, channelPath?: string, injectOnBuild?: boolean }} [opts]
 */
export function createSsreVitePlugin(root, opts = {}) {
    const indexHtml = resolve(root, opts.html ?? "index.html");
    const pages = { ...(opts.pages ?? {}) };
    if (opts.htmlAsBase !== false && existsSync(indexHtml)) {
        if (pages["/"] == null) pages["/"] = indexHtml;
        if (pages["/index.html"] == null) pages["/index.html"] = indexHtml;
        /* WHY: OS share-target POSTs 302 to these paths; Vite must serve the same PWA HTML. */
        for (const alias of ["/share-target", "/share_target", "/workcenter", "/process", "/settings", "/ai"]) {
            if (pages[alias] == null) pages[alias] = indexHtml;
        }
    }
    return ssreVite({
        htmlAsBase: opts.htmlAsBase !== false,
        pages,
        channelPath: opts.channelPath ?? SSRE_CHANNEL_PATH,
        injectOnBuild: opts.injectOnBuild === true,
    });
}

/** Process API on the same Vite origin as ssre (shells / views). */
export function createProcessApiVitePlugin() {
    return processApiVite();
}

/** ssre HTML base + `/api/process` local-first fallback. */
export function createSsreAndProcessVitePlugins(root, opts = {}) {
    return [createSsreVitePlugin(root, opts), createProcessApiVitePlugin()];
}

/**
 * Minimal HTTPS harness: loads `explorer-view` only (OPFS / secure context).
 * Open https://localhost/demo.html when dev server uses default port 443.
 */
import "fest/icon";
import { mountViewModule, type ShellContext, type ViewModule } from "../types";

const MOUNT_ID = "fl-ui-explorer-mount";

const shellContext: ShellContext = {
    navigate: (viewId, options) => {
        console.debug("[explorer-demo] navigate", viewId, options);
    },
    showMessage: (message) => {
        const status = document.querySelector("[data-demo-status]");
        if (status)
            status.textContent = typeof message === "string" ? message : JSON.stringify(message ?? "");
    }
};

async function main(): Promise<void> {
    const mount = document.getElementById(MOUNT_ID);
    const status = document.querySelector<HTMLElement>("[data-demo-status]");
    if (!mount) throw new Error(`#${MOUNT_ID} missing`);

    status?.setAttribute("data-state", "loading");

    try {
        const viewModule = (await import("../../../views/explorer-view/src/index.ts")) as ViewModule;
        await mountViewModule(mount, viewModule, {
            id: "explorer",
            shellContext
        });
        status?.setAttribute("data-state", "ready");
        status && (status.textContent = "Explorer ready (HTTPS / OPFS-capable context).");
    } catch (e) {
        console.error(e);
        status?.setAttribute("data-state", "error");
        if (status) status.textContent = "Failed to load explorer module.";
        const pre = document.createElement("pre");
        pre.style.cssText = "color:#f87171;white-space:pre-wrap;";
        pre.textContent = String(e);
        mount.append(pre);
    }
}

void main();

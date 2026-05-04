/**
 * HTTPS playground for packaged view modules (`mountViewModule` + dynamic import).
 * Open https://localhost:8443/?suite=explorer (port from terminal if 8443 is taken).
 */
import "fest/icon";
import { mountViewModule, type ShellContext, type ViewModule } from "../types";

const MOUNT_ID = "fl-ui-playground";

/** Primary demo target + optional second module to prove loader wiring. */
export const SUITE_IDS = ["explorer", "markdown"] as const;
export type SuiteId = (typeof SUITE_IDS)[number];

const shellContext: ShellContext = {
    navigate: (viewId, options) => {
        console.debug("[views-playground] navigate", viewId, options);
    },
    showMessage: (message) => {
        const status = document.getElementById("fl-ui-suite-status");
        if (status)
            status.textContent = typeof message === "string" ? message : JSON.stringify(message ?? "");
    }
};

const loaders: Record<SuiteId, () => Promise<ViewModule>> = {
    explorer: () => import("../../../views/explorer-view/src/index.ts"),
    markdown: () => import("../../../views/markdown-view/src/index.ts")
};

export async function loadSuite(id: SuiteId): Promise<void> {
    const root = document.getElementById(MOUNT_ID);
    if (!root) throw new Error(`#${MOUNT_ID} missing`);
    root.replaceChildren();
    const status = document.getElementById("fl-ui-suite-status");
    if (status) {
        status.textContent = `Loading “${id}”…`;
        status.dataset.state = "loading";
    }
    try {
        const viewModule = await loaders[id]();
        await mountViewModule(root, viewModule, {
            id,
            shellContext
        });
        if (status) {
            status.textContent = `Active: ${id} (HTTPS module load OK)`;
            status.dataset.state = "ready";
        }
    } catch (e) {
        console.error(e);
        if (status) {
            status.textContent = `Error loading “${id}”`;
            status.dataset.state = "error";
        }
        const pre = document.createElement("pre");
        pre.style.cssText = "color:#f87171;padding:1rem;white-space:pre-wrap;";
        pre.textContent = String(e);
        root.appendChild(pre);
    }
}

function normalizeSuiteParam(raw: string | null): SuiteId | null {
    if (!raw) return null;
    const id = raw.trim().toLowerCase().replace(/_/g, "-");
    return (SUITE_IDS as readonly string[]).includes(id) ? (id as SuiteId) : null;
}

function suiteFromQuery(): SuiteId | null {
    const qs = new URLSearchParams(location.search);
    return normalizeSuiteParam(qs.get("suite") || qs.get("demo"));
}

function wireNav(): void {
    document.querySelectorAll<HTMLElement>("[data-fl-suite]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = normalizeSuiteParam(btn.getAttribute("data-fl-suite"));
            if (!id) return;
            const url = new URL(location.href);
            url.searchParams.set("suite", id);
            history.replaceState({}, "", url);
            syncActiveButton(id);
            void loadSuite(id);
        });
    });
}

function syncActiveButton(id: SuiteId | null): void {
    document.querySelectorAll<HTMLElement>("[data-fl-suite]").forEach((btn) => {
        const bid = normalizeSuiteParam(btn.getAttribute("data-fl-suite"));
        btn.dataset.flActive = bid === id ? "true" : "false";
    });
}

declare global {
    interface Window {
        __VIEWS_PLAYGROUND__?: {
            loadSuite: typeof loadSuite;
            SUITE_IDS: typeof SUITE_IDS;
        };
    }
}

window.__VIEWS_PLAYGROUND__ = { loadSuite, SUITE_IDS };

wireNav();
const initial = suiteFromQuery();
syncActiveButton(initial);
if (initial) void loadSuite(initial);
else {
    const status = document.getElementById("fl-ui-suite-status");
    if (status) {
        status.innerHTML =
            'Choose a suite or open <code>?suite=explorer</code>. Use the <strong>HTTPS</strong> URL from the dev server log (default port 8443).';
        status.dataset.state = "idle";
    }
}

/**
 * Light-weight theme bridge for view/shell Vite demos (alias `core/utils/Theme`).
 * WHY: `BootLoader` calls `applyTheme(settings)` with `AppSettings`; a string-only stub broke
 * `documentElement.dataset.theme` (`"[object Object]"`) and Veela/M3 remaps on `:root`.
 */

import { loadSettings } from "com/config/Settings";

function syncContentShellColorScheme(resolved: "light" | "dark"): void {
    try {
        document.querySelectorAll("[data-shell='content']").forEach((el) => {
            (el as HTMLElement).style.colorScheme = resolved;
        });
    } catch {
        /* ignore */
    }
}

function syncShellHostVisualScheme(resolved: "light" | "dark"): void {
    try {
        document.querySelectorAll("[data-shell]").forEach((el) => {
            const h = el as HTMLElement;
            h.dataset.theme = resolved;
            h.style.colorScheme = resolved;
            const inner = h.shadowRoot?.querySelector?.(".app-shell") as HTMLElement | null;
            if (inner) {
                inner.dataset.theme = resolved;
                inner.style.colorScheme = resolved;
            }
        });
    } catch {
        /* ignore */
    }
}

export function applyTheme(settingsOrMode: unknown): void {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    let pref = "auto";
    let fontSize: string | undefined;
    let accent: string | undefined;

    if (typeof settingsOrMode === "string") {
        pref = settingsOrMode;
    } else if (settingsOrMode && typeof settingsOrMode === "object") {
        const app = settingsOrMode as {
            appearance?: { theme?: string; fontSize?: string; color?: string };
        };
        pref = (app.appearance?.theme as string) ?? "auto";
        fontSize = app.appearance?.fontSize as string | undefined;
        accent = app.appearance?.color as string | undefined;
    }

    const schemeAttr = pref === "dark" ? "dark" : pref === "light" ? "light" : "auto";
    const resolved: "light" | "dark" =
        pref === "dark"
            ? "dark"
            : pref === "light"
              ? "light"
              : globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches
                ? "dark"
                : "light";

    root.setAttribute("data-scheme", schemeAttr);
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;

    try {
        if (document.body) {
            document.body.style.colorScheme = resolved;
        }
    } catch {
        /* ignore */
    }

    syncContentShellColorScheme(resolved);
    syncShellHostVisualScheme(resolved);

    if (fontSize) {
        const fs =
            fontSize === "small"
                ? "14px"
                : fontSize === "large"
                  ? "18px"
                  : fontSize === "medium"
                    ? "16px"
                    : "16px";
        root.style.fontSize = fs;
    }

    if (accent && typeof accent === "string") {
        try {
            document.body?.style?.setProperty?.("--current", accent);
            document.body?.style?.setProperty?.("--primary", accent);
        } catch {
            /* ignore */
        }
        root.style.setProperty("--current", accent);
        root.style.setProperty("--primary", accent);
    }
}

/**
 * Apply saved appearance and follow OS when preference is `auto` (demo / shell harness).
 */
export function initTheme(): void {
    if (typeof document === "undefined") return;

    try {
        applyTheme(loadSettings());
    } catch {
        applyTheme("auto");
    }

    globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
        try {
            const s = loadSettings() as { appearance?: { theme?: string } };
            if ((s?.appearance?.theme ?? "auto") !== "auto") return;
            applyTheme(s);
        } catch {
            applyTheme("auto");
        }
    });
}

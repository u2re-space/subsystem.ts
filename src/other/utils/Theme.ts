import { loadSettings } from "com/config/Settings";
import type { AppSettings } from "com/config/SettingsTypes";
import { applyGridSettings } from "core/store/StateStorage";

/** Convert getComputedStyle background (rgb/rgba or hex) to #rrggbb for meta theme-color / PWA chrome. */
export const cssBackgroundToOpaqueHex = (css: string): string | null => {
    const t = css.trim();
    if (!t || t === "transparent") return null;

    const hexMatch = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        let h = hexMatch[1]!;
        if (h.length === 3) {
            h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
        }
        return `#${h.toLowerCase()}`;
    }

    const m = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (!m) return null;

    const alpha = m[4] !== undefined ? Number(m[4]) : 1;
    if (!Number.isFinite(alpha) || alpha < 0.98) return null;

    const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

/**
 * Sample the top shell chrome (minimal nav or faint toolbar) from mounted shell shadow roots
 * so PWA Window Controls Overlay / title bar can match the real toolbar background.
 */
export const samplePwaToolbarBackgroundColor = (): string | null => {
    if (typeof document === "undefined") return null;

    const hosts = document.querySelectorAll("[data-shell]");
    for (const host of hosts) {
        const sr = (host as HTMLElement).shadowRoot;
        if (!sr) continue;

        const bar = sr.querySelector<HTMLElement>(".app-shell__nav, .app-shell__toolbar");
        if (!bar) continue;

        const bg = getComputedStyle(bar).backgroundColor;
        const hex = cssBackgroundToOpaqueHex(bg);
        if (hex) return hex;
    }

    return null;
};

//
const resolveColorScheme = (theme: AppSettings["appearance"] extends { theme?: infer T } ? T : never) => {
    if (theme === "dark" || theme === "light") return theme;
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
};

const resolveFontSize = (size?: AppSettings["appearance"] extends { fontSize?: infer T } ? T : never) => {
    switch (size) {
        case "small":
            return "14px";
        case "large":
            return "18px";
        case "medium":
        default:
            return "16px";
    }
};

/** Keep minimal / immersive shell hosts + inner `.app-shell` in sync when only `applyTheme()` runs (Settings saves / preview) — `shell.setTheme` is not always invoked. */
const syncShellHostVisualScheme = (resolved: "light" | "dark"): void => {
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
};

/** Keep <html> + PWA chrome aligned with resolved light/dark and user preference (auto/light/dark). */
export const syncBrowserChromeTheme = (
    resolved: "light" | "dark",
    preference: "auto" | "light" | "dark" | string
): void => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const scheme =
        preference === "dark" ? "dark" : preference === "light" ? "light" : "auto";

    root.setAttribute("data-scheme", scheme);
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;

    try {
        const body = document.body;
        if (body) {
            body.style.colorScheme = resolved;
        }
    } catch {
        // ignore (SSR / stale documents)
    }

    /* Content / CRX shell hosts (shadow overlays): keep native controls/widgets aligned with resolved scheme. */
    try {
        document.querySelectorAll("[data-shell='content']").forEach((el) => {
            (el as HTMLElement).style.colorScheme = resolved;
        });
    } catch {
        // ignore
    }

    // When LUR.E dynamic theme is active, it is the single writer for meta theme-color.
    if ((globalThis as any)?.__LURE_DYNAMIC_THEME_PRIORITY__ !== true) {
        const applyMetaThemeColor = (): void => {
            if ((globalThis as any)?.__LURE_DYNAMIC_THEME_PRIORITY__ === true) {
                return;
            }

            const meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) return;

            const sampled = samplePwaToolbarBackgroundColor();
            const fallback = resolved === "dark" ? "#0f1419" : "#007acc";
            meta.setAttribute("content", sampled ?? fallback);
        };

        applyMetaThemeColor();
        requestAnimationFrame(applyMetaThemeColor);
    }

    syncShellHostVisualScheme(resolved);
};

//
export const applyTheme = (settings: AppSettings) => {
    if (typeof document === "undefined") {
        // Service worker/offscreen-like runtimes have no DOM. Keep this a no-op.
        return;
    }

    const root = document.documentElement;
    const theme = settings.appearance?.theme || "auto";
    const resolvedScheme = resolveColorScheme(theme);

    syncBrowserChromeTheme(resolvedScheme, theme);
    root.style.fontSize = resolveFontSize(settings.appearance?.fontSize);
    if (settings.appearance?.color) {
        document.body.style.setProperty("--current", settings.appearance.color);
        document.body.style.setProperty("--primary", settings.appearance.color);
        root.style.setProperty("--current", settings.appearance.color);
        root.style.setProperty("--primary", settings.appearance.color);
    }

    // Apply grid settings
    if (settings.grid) {
        applyGridSettings(settings);
    }
};

/**
 * Re-apply persisted appearance after a view adopts a document-level constructed stylesheet (Settings, Work Center, …).
 * WHY: First paint after cold boot can leave mixed shell chrome vs Veela `light-dark()` token resolution until
 * something triggers a full style pass; microtask + rAF + idle re-run matches navigating away/back.
 * INVARIANT: Safe to call multiple times; each pass is idempotent `applyTheme(loadSettings())`.
 */
export const resyncThemeAfterAdoptedViewSheet = (): void => {
    if (typeof document === "undefined") return;

    const run = async (): Promise<void> => {
        try {
            applyTheme(await loadSettings());
        } catch {
            /* ignore */
        }
        try {
            void document.documentElement.offsetHeight;
        } catch {
            /* ignore */
        }
    };

    void (async () => {
        await run();
        queueMicrotask(() => {
            void run();
        });
        requestAnimationFrame(() => {
            void run();
            try {
                document.documentElement.dispatchEvent(new CustomEvent("u2-theme-change", { bubbles: true }));
            } catch {
                /* ignore */
            }
            requestAnimationFrame(() => {
                void run();
                const ric = globalThis.requestIdleCallback;
                if (typeof ric === "function") {
                    ric(
                        () => {
                            void run();
                        },
                        { timeout: 200 }
                    );
                } else {
                    globalThis.setTimeout(() => {
                        void run();
                    }, 50);
                }
            });
        });
    })();
};

//
export const initTheme = async () => {
    try {
        if (typeof document === "undefined") return;
        const settings = await loadSettings();
        applyTheme(settings);

        // Listen for system changes if in auto mode?
        // CSS handles this mostly, but if we add listeners here we can be more reactive.
        globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', async () => {
            applyTheme(await loadSettings());
        });
    } catch (e) {
        console.warn("Failed to init theme", e);
    }
};

/*
 * Filename: Theme.ts
 * FullPath: modules/projects/subsystem/src/other/utils/Theme.ts
 * Change date and time: 17.05.00_30.08.2026
 * Reason for changes: Resume must not applyTheme / replaceSync — that grayed chrome after recents.
 * FIND:theme-resume
 * TAG:theme-resume,explorer-theme
 */
import { loadSettings, saveSettings } from "com/config/Settings";
import type { AppSettings } from "com/config/SettingsTypes";
import { applyGridSettings } from "core/store/StateStorage";
import { applyBaseColorSeed, resolveAppearanceBaseColor, resolveColorSource } from "./appearance-base-color";

/**
 * WHY: fl.ui Quick Settings cannot import this module (layer cycle). It dispatches
 * `u2-theme-change` with `{ source: "quick-settings", theme }`; we persist to IDB and
 * re-run {@link applyTheme} so env-shell + minimal shells share one persistence path.
 */
let quickSettingsThemeBridgeBound = false;
let quickSettingsThemeBridgeBusy = false;

export const bindQuickSettingsThemePersistence = (): void => {
    if (quickSettingsThemeBridgeBound || typeof document === "undefined") return;
    quickSettingsThemeBridgeBound = true;

    document.documentElement.addEventListener("u2-theme-change", (ev: Event) => {
        const detail = (ev as CustomEvent)?.detail;
        if (!detail || detail.source !== "quick-settings") return;
        const theme = detail.theme;
        if (theme !== "light" && theme !== "dark") return;
        if (quickSettingsThemeBridgeBusy) return;
        quickSettingsThemeBridgeBusy = true;
        void (async () => {
            try {
                const current = await loadSettings();
                if (current?.appearance?.theme === theme) {
                    /* DOM already set by applyQuickTheme — keep chrome attrs authoritative. */
                    syncBrowserChromeTheme(theme, theme);
                    return;
                }
                const saved = await saveSettings({
                    ...current,
                    appearance: {
                        ...(current.appearance || {}),
                        theme
                    }
                });
                applyTheme(saved);
            } catch (e) {
                console.warn("[Theme] Quick Settings persistence failed", e);
                syncBrowserChromeTheme(theme, theme);
            } finally {
                quickSettingsThemeBridgeBusy = false;
            }
        })();
    });
};

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

/** Paint `--color-surface` so Capacitor / PWA chrome follows Material You after seed apply. */
export const sampleSurfaceBackgroundColor = (): string | null => {
    if (typeof document === "undefined") return null;
    const probe = document.createElement("div");
    probe.style.cssText =
        "position:fixed;left:-8px;top:-8px;inline-size:4px;block-size:4px;pointer-events:none;opacity:0;" +
        "background:var(--color-surface)";
    try {
        document.documentElement.appendChild(probe);
        return cssBackgroundToOpaqueHex(getComputedStyle(probe).backgroundColor);
    } catch {
        return null;
    } finally {
        probe.remove();
    }
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
    /* WHY: env-shell floating windows must pin scheme or titlebar/content light-dark() follows OS. */
    try {
        document.querySelectorAll("ui-window, .env-shell-root").forEach((el) => {
            const h = el as HTMLElement;
            h.dataset.theme = resolved;
            h.style.colorScheme = resolved;
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
    // Native mono ui-window also owns theme-color (WCO title strip) — never stomp with #007acc.
    if ((globalThis as any)?.__LURE_DYNAMIC_THEME_PRIORITY__ !== true) {
        const applyMetaThemeColor = (): void => {
            if ((globalThis as any)?.__LURE_DYNAMIC_THEME_PRIORITY__ === true) {
                return;
            }
            if ((globalThis as any)?.__CWSP_NATIVE_THEME_COLOR_OWNED__) {
                return;
            }
            if (document.querySelector("ui-window[native-mode]:not([minimized])")) {
                return;
            }

            let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
            if (!meta) {
                meta = document.createElement("meta");
                meta.setAttribute("name", "theme-color");
                document.head?.appendChild(meta);
            }

            const sampled = samplePwaToolbarBackgroundColor() ?? sampleSurfaceBackgroundColor();
            /* WHY: #0f1419 / #cbb8a4 forked Android status chrome from `--base-color`. */
            const fallback = resolved === "dark" ? "#1a2420" : "#d5e4dc";
            meta.setAttribute("content", sampled ?? fallback);
        };

        applyMetaThemeColor();
        requestAnimationFrame(applyMetaThemeColor);
    }

    syncShellHostVisualScheme(resolved);
};

//
export const applyTheme = (settings: AppSettings | null | undefined) => {
    if (typeof document === "undefined") {
        // Service worker/offscreen-like runtimes have no DOM. Keep this a no-op.
        return;
    }

    /* Idempotent — ensures QS → IDB bridge is live after BootLoader applyTheme. */
    bindQuickSettingsThemePersistence();
    installThemeLifecycleResync();
    if (!settings) return;

    const root = document.documentElement;
    const theme = settings.appearance?.theme || "auto";
    const resolvedScheme = resolveColorScheme(theme);

    syncBrowserChromeTheme(resolvedScheme, theme);
    root.style.fontSize = resolveFontSize(settings.appearance?.fontSize);
    /* WHY: gate WallpaperTheme before the async seed so a late KMeans cannot stomp Material You. */
    root.dataset.colorSource = resolveColorSource(settings.appearance?.colorSource);
    void resolveAppearanceBaseColor(settings.appearance).then(({ hex, source }) => {
        applyBaseColorSeed(hex, source);
        /* WHY: seed is async; first chrome pass still had the static #0f1419 fallback. */
        syncBrowserChromeTheme(resolvedScheme, theme);
    });

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
const restampExplorerShellScheme = (): void => {
    if (typeof document === "undefined") return;
    try {
        document.querySelectorAll<HTMLElement>(".view-explorer").forEach((el) => {
            const scheme = el.dataset.explorerColorScheme;
            if (scheme !== "light" && scheme !== "dark") return;
            if (el.getAttribute("data-theme") !== scheme) el.setAttribute("data-theme", scheme);
            el.style.setProperty("color-scheme", `${scheme} only`);
        });
    } catch {
        /* ignore */
    }
};

let themeResumeAt = 0;
let themeLifecycleBound = false;
let sawBackground = false;

const restampChromeScheme = (): void => {
    restampExplorerShellScheme();
    try {
        const root = document.documentElement;
        const pinned = root.getAttribute("data-theme");
        if (pinned === "light" || pinned === "dark") {
            root.style.colorScheme = pinned;
            if (document.body) document.body.style.colorScheme = pinned;
        }
        void root.offsetHeight;
    } catch {
        /* ignore */
    }
};

/**
 * Restore chrome after Android recents / Home.
 * INVARIANT: never rewrite constructable sheets on cold start — first onResume/focus wiped UI.
 */
export const resumeThemeAfterForeground = (force = false): void => {
    if (typeof document === "undefined") return;
    if (!force && document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - themeResumeAt < 240) return;
    themeResumeAt = now;

    restampChromeScheme();

    /* WHY: first activity onResume is cold start — skip sheet rewrite + full applyTheme storm. */
    if (!sawBackground) return;

    void (async () => {
        /* WHY: replaceSync + applyTheme() after recents emptied live sheets and skipped text paint. */
        try {
            const { rehydrateAdoptedStyleSheets } = await import("@fest-lib/lure");
            rehydrateAdoptedStyleSheets();
        } catch {
            /* ignore */
        }
        restampChromeScheme();
        try {
            document.dispatchEvent(new CustomEvent("cwsp:theme-resume"));
        } catch {
            /* ignore */
        }
    })();
};

/** Bind visibility / pageshow / Capacitor appState + expose `__CWSP_THEME_RESUME__` for Java onResume. */
export const installThemeLifecycleResync = (): void => {
    if (themeLifecycleBound || typeof document === "undefined") return;
    themeLifecycleBound = true;

    (globalThis as { __CWSP_THEME_RESUME__?: (force?: boolean) => void }).__CWSP_THEME_RESUME__ =
        resumeThemeAfterForeground;

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            sawBackground = true;
            return;
        }
        resumeThemeAfterForeground();
    });
    document.addEventListener("resume", () => resumeThemeAfterForeground());
    globalThis.addEventListener?.("pageshow", () => resumeThemeAfterForeground());

    try {
        const Cap = (globalThis as {
            Capacitor?: { Plugins?: { App?: { addListener?: (n: string, fn: (s: { isActive?: boolean }) => void) => void } } };
        }).Capacitor;
        Cap?.Plugins?.App?.addListener?.("appStateChange", (state) => {
            if (state?.isActive === false) {
                sawBackground = true;
                return;
            }
            if (state?.isActive) resumeThemeAfterForeground();
        });
    } catch {
        /* plugin optional */
    }
};

export const initTheme = async () => {
    try {
        if (typeof document === "undefined") return;
        bindQuickSettingsThemePersistence();
        const settings = await loadSettings();
        applyTheme(settings);

        // Listen for system changes if in auto mode?
        // CSS handles this mostly, but if we add listeners here we can be more reactive.
        globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', async () => {
            const next = await loadSettings();
            applyTheme(next);
            /* WHY: App Menu / Speed Dial chrome listen for u2-theme-change; MutationObserver alone can miss Cap WebView scheme flips. */
            try {
                document.documentElement.dispatchEvent(
                    new CustomEvent("u2-theme-change", {
                        bubbles: true,
                        detail: {
                            source: "system-prefers-color-scheme",
                            theme: resolveColorScheme(next?.appearance?.theme || "auto")
                        }
                    })
                );
            } catch {
                /* ignore */
            }
        });
    } catch (e) {
        console.warn("Failed to init theme", e);
    }
};

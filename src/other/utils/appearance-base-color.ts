/*
 * Filename: appearance-base-color.ts
 * FullPath: modules/projects/subsystem/src/other/utils/appearance-base-color.ts
 * Change date and time: 18.05.00_22.08.2026
 * Reason for changes: Material You on Capacitor launcher — refetch shell accent, do not keep the first empty cache.
 */

import { Q } from "@fest-lib/lure";

/**
 * Resolve `--color-primary` / `--base-color` for veela.
 * INVARIANT: one seed writer. WallpaperTheme may cache extracts but must not
 * overwrite CSS when Appearance `colorSource` is Material You or custom.
 */

export const FALLBACK_BASE_COLOR = "#5a9ec8";

export type AppearanceColorSource =
    | "auto"
    | "wallpaper"
    | "material-you"
    | "system-wallpaper"
    | "speed-dial"
    | "custom";

export type AppearanceBaseSource = AppearanceColorSource | "user" | "system" | "fallback";

export type AppearanceColorInput = {
    color?: string | null;
    colorSource?: string | null;
};

const COLOR_SOURCES: AppearanceColorSource[] = [
    "auto",
    "wallpaper",
    "material-you",
    "system-wallpaper",
    "speed-dial",
    "custom"
];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const normalizeHexColor = (raw: unknown): string => {
    const t = String(raw ?? "").trim();
    if (!HEX_RE.test(t)) return "";
    if (t.length === 4) {
        return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase();
    }
    return t.toLowerCase();
};

export const isAppearanceColorSource = (raw: unknown): raw is AppearanceColorSource =>
    COLOR_SOURCES.includes(String(raw || "") as AppearanceColorSource);

export const isCapacitorNative = (): boolean => {
    try {
        const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
            .Capacitor;
        if (typeof c?.isNativePlatform === "function" && c.isNativePlatform()) return true;
        const platform = c?.getPlatform?.();
        return platform === "android" || platform === "ios";
    } catch {
        return false;
    }
};

export const isNeutralinoDesktop = (): boolean => {
    try {
        const g = globalThis as {
            __CWS_NEUTRALINO_BOOT__?: boolean;
            Neutralino?: unknown;
            NL_OS?: string;
        };
        return Boolean(g.__CWS_NEUTRALINO_BOOT__ || g.Neutralino || typeof g.NL_OS === "string");
    } catch {
        return false;
    }
};

export const isCrxSurface = (): boolean => {
    try {
        return Boolean((globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id);
    } catch {
        return false;
    }
};

export const isLauncherSku = (): boolean => {
    try {
        if (typeof document !== "undefined" && document.documentElement.dataset.cwspShellRole === "launcher") {
            return true;
        }
        return (globalThis as { __RS_SHELL_ROLE__?: string }).__RS_SHELL_ROLE__ === "launcher";
    } catch {
        return false;
    }
};

export const isCwspShellSurface = (): boolean => {
    try {
        if (typeof document === "undefined") return false;
        const role = String(document.documentElement.dataset.cwspShellRole || "").toLowerCase();
        const surface = String(document.documentElement.dataset.cwspSurface || "").toLowerCase();
        return role === "shell" || surface === "cwsp-shell" || surface === "environment" || surface === "cw-environment";
    } catch {
        return false;
    }
};

/** Platform default when `colorSource` is empty / `auto`. */
export const defaultColorSource = (): AppearanceColorSource => {
    if (isCapacitorNative() && isLauncherSku()) return "wallpaper";
    if (isCapacitorNative()) return "material-you";
    if (isNeutralinoDesktop()) return "system-wallpaper";
    if (isCrxSurface() || isCwspShellSurface()) return "speed-dial";
    return "speed-dial";
};

export const resolveColorSource = (saved?: string | null): AppearanceColorSource => {
    if (isAppearanceColorSource(saved) && saved !== "auto") return saved;
    return defaultColorSource();
};

/** WallpaperTheme may paint only when Appearance asked for an image seed. */
export const wallpaperSeedsMayPaint = (): boolean => {
    if (typeof document === "undefined") return true;
    const src = String(document.documentElement.dataset.colorSource || "");
    if (!src) return true;
    return src === "wallpaper" || src === "speed-dial" || src === "system-wallpaper";
};

const rgbToHex = (css: string): string => {
    const m = css.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return "";
    const hex = [m[1], m[2], m[3]]
        .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0"))
        .join("");
    return `#${hex}`;
};

export const registerColorProperty = (name: string, initialValue: string = "#5a9ec8")=>{
    try {
        CSS?.registerProperty?.({
            name,
            syntax: "<color>",
            inherits: true,
            initialValue,
        });
    } catch (error) {
        console.debug(error);
    }
}

const seedHosts = (): HTMLElement[] => {
    const nodes = new Set<HTMLElement>();
    if (typeof document === "undefined") return [];
    nodes.add(document.documentElement);
    if (document.body) nodes.add(document.body);
    document
        .querySelectorAll<HTMLElement>(
            ".env-shell-root, .wf-demo-root, ui-window, [data-shell], .view-settings, [data-view='settings'], .view-explorer, [data-view='explorer'], .view-viewer, [data-view='viewer'], .cw-network-view, .cw-network-view-host"
        )
        .forEach((el) => nodes.add(el));
    return [...nodes];
};

const SEED_PROPS = [
    "--color-primary",
    "--base-color",
    "--wf-md-primary",
    "--wf-md-seed",
    "--primary",
    "--current"
] as const;

export const isValidColor = (color: string): boolean => {
    try {
        rgbToHex(color);
        return true;
    } catch {
        return false;
    }
};

export const applyBaseColorSeed = (
    hex: string,
    source: AppearanceBaseSource,
    extras?: { secondary?: string; tertiary?: string }
): void => {
    if (typeof document === "undefined") return;
    const seed = normalizeHexColor(hex) || FALLBACK_BASE_COLOR;
    const secondary = normalizeHexColor(extras?.secondary) || `color-mix(in oklab, ${seed} 72%, gray)`;
    const tertiary = normalizeHexColor(extras?.tertiary) || `color-mix(in oklab, ${seed} 55%, gray)`;
    const concrete = source === "user" ? "custom" : source === "system" ? "material-you" : source;
    document.documentElement.dataset.baseSource = String(concrete);
    document.documentElement.dataset.colorSource = String(concrete);
    
    if (!isValidColor(seed)) return;
    if (!isValidColor(secondary)) return;
    if (!isValidColor(tertiary)) return;
    
    registerColorProperty("--color-primary", seed);
    registerColorProperty("--base-color", seed);
    registerColorProperty("--color-secondary", secondary);
    registerColorProperty("--color-tertiary", tertiary);
    registerColorProperty("--secondary", secondary);
    registerColorProperty("--tertiary", tertiary);
    
    for (const host of seedHosts()) {
        for (const prop of SEED_PROPS) host.style.setProperty(prop, seed);
        host.style.setProperty("--color-secondary", secondary);
        host.style.setProperty("--color-tertiary", tertiary);
        host.style.setProperty("--secondary", secondary);
        host.style.setProperty("--tertiary", tertiary);
    }

    const globalQuery = Q("body, html, .wf-demo-root, ui-window, .view-explorer, [data-view='explorer'], .view-viewer, [data-view='viewer'], .view-settings, [data-view='settings'], .cw-network-view, .cw-network-view-host");
    globalQuery.style.setProperty("--color-primary", seed);
    globalQuery.style.setProperty("--base-color", seed);
    globalQuery.style.setProperty("--color-secondary", secondary);
    globalQuery.style.setProperty("--color-tertiary", tertiary);
    globalQuery.style.setProperty("--secondary", secondary);
    globalQuery.style.setProperty("--tertiary", tertiary);

};

/** CSS `AccentColor` when the engine maps it to a real system accent (not generic link blue). */
export const readCssAccentColor = (): string => {
    if (typeof document === "undefined") return "";
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;inset:auto;color:AccentColor;background:AccentColor";
    document.documentElement.appendChild(probe);
    const css = getComputedStyle(probe).color;
    probe.remove();
    const hex = rgbToHex(css);
    if (!hex) return "";
    if (hex === "#0000ee" || hex === "#0000ff" || hex === "#000000" || hex === "#ffffff") return "";
    return hex;
};

const readBridgeColor = async (key: "accentColor" | "wallpaperColor"): Promise<string> => {
    try {
        const g = globalThis as {
            __CWS_SHELL_INFO__?: { accentColor?: string; wallpaperColor?: string };
        };
        const cached = normalizeHexColor(g.__CWS_SHELL_INFO__?.[key]);
        if (cached) return cached;
        const { fetchCwsShellInfo } = await import("com/routing/native/cws-bridge");
        const info = await fetchCwsShellInfo({ force: true });
        return normalizeHexColor(info?.[key]);
    } catch {
        return "";
    }
};

export const resolveSystemAccentColor = async (): Promise<string> => {
    const fromBridge = await readBridgeColor("accentColor");
    if (fromBridge) return fromBridge;
    return readCssAccentColor();
};

const cachedWallpaperPrimary = (): string => {
    try {
        const hex = normalizeHexColor(localStorage.getItem("rs-wallpaper-primary"));
        if (hex) return hex;
        const raw = localStorage.getItem("rs-wallpaper-theme");
        if (!raw) return "";
        const parsed = JSON.parse(raw) as { primary?: string };
        return normalizeHexColor(parsed?.primary);
    } catch {
        return "";
    }
};

const extractFromImage = async (src: string | Blob): Promise<string> => {
    try {
        const { applyThemeFromWallpaper } = await import("@fest-lib/image");
        const seeds = await applyThemeFromWallpaper(src, { force: false });
        return normalizeHexColor(seeds?.primary);
    } catch {
        return "";
    }
};

const colorFromLiveWallpaperCanvas = async (): Promise<string> => {
    if (typeof document === "undefined") return "";
    const canvas = document.querySelector(
        ".env-shell-wallpaper canvas, [data-app-layer='canvas'] canvas"
    ) as HTMLCanvasElement | null;
    if (!canvas || canvas.width < 2 || canvas.height < 2) return "";
    try {
        const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7);
        });
        if (blob && blob.size > 0) return extractFromImage(blob);
    } catch {
        /* tainted canvas / no blob */
    }
    return "";
};

const colorFromAppWallpaper = async (): Promise<string> => {
    const cached = cachedWallpaperPrimary();
    if (cached) return cached;
    try {
        const { resolveAppWallpaperUrl } = await import("@fest-lib/image");
        const url = await resolveAppWallpaperUrl();
        if (url) return extractFromImage(url);
    } catch {
        /* image module unavailable */
    }
    return "";
};

const neuReadEnv = async (key: string): Promise<string> => {
    try {
        const nl = (globalThis as { Neutralino?: { os?: { getEnv?: (a: unknown) => Promise<unknown> } } })
            .Neutralino;
        const fn = nl?.os?.getEnv;
        if (typeof fn !== "function") return "";
        const raw = await fn({ key });
        if (typeof raw === "string") return raw.trim();
        if (raw && typeof raw === "object" && "value" in raw) return String((raw as { value?: string }).value || "").trim();
        return "";
    } catch {
        return "";
    }
};

const neuReadBinary = async (path: string): Promise<Blob | null> => {
    try {
        const nl = (globalThis as {
            Neutralino?: { filesystem?: { readBinaryFile?: (p: string) => Promise<ArrayBuffer> } };
        }).Neutralino;
        const buf = await nl?.filesystem?.readBinaryFile?.(path);
        if (!buf || !(buf instanceof ArrayBuffer) || buf.byteLength < 32) return null;
        return new Blob([buf], { type: "image/jpeg" });
    } catch {
        return null;
    }
};

const colorFromSystemWallpaper = async (): Promise<string> => {
    const fromBridge = await readBridgeColor("wallpaperColor");
    if (fromBridge) return fromBridge;
    if (isNeutralinoDesktop()) {
        const appData = (await neuReadEnv("APPDATA")) || (await neuReadEnv("HOME"));
        const candidates = [
            appData ? `${appData.replace(/[\\/]+$/, "")}/Microsoft/Windows/Themes/TranscodedWallpaper` : "",
            appData ? `${appData.replace(/[\\/]+$/, "")}/.cache/wallpaper` : ""
        ].filter(Boolean);
        for (const path of candidates) {
            const blob = await neuReadBinary(path);
            if (blob) {
                const hex = await extractFromImage(blob);
                if (hex) return hex;
            }
        }
    }
    return cachedWallpaperPrimary();
};

export const resolveAppearanceBaseColor = async (
    appearance?: AppearanceColorInput | string | null
): Promise<{ hex: string; source: AppearanceColorSource }> => {
    const input: AppearanceColorInput = typeof appearance === "string" || appearance == null
        ? { color: appearance }
        : appearance;
    const source = resolveColorSource(input.colorSource);
    const custom = normalizeHexColor(input.color);

    const pick = async (fn: () => Promise<string>, tag: AppearanceColorSource): Promise<{ hex: string; source: AppearanceColorSource } | null> => {
        const hex = normalizeHexColor(await fn());
        return hex ? { hex, source: tag } : null;
    };

    if (source === "custom" && custom) return { hex: custom, source: "custom" };
    if (source === "material-you") {
        return (await pick(resolveSystemAccentColor, "material-you")) ?? { hex: custom || FALLBACK_BASE_COLOR, source: custom ? "custom" : "material-you" };
    }
    if (source === "wallpaper") {
        return (
            (await pick(colorFromLiveWallpaperCanvas, "wallpaper")) ??
            (await pick(colorFromAppWallpaper, "wallpaper")) ??
            (await pick(async () => readBridgeColor("wallpaperColor"), "wallpaper")) ??
            { hex: custom || FALLBACK_BASE_COLOR, source: "wallpaper" }
        );
    }
    if (source === "speed-dial") {
        return (await pick(colorFromAppWallpaper, "speed-dial")) ?? { hex: custom || FALLBACK_BASE_COLOR, source: "speed-dial" };
    }
    if (source === "system-wallpaper") {
        return (await pick(colorFromSystemWallpaper, "system-wallpaper")) ?? { hex: custom || FALLBACK_BASE_COLOR, source: "system-wallpaper" };
    }
    return { hex: custom || FALLBACK_BASE_COLOR, source };
};

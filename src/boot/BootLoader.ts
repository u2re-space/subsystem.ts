/**
 * Boot Loader - Shell/Style Initialization System
 * 
 * Manages the boot sequence for the CrossWord application:
 * 1. Load settings and apply document theme (`:root` / color-scheme before Veela paints)
 * 2. Load style system (Veela CSS or Minimal)
 * 3. Initialize shell (frame/layout/environment)
 * 4. Load view/component/module and connect uniform channels
 * 
 * Shell/Style Matrix:
 * | Shells/Styles: | Faint | Minimal | Raw |
 * |----------------|-------|-------|-----|
 * | Veela          |  [r]  |  [o]  | [o] |
 * | Minimal        |  [o]  |  [r]  | [r] |
 * 
 * [r] - recommended, [o] - optional
 */

import { loadAsAdopted } from "fest/dom";
import type { ShellId, ViewId, Shell, ShellTheme } from "shells/types";
import { LS_BOOT_SHELL_LAST_ACTIVE } from "./shell-preference";
import { serviceChannels, type ServiceChannelId } from "com/routing/channel/ServiceChannels";
import { darkTheme, defaultTheme, initializeRegistries, lightTheme, ShellRegistry } from "com/routing/core/registry";
import { initializeLayers } from "com/routing/core/layer-manager";
import { initCwsNativeBridge, isCapacitorCwsNativeShell } from "com/routing/native/cws-bridge";
import { loadSettings, ensureCapacitorCwspSettingsSeeded } from "com/other/config/Settings";
import { DEFAULT_SETTINGS, type AppSettings } from "com/other/config/SettingsTypes";
import { applyTheme } from "com/other/utils";
import { startImplicitViewMessagingBridge } from "com/routing/core/implicit-view-bridge";
import { loadStyleSystem } from "com/styles";
import { isEnabledView, pickEnabledView } from "com/routing/core/views";
import { applyHubSocketFromSettings } from "../boot/hub-socket-boot";
import { ensureCapacitorBridgeDaemonStarted } from "../boot/capacitor-settings-permissions";


// ============================================================================
// BOOT TYPES
// ============================================================================

/**
 * Style system identifiers
 */
export type StyleSystem = "raw" | "vl-core" | "vl-basic" | "vl-advanced" | "vl-beercss";

/**
 * Boot configuration
 */
export interface BootConfig {
    /** Style system to use */
    styleSystem: StyleSystem;
    /** Shell to initialize */
    shell: ShellId;
    /** Initial view to load */
    defaultView: ViewId;
    /** Initial theme */
    theme?: ShellTheme;
    /** Service channels to initialize */
    channels?: ServiceChannelId[];
    /**
     * Channel to init first (sync). Remaining `channels` init on idle so boot
     * stays short; they still initialize before first navigation to those views.
     */
    channelPriorityId?: ServiceChannelId;
    /** Remember preferences */
    rememberChoice?: boolean;
    /**
     * When true, mount shell + channels but do not call {@link Shell.navigate} (no default view).
     * Dismisses the shell loading placeholder. For CRX/content overlays that start fully transparent.
     */
    skipInitialNavigate?: boolean;
}

/**
 * Boot state
 */
export interface BootState {
    phase: "idle" | "styles" | "shell" | "view" | "channels" | "ready" | "error";
    styleSystem: StyleSystem | null;
    shell: ShellId | null;
    view: ViewId | null;
    error: Error | null;
}

/**
 * Boot phase handler
 */
export type BootPhaseHandler = (state: BootState) => void | Promise<void>;

const normalizeShellId = (shell: ShellId): ShellId => {
    if (shell === "faint") return "tabbed";
    if (shell === "base") return "immersive";
    return shell;
};

// ============================================================================
// STYLE SYSTEM CONFIGURATION
// ============================================================================

/**
 * Style system configurations
 */
const STYLE_CONFIGS: Record<StyleSystem, {
    name: string;
    stylesheets: string[];
    description: string;
    recommendedShells: ShellId[];
}> = {
    "raw": {
        name: "Raw (No Framework)",
        stylesheets: [],
        description: "No CSS framework, raw browser defaults",
        recommendedShells: ["immersive"]
    },
    "vl-core": {
        name: "Core (Shared Foundation)",
        stylesheets: [],
        description: "Shared foundation styles for all veela variants",
        recommendedShells: ["immersive", "minimal"]
    },
    "vl-basic": {
        name: "Basic Veela Styles",
        stylesheets: [],
        description: "Minimal styling for basic functionality",
        recommendedShells: ["window", "tabbed", "minimal", "environment", "immersive", "content"]
    },
    "vl-advanced": {
        name: "Advanced (Full-Featured Styling)",
        stylesheets: [],
        description: "Full-featured styling with design tokens and effects",
        recommendedShells: ["tabbed", "minimal", "environment"]
    },
    "vl-beercss": {
        name: "BeerCSS (Beer CSS Compatible)",
        stylesheets: [],
        description: "Beer CSS compatible styling with Material Design 3",
        recommendedShells: ["tabbed"]
    }
};

/**
 * Get recommended style system for a shell
 */
export function getRecommendedStyle(shell: ShellId): StyleSystem {
    switch (shell) {
        case "faint":
        case "tabbed":
            return "vl-basic";
        case "window":
        case "environment":
            return "vl-basic";
        case "minimal":
            return "vl-basic";
        case "base":
        case "immersive":
            return "vl-basic";
        case "content":
            return "vl-basic";
        default:
            return "vl-core";
    }
}

// ============================================================================
// BOOT LOADER CLASS
// ============================================================================

/**
 * Boot Loader
 * 
 * Manages the application boot sequence with proper ordering:
 * Styles → Shell → View → Channels
 */
export class BootLoader {
    private static instance: BootLoader;
    
    // State (use object for mutable state tracking)
    private state: BootState = {
        phase: "idle",
        styleSystem: null,
        shell: null,
        view: null,
        error: null
    };
    
    // State change handlers
    private stateChangeHandlers = new Set<(state: BootState) => void>();
    
    // Loaded shell instance
    private shellInstance: Shell | null = null;

    /** MutationObserver-driven view host bindings (shared routing); disconnected between boots. */
    private implicitBridgeCleanup: (() => void) | null = null;
    
    
    // Phase handlers for customization
    private phaseHandlers = new Map<BootState["phase"], Set<BootPhaseHandler>>();

    private constructor() {
        // Initialize registries
        initializeRegistries();
    }

    static getInstance(): BootLoader {
        if (!BootLoader.instance) {
            BootLoader.instance = new BootLoader();
        }
        return BootLoader.instance;
    }

    // ========================================================================
    // BOOT SEQUENCE
    // ========================================================================

    /**
     * Execute the boot sequence
     */
    async boot(container: HTMLElement, config: BootConfig): Promise<Shell> {
        console.log("[BootLoader] Starting boot sequence:", config);
        
        try {
            // If bootstrap runs more than once in the same document (cold-start retries,
            // SW handoffs, etc.), dispose previous shell instance to avoid stale handlers.
            if (this.shellInstance) {
                try {
                    this.implicitBridgeCleanup?.();
                    this.implicitBridgeCleanup = null;
                    ShellRegistry.unload(this.shellInstance.id);
                } catch (error) {
                    console.warn("[BootLoader] Failed to unload previous shell:", error);
                } finally {
                    this.shellInstance = null;
                }
            }

            // Establish canonical cascade layer order before any stylesheet loads.
            initializeLayers();

            void initCwsNativeBridge().catch(() => {
                /* Capacitor / CWSAndroid bridge is optional on pure web */
            });
            try {
                const { initFrontendDebugCapture } = await import("./frontend-debug-capture");
                initFrontendDebugCapture();
            } catch {
                /* optional */
            }

            // Phase 0: Settings first — apply appearance to :root before Veela/shell CSS loads so
            // M3 tokens + color-scheme resolve to the saved theme on first paint (avoids light→dark flash).
            const persistedSettings = await loadSettings().catch((error) => {
                console.warn("[BootLoader] Failed to load settings:", error);
                return null;
            });
            let effectiveSettings = persistedSettings;
            if (isCapacitorCwsNativeShell()) {
                const seeded = await ensureCapacitorCwspSettingsSeeded().catch(() => null);
                if (seeded) effectiveSettings = seeded;
            }
            if (effectiveSettings) {
                void applyHubSocketFromSettings(effectiveSettings).catch(() => undefined);
            }
            // WHY: Capacitor clipboard/WS lives in CwspBridgeService — start on boot, not only Settings Save.
            if (isCapacitorCwsNativeShell()) {
                void ensureCapacitorBridgeDaemonStarted(effectiveSettings).catch((error) => {
                    console.warn("[BootLoader] CWSP bridge daemon auto-start skipped:", error);
                });
            }
            applyTheme(effectiveSettings ?? DEFAULT_SETTINGS);

            // PWA: register SW, clipboard/share receivers, consume ?shared=1 / pending share payloads.
            // Dynamic import avoids wiring the whole stack into unrelated boot paths (extensions, demos).
            // WHY: Neutralino/desktop must not await SW ingress — can stall first paint on file:// / neu.
            // WHY: /cwsp + gateway :8434 SPA ship no sw.js — probing floods 404s (/sw.js, /apps/cw/sw.js).
            const skipPwaIngress = (() => {
                try {
                    const g = globalThis as unknown as {
                        __CWS_NEUTRALINO_BOOT__?: boolean;
                        __CWS_WEBNATIVE_BOOT__?: boolean;
                        __CWS_SKIP_PWA__?: boolean;
                        Neutralino?: unknown;
                        NL_OS?: string;
                    };
                    const surface =
                        typeof document !== "undefined"
                            ? String(document.documentElement?.dataset?.cwspSurface || "")
                            : "";
                    return Boolean(
                        g.__CWS_SKIP_PWA__ ||
                            g.__CWS_NEUTRALINO_BOOT__ ||
                            g.__CWS_WEBNATIVE_BOOT__ ||
                            g.Neutralino ||
                            typeof g.NL_OS === "string" ||
                            surface === "cwsp-control" ||
                            surface === "gateway"
                    );
                } catch {
                    return false;
                }
            })();
            if (!skipPwaIngress) {
                try {
                    const { initIngressPWA } = await import("shared/routing/pwa/sw-handling");
                    await initIngressPWA();
                } catch (e) {
                    console.warn("[BootLoader] Share-target / service worker ingress failed (non-fatal):", e);
                }
            }

            // Phase 1: Style system (Veela, etc.) after document theme attrs are stable.
            await this.loadStyles(config.styleSystem);

            const persistedTheme = this.resolveThemeFromSettings(persistedSettings);

            // Phase 2: Initialize Shell
            const shell = await this.loadShell(config.shell, container);

            // Phase 3: Shell theme ref (DOM apply runs on mount when rootElement exists)
            shell.setTheme(config.theme || persistedTheme);

            // Phase 4: Mount Shell
            await shell.mount(container);

            // Implicit DOM-discovered receive bindings (views expose `handleMessage` / APIs; no transport mixins required).
            this.implicitBridgeCleanup?.();
            this.implicitBridgeCleanup = startImplicitViewMessagingBridge();

            // Phase 5: Initialize channels (primary sync, rest on idle)
            if (config.channels && config.channels.length > 0) {
                await this.initChannels(config.channels, config.channelPriorityId);
            }
            
            // Phase 6: Initial view (optional — content-script shells may stay chromeless/empty).
            if (config.skipInitialNavigate) {
                this.dismissShellLoadingSpinner(shell);
            } else {
                await shell.navigate(config.defaultView);
            }
            
            // Mark as ready
            this.setPhase("ready");
            
            // Save preferences
            if (config.rememberChoice) {
                this.savePreferences(config);
            }
            
            console.log("[BootLoader] Boot complete");
            return shell;
            
        } catch (error) {
            console.error("[BootLoader] Boot failed:", error);
            this.updateState({
                phase: "error",
                error: error as Error
            });
            throw error;
        }
    }

    private resolveThemeFromSettings(settings: AppSettings | null | undefined): ShellTheme {
        const theme = settings?.appearance?.theme || "auto";
        if (theme === "dark") return darkTheme;
        if (theme === "light") return lightTheme;
        return defaultTheme;
    }

    /** Hide immersive/minimal shell loading row when skipping {@link Shell.navigate}. */
    private dismissShellLoadingSpinner(shell: Shell): void {
        try {
            const el = shell.getElement();
            const loading = el.shadowRoot?.querySelector(".app-shell__loading") as HTMLElement | null;
            if (loading) loading.hidden = true;
        } catch {
            /* ignore */
        }
    }

    /**
     * Load style system
     */
    private async loadStyles(styleSystem: StyleSystem): Promise<void> {
        this.setPhase("styles");
        console.log(`[BootLoader] Loading style system: ${styleSystem}`);
        
        const config = STYLE_CONFIGS[styleSystem] || STYLE_CONFIGS["vl-basic"];

        try {
            await loadStyleSystem(styleSystem);
        } catch (error) {
            console.error(`[BootLoader] Failed to load style system: ${styleSystem}`, error);
            throw error;
        }

        // Load any additional stylesheets
        for (const sheet of config.stylesheets) {
            try {
                await loadAsAdopted(sheet);
            } catch (error) {
                console.warn(`[BootLoader] Failed to load stylesheet: ${sheet}`, error);
            }
        }
        
        this.updateState({ styleSystem });
        console.log(`[BootLoader] Style system ${styleSystem} loaded`);
    }

    /**
     * Load and initialize shell
     */
    private async loadShell(shellId: ShellId, container: HTMLElement): Promise<Shell> {
        this.setPhase("shell");
        const normalizedShell = normalizeShellId(shellId);
        if (normalizedShell !== shellId) {
            console.warn(`[BootLoader] Shell "${shellId}" is temporarily disabled, redirecting to "${normalizedShell}"`);
        }
        console.log(`[BootLoader] Loading shell: ${normalizedShell}`);
        
        const shell = await ShellRegistry.load(normalizedShell, container);
        
        this.shellInstance = shell;
        this.updateState({ shell: normalizedShell });
        
        console.log(`[BootLoader] Shell ${normalizedShell} loaded`);
        return shell;
    }

    /**
     * Initialize service channels: one high-priority channel blocks boot, the rest
     * run when the browser is idle so startup stays within interactive budgets.
     */
    private async initChannels(
        channelIds: ServiceChannelId[],
        priorityId?: ServiceChannelId
    ): Promise<void> {
        this.setPhase("channels");
        const unique = [...new Set(channelIds)];
        if (unique.length === 0) return;

        const primary =
            (priorityId && unique.includes(priorityId) ? priorityId : null) ?? unique[0];
        const rest = unique.filter((id) => id !== primary);

        console.log(
            `[BootLoader] Initializing primary channel:`,
            primary,
            rest.length ? `(+${rest.length} deferred)` : ""
        );

        try {
            await serviceChannels.initChannel(primary);
        } catch (error) {
            console.warn(`[BootLoader] Failed to init primary channel ${primary}:`, error);
        }

        if (rest.length === 0) {
            console.log("[BootLoader] Channels initialized");
            return;
        }

        const runDeferred = (): void => {
            void (async () => {
                for (const channelId of rest) {
                    try {
                        await serviceChannels.initChannel(channelId);
                    } catch (error) {
                        console.warn(`[BootLoader] Failed to init channel ${channelId}:`, error);
                    }
                }
                console.log("[BootLoader] Deferred channels initialized:", rest);
            })();
        };

        if (typeof globalThis.requestIdleCallback === "function") {
            globalThis.requestIdleCallback(runDeferred, { timeout: 5000 });
        } else {
            globalThis.setTimeout?.(runDeferred, 0);
        }
    }

    // ========================================================================
    // STATE MANAGEMENT
    // ========================================================================

    /**
     * Update state and notify handlers
     */
    private updateState(partial: Partial<BootState>): void {
        Object.assign(this.state, partial);
        this.notifyStateChange();
    }

    /**
     * Set current phase and notify handlers
     */
    private setPhase(phase: BootState["phase"]): void {
        this.updateState({ phase });
        
        const handlers = this.phaseHandlers.get(phase);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(this.state);
                } catch (error) {
                    console.error(`[BootLoader] Phase handler error:`, error);
                }
            }
        }
    }

    /**
     * Notify all state change handlers
     */
    private notifyStateChange(): void {
        for (const handler of this.stateChangeHandlers) {
            try {
                handler(this.state);
            } catch (error) {
                console.error(`[BootLoader] State handler error:`, error);
            }
        }
    }

    /**
     * Subscribe to state changes
     */
    onStateChange(handler: (state: BootState) => void): () => void {
        this.stateChangeHandlers.add(handler);
        return () => {
            this.stateChangeHandlers.delete(handler);
        };
    }

    /**
     * Register a phase handler
     */
    onPhase(phase: BootState["phase"], handler: BootPhaseHandler): () => void {
        if (!this.phaseHandlers.has(phase)) {
            this.phaseHandlers.set(phase, new Set());
        }
        this.phaseHandlers.get(phase)!.add(handler);
        
        return () => {
            this.phaseHandlers.get(phase)?.delete(handler);
        };
    }

    /**
     * Get current state
     */
    getState(): BootState {
        return { ...this.state };
    }

    /**
     * Get current shell instance
     */
    getShell(): Shell | null {
        return this.shellInstance;
    }

    // ========================================================================
    // PREFERENCES
    // ========================================================================

    /**
     * Save boot preferences
     */
    private savePreferences(config: BootConfig): void {
        try {
            const normalizedShell = normalizeShellId(config.shell);
            localStorage.setItem("rs-boot-style", config.styleSystem);
            localStorage.setItem("rs-boot-shell", normalizedShell);
            localStorage.setItem("rs-boot-view", config.defaultView);
            localStorage.setItem("rs-boot-remember", "1");
        } catch (error) {
            console.warn("[BootLoader] Failed to save preferences:", error);
        }
    }

    /**
     * Load boot preferences
     */
    loadPreferences(): Partial<BootConfig> | null {
        try {
            const remember = localStorage.getItem("rs-boot-remember");
            if (remember !== "1") return null;
            const shell = normalizeShellId((localStorage.getItem("rs-boot-shell") as ShellId) || "minimal");
            
            return {
                styleSystem: (localStorage.getItem("rs-boot-style") as StyleSystem) || undefined,
                shell,
                defaultView: (localStorage.getItem("rs-boot-view") as ViewId) || undefined
            };
        } catch {
            return null;
        }
    }

    /**
     * Clear preferences
     */
    clearPreferences(): void {
        try {
            localStorage.removeItem("rs-boot-style");
            localStorage.removeItem("rs-boot-shell");
            localStorage.removeItem("rs-boot-view");
            localStorage.removeItem("rs-boot-remember");
            localStorage.removeItem(LS_BOOT_SHELL_LAST_ACTIVE);
        } catch {
            // Ignore
        }
    }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * Get the singleton boot loader
 */
export const bootLoader = BootLoader.getInstance();

/**
 * Quick boot with default configuration
 */
export async function quickBoot(
    container: HTMLElement,
    shell: ShellId = "window",
    view: ViewId = "home"
): Promise<Shell> {
    return bootLoader.boot(container, {
        styleSystem: getRecommendedStyle(shell),
        shell,
        defaultView: view,
        channels: [view as ServiceChannelId],
        rememberChoice: false
    });
}

/**
 * Boot with Veela + Faint shell
 */
export async function bootFaint(
    container: HTMLElement,
    view: ViewId = "viewer"
): Promise<Shell> {
    return bootTabbed(container, view);
}

export async function bootTabbed(
    container: HTMLElement,
    view: ViewId = "home"
): Promise<Shell> {
    const channels = ["workcenter", "settings", "viewer", "explorer", "history", "editor", "home"]
        .filter((channelId) => isEnabledView(channelId)) as ServiceChannelId[];
    const defaultView = pickEnabledView(view, "home");
    const channelPriorityId: ServiceChannelId | undefined =
        (channels.find((c) => c === defaultView) ?? channels[0]) as ServiceChannelId | undefined;
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "tabbed",
        defaultView,
        channels,
        channelPriorityId,
        rememberChoice: true
    });
}

export async function bootEnvironment(
    container: HTMLElement,
    view: ViewId = "home"
): Promise<Shell> {
    const channels = ["workcenter", "settings", "viewer", "explorer", "history", "editor", "home"]
        .filter((channelId) => isEnabledView(channelId)) as ServiceChannelId[];
    const defaultView = pickEnabledView(view, "home");
    const channelPriorityId: ServiceChannelId | undefined =
        (channels.find((c) => c === defaultView) ?? channels[0]) as ServiceChannelId | undefined;
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "environment",
        defaultView,
        channels,
        channelPriorityId,
        rememberChoice: true
    });
}

/**
 * Boot with Minimal shell
 */
export async function bootMinimal(
    container: HTMLElement,
    view: ViewId = "viewer",
    options?: BootShellEntryOptions
): Promise<Shell> {
    const defaultView = pickEnabledView(view, "viewer");
    /** Minimal shell: init only the active view's channel — others register on first navigate (see ShellBase.loadView). */
    const channels = isEnabledView(defaultView)
        ? ([defaultView] as ServiceChannelId[])
        : (["viewer"] as ServiceChannelId[]);
    const channelPriorityId = channels[0];
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "minimal",
        defaultView,
        channels,
        channelPriorityId,
        rememberChoice: options?.rememberChoice ?? true,
        skipInitialNavigate: options?.skipInitialNavigate ?? false
    });
}

export async function bootWindow(
    container: HTMLElement,
    view: ViewId = "home"
): Promise<Shell> {
    const channels = ["workcenter", "settings", "viewer", "explorer", "history", "editor", "home"]
        .filter((channelId) => isEnabledView(channelId)) as ServiceChannelId[];
    const defaultView = pickEnabledView(view, "home");
    const channelPriorityId: ServiceChannelId | undefined =
        (channels.find((c) => c === defaultView) ?? channels[0]) as ServiceChannelId | undefined;
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "window",
        defaultView,
        channels,
        channelPriorityId,
        rememberChoice: true
    });
}

/**
 * Boot with Raw shell (minimal)
 */
export async function bootBase(
    container: HTMLElement,
    view: ViewId = "viewer"
): Promise<Shell> {
    // COMPAT: persisted / URL `base` still maps through loadShell; registry resolves to `immersive` module.
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "base",
        defaultView: pickEnabledView(view, "viewer"),
        channels: [],
        rememberChoice: false
    });
}

/** Optional flags for convenience boot entrypoints (`bootContent`, `bootImmersive`, …). */
export type BootShellEntryOptions = {
    /** When false, skip writing `rs-boot-shell` / view prefs (demos, shared-origin harnesses). Default true. */
    rememberChoice?: boolean;
    /** See {@link BootConfig.skipInitialNavigate}. */
    skipInitialNavigate?: boolean;
    /**
     * When set, replaces the default service-channel list for this boot (e.g. `[]` for a bare overlay).
     */
    channels?: ServiceChannelId[];
};

export async function bootContent(
    container: HTMLElement,
    view: ViewId = "home",
    options?: BootShellEntryOptions
): Promise<Shell> {
    const defaultChannelIds = ["workcenter", "settings", "viewer", "explorer", "history", "editor", "home"] as const;
    const defaultChannels = defaultChannelIds.filter((channelId) => isEnabledView(channelId)) as ServiceChannelId[];
    const channels =
        options?.channels !== undefined ? options.channels : defaultChannels;
    const defaultView = pickEnabledView(view, "home");
    const channelPriorityId: ServiceChannelId | undefined =
        channels.length > 0
            ? ((channels.find((c) => c === defaultView) ?? channels[0]) as ServiceChannelId | undefined)
            : undefined;
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "content",
        defaultView,
        channels,
        channelPriorityId,
        rememberChoice: options?.rememberChoice ?? true,
        skipInitialNavigate: options?.skipInitialNavigate ?? false
    });
}

/**
 * Immersive (chromeless): extension side panels / fullscreen single-view contexts.
 */
export async function bootImmersive(
    container: HTMLElement,
    view: ViewId = "viewer",
    options?: BootShellEntryOptions
): Promise<Shell> {
    const defaultView = pickEnabledView(view, "viewer");
    const channels = isEnabledView(defaultView)
        ? ([defaultView] as ServiceChannelId[])
        : (["viewer"] as ServiceChannelId[]);
    const channelPriorityId = channels[0];
    return bootLoader.boot(container, {
        styleSystem: "vl-basic",
        shell: "immersive",
        defaultView,
        channels,
        channelPriorityId,
        rememberChoice: options?.rememberChoice ?? true,
        skipInitialNavigate: options?.skipInitialNavigate ?? false
    });
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default bootLoader;

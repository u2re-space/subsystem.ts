import { ref } from "fest/object";
import type { Shell, ShellContext, ShellId, ShellLayoutConfig, ShellNavigationState, ShellTheme, View, ViewId } from "../types";
import { loadInlineStyle, preloadStyle } from "fest/dom";
import { ViewRegistry } from "shared/routing/registry";
import { showToast } from "./toast";
import { withViewTransition, getTransitionDirection } from "shared/routing/view-transitions";
import { loadSettings, saveSettings } from "shared/config/Settings";
import {
    applyTheme as applyAppTheme,
    resyncThemeAfterAdoptedViewSheet,
    syncBrowserChromeTheme
} from "shared/utils/Theme";
import { isEnabledView } from "shared/routing/views";
import { scheduleViewModulePrefetch } from "shared/routing/view-prefetch";
import { serviceChannels, type ServiceChannelId } from "com/core/ServiceChannels";
import { ensureStyleSheet } from "fest/icon";
import "fest/icon";
import { dynamicTheme } from "fest/lure";
import { initBootShellWindowActivity } from "./shell-preference";
import {
    type ShellElement,
    ensureShellElementDefined
} from "./shell-elements";

//@ts-ignore
import style from "./views.scss?inline";

/** Views backed by {@link SERVICE_CHANNEL_CONFIG}; lazily initialized on first navigate when not boot-preloaded. */
const VIEW_SERVICE_CHANNEL_IDS = new Set<string>([
    "workcenter",
    "settings",
    "viewer",
    "explorer",
    "airpad",
    "print",
    "history",
    "editor",
    "home"
]);

/**
 * Abstract base shell with common functionality
 */
export abstract class ShellBase implements Shell {
    // Shell properties
    abstract id: ShellId;
    abstract name: string;
    abstract layout: ShellLayoutConfig;

    // State (using any to work around fest/object type inference issue)
    theme = ref<ShellTheme>({ id: "auto", name: "Auto", colorScheme: "auto" });
    currentView = ref<ViewId>("home");
    protected navigationState: ShellNavigationState = {
        currentView: "home",
        viewHistory: []
    };

    // DOM elements
    protected container: HTMLElement | null = null;
    protected rootElement: HTMLElement | null = null;
    protected contentContainer: HTMLElement | null = null;
    protected toolbarContainer: HTMLElement | null = null;
    protected toolbarViewSlot: HTMLElement | null = null;
    protected toolbarThemeSlot: HTMLElement | null = null;
    protected statusContainer: HTMLElement | null = null;
    protected overlayContainer: HTMLElement | null = null;

    // View cache
    protected loadedViews = new Map<ViewId, { view: View; element: HTMLElement }>();
    protected currentViewElement: HTMLElement | null = null;
    protected navigationToken = 0;

    // Mounted state
    protected mounted = false;
    protected themeCycleButton: HTMLButtonElement | null = null;
    protected themeCycleIcon: HTMLElement | null = null;
    protected themeAttrObserver: MutationObserver | null = null;
    private shellActivityDispose: (() => void) | null = null;
    /** When `colorScheme` is `auto`, re-run `applyTheme` on OS light/dark changes. */
    private systemColorSchemeMq: MediaQueryList | null = null;
    private systemColorSchemeHandler: (() => void) | null = null;

    // ========================================================================
    // ABSTRACT METHODS (to be implemented by concrete shells)
    // ========================================================================

    /**
     * Create the shell's root layout element
     */
    protected abstract createLayout(): HTMLElement;

    /**
     * Get shell-specific stylesheet (optional)
     */
    protected abstract getStylesheet(): string | null;

    // ========================================================================
    // SHELL INTERFACE IMPLEMENTATION
    // ========================================================================

    async mount(container: HTMLElement): Promise<void> {
        if (this.mounted) {
            console.warn(`[${this.id}] Shell already mounted`);
            return;
        }

        this.container = container;

        // Load stylesheet if provided
        const stylesheet = this.getStylesheet();
        if (stylesheet) {
            const styled = await preloadStyle(stylesheet);
            if (styled) {
                await loadInlineStyle(stylesheet);
            }
        }

        // Create slotted shell host and mount shell layout into it.
        const shellTagName = ensureShellElementDefined(this.id);
        const shellHost = document.createElement(shellTagName) as ShellElement;
        const shellLayout = this.createLayout();
        shellHost.mountShellLayout(shellLayout);
        this.rootElement = shellHost;

        // Minimal shell chrome is inside shadow — duplicate shell CSS there (document-level rules do not pierce shadow).
        const shellCss = this.getStylesheet();
        if (shellCss && shellHost.shadowRoot) {
            loadInlineStyle(shellCss, shellHost.shadowRoot);
        }

        // Phosphor rules live on document.adoptedStyleSheets; they do not pierce this shadow tree.
        if (this.id === "minimal" && shellHost.shadowRoot) {
            const iconSheet = ensureStyleSheet();
            if (iconSheet) {
                try {
                    const cur = [...shellHost.shadowRoot.adoptedStyleSheets];
                    if (!cur.includes(iconSheet)) {
                        shellHost.shadowRoot.adoptedStyleSheets = [...cur, iconSheet];
                    }
                } catch (e) {
                    console.warn("[Shell] Could not adopt icon registry stylesheet into minimal shell shadow:", e);
                }
            }
        }

        // CRITICAL: Set data-shell attribute for context-based CSS selectors
        // This enables :has([data-shell="...""]) selectors to cascade automatically
        this.rootElement.setAttribute('data-shell', this.id);
        this.rootElement.setAttribute('data-shell-system', 'task-tab');
        // Shell layer is now a 3-row grid (status/content/dock). Every shell host must be
        // explicitly anchored to the content row, otherwise auto-placement can collapse it
        // into `max-content` rows (observed as ~1px shell height in base/minimal).
        this.rootElement.style.gridColumn = "content-column";
        this.rootElement.style.gridRow = "content-row";
        this.rootElement.style.alignSelf = "stretch";
        this.rootElement.style.justifySelf = "stretch";
        this.rootElement.style.minInlineSize = "0";
        // Immersive mounts flush in `#app` without app-layers grid; min-size 0 + inline host = 0 height.
        // Let immersive `base.scss` :host set `min-block-size` / `min-height` instead.
        if (this.id !== "immersive" && this.id !== "content") {
            this.rootElement.style.minBlockSize = "0";
        } else {
            this.rootElement.style.minBlockSize = "";
        }
        // WHY: Content-script shell is an overlay; hits pass through to the host page unless a view/overlay opts in.
        this.rootElement.style.pointerEvents = this.id === "content" ? "none" : "auto";

        // Find containers
        this.contentContainer = shellLayout.querySelector("[data-shell-content]") || shellLayout;
        this.toolbarContainer = shellLayout.querySelector("[data-shell-toolbar]");
        this.statusContainer = shellLayout.querySelector("[data-shell-status]");
        this.overlayContainer = shellLayout.querySelector("[data-shell-overlays]");
        this.ensureToolbarChrome();

        // Apply initial theme
        this.applyTheme(this.getThemeRefValue());
        this.bindThemeAttrObserver();

        // Mount to container
        container.replaceChildren(this.rootElement);
        this.mounted = true;
        // Overlay / chromeless shells: do not fight `rs-boot-shell-last-active` or other tabs' last-active.
        this.shellActivityDispose =
            this.id === "immersive" || this.id === "content"
                ? null
                : initBootShellWindowActivity(this.id);

        // Align navigation state with the URL before the first boot navigate(), so the
        // outgoing "previous" view is not a stale placeholder (e.g. "home" on /viewer).
        this.syncNavigationFromUrl();
        this.reconcileBootShellQueryParam();

        // LUR.E dynamic theme owns meta[name="theme-color"] for frame/WCO tinting.
        try {
            (globalThis as any).__LURE_DYNAMIC_THEME_PRIORITY__ = true;
            dynamicTheme(document.documentElement);
        } catch (e) {
            console.warn(`[${this.id}] dynamicTheme init failed:`, e);
        }

        console.log(`[${this.id}] Shell mounted with data-shell="${this.id}"`);
    }

    /** Match route search params (order-insensitive). */
    private sameRouteParams(
        a?: Record<string, string>,
        b?: Record<string, string>
    ): boolean {
        const ea = new URLSearchParams(a || {});
        const eb = new URLSearchParams(b || {});
        if (ea.toString() === eb.toString()) return true;
        const keys = new Set<string>([...ea.keys(), ...eb.keys()]);
        for (const k of keys) {
            if (ea.get(k) !== eb.get(k)) return false;
        }
        return true;
    }

    /**
     * When the shell mounts on a path-backed view, mirror it into navigation state so
     * boot / first navigate() does not treat a placeholder as the previous view.
     */
    protected syncNavigationFromUrl(): void {
        if (typeof window === "undefined" || typeof window == "undefined") return;

        const stateView = (globalThis?.history?.state as { viewId?: ViewId } | null)?.viewId;
        const fromPath = this.getViewFromPathname();
        const resolved = stateView && isEnabledView(String(stateView))
            ? stateView
            : fromPath && isEnabledView(String(fromPath))
              ? fromPath
              : null;
        if (!resolved) return;

        this.navigationState.currentView = resolved;
        this.navigationState.previousView = undefined;
        this.navigationState.params = Object.fromEntries(
            new URLSearchParams(globalThis.location?.search || "")
        );
        this.currentView.value = resolved;
        this.navigationState.viewHistory = [resolved];
    }

    /**
     * If the address bar carries `?shell=` from another host/tab (e.g. immersive) while this
     * instance is content/minimal/…, fix the hint so routing and mental model match reality.
     */
    protected reconcileBootShellQueryParam(): void {
        if (typeof globalThis.window === "undefined") return;
        try {
            const raw = (globalThis.location?.search || "").replace(/^\?/, "");
            const params = new URLSearchParams(raw);
            const qs = (params.get("shell") || "").trim().toLowerCase();
            if (!qs) return;
            if (qs === String(this.id)) return;
            params.set("shell", this.id);
            const search = params.toString();
            const next = globalThis.location.pathname + (search ? `?${search}` : "");
            globalThis.history?.replaceState?.(globalThis.history.state ?? null, "", next);
        } catch {
            /* ignore */
        }
    }

    unmount(): void {
        if (!this.mounted) return;

        this.shellActivityDispose?.();
        this.shellActivityDispose = null;

        // Cleanup views
        for (const [viewId] of this.loadedViews) {
            try {
                ViewRegistry.unload(viewId);
            } catch (e) {
                console.warn(`[${this.id}] View ${viewId} unmount error:`, e);
            }
        }
        this.loadedViews.clear();

        // Clear DOM
        this.rootElement?.remove();
        this.rootElement = null;
        this.contentContainer = null;
        this.toolbarContainer = null;
        this.statusContainer = null;
        this.overlayContainer = null;
        this.container = null;
        this.mounted = false;
        this.themeAttrObserver?.disconnect();
        this.themeAttrObserver = null;
        this.teardownSystemColorSchemeListener();

        try {
            delete document.documentElement.dataset.activeView;
        } catch {
            /* ignore */
        }

        console.log(`[${this.id}] Shell unmounted`);
    }

    async navigate(viewId: ViewId, params?: Record<string, string>): Promise<void> {
        console.log(`[${this.id}] Navigating to: ${viewId}`, params);
        const navToken = ++this.navigationToken;

        // No-op when already showing this view with the same query (avoids duplicate transitions).
        if (
            viewId === this.currentView.value &&
            this.sameRouteParams(params, this.navigationState.params)
        ) {
            const entry = this.loadedViews.get(viewId);
            if (
                entry?.element.isConnected &&
                (this.contentContainer?.contains(entry.element) || this.rootElement?.contains(entry.element)) &&
                !entry.element.hidden
            ) {
                return;
            }
        }

        // Capture previous view BEFORE updating state (needed for direction + onHide)
        const previousView = this.navigationState.currentView;

        // Update navigation state
        this.navigationState.previousView = previousView;
        this.navigationState.currentView = viewId;
        this.navigationState.params = params;

        // Add to history (avoid duplicates)
        if (this.navigationState.viewHistory[this.navigationState.viewHistory.length - 1] !== viewId) {
            this.navigationState.viewHistory.push(viewId);
            // Limit history size
            if (this.navigationState.viewHistory.length > 50) {
                this.navigationState.viewHistory.shift();
            }
        }

        // Update reactive state
        this.currentView.value = viewId;

        // URL contract:
        // - base/minimal shells are path-based (`/${view}?shell=...`) for standalone tabs
        // - other shells keep canonical root (`/?...`) with view in history.state
        if (typeof window !== "undefined" && typeof window != "undefined") {
            const searchParams = new URLSearchParams(params || {});
            // Always stamp the mounted shell — stale `shell=` from another harness must not linger.
            searchParams.set("shell", this.id);
            const isPathRoutedShell =
                this.id === "base" ||
                this.id === "minimal" ||
                this.id === "immersive";
            const search = searchParams.toString()
                ? "?" + searchParams.toString()
                : "";
            const pathname = isPathRoutedShell
                ? `/${String(viewId || "home").replace(/^\/+/, "")}`
                : "/";
            const newPathAndSearch = pathname + search;
            try {
                const next = new URL(newPathAndSearch, globalThis.location.origin);
                const cur = new URL(globalThis.location.href);
                if (next.pathname !== cur.pathname || next.search !== cur.search) {
                    globalThis?.history?.pushState?.(
                        { viewId, params },
                        "",
                        next.pathname + next.search
                    );
                }
            } catch {
                if (
                    globalThis?.location?.pathname !== "/" ||
                    (globalThis?.location?.search || "") !== search
                ) {
                    globalThis?.history?.pushState?.({ viewId, params }, "", newPathAndSearch);
                }
            }
        }

        // Load and render view (load happens outside the transition to avoid blocking it)
        try {
            const element = await this.loadView(viewId, params);
            if (navToken !== this.navigationToken) return;
            await this.renderViewWithTransition(element);
            if (navToken !== this.navigationToken) return;
            scheduleViewModulePrefetch(viewId);
        } catch (error) {
            console.error(`[${this.id}] Failed to load view ${viewId}:`, error);
            this.showMessage(`Failed to load ${viewId}`);
        }
    }

    async loadView(viewId: ViewId, params?: Record<string, string>): Promise<HTMLElement> {
        // Hydrate body token: when a process is opened as a dedicated browser
        // window, the parent shell stashes POST body data in sessionStorage
        // under `_bodyToken`. Recover it and pass as `initialData`.
        let initialData: unknown;
        const bodyToken = params?._bodyToken;
        if (bodyToken) {
            try {
                const raw = globalThis?.sessionStorage?.getItem?.(bodyToken);
                if (raw != null) {
                    globalThis?.sessionStorage?.removeItem?.(bodyToken);
                    try { initialData = JSON.parse(raw); } catch { initialData = raw; }
                }
            } catch {
                // sessionStorage unavailable
            }
        }

        // Check cache first
        const cached = this.loadedViews.get(viewId);
        if (cached) {
            // Some views may replace their own root element during internal rerenders.
            // If the cached root got detached, refresh cache with a new render result.
            if (!cached.element.isConnected) {
                const refreshed = cached.view.render({
                    shellContext: this.getContext(),
                    params,
                    initialData,
                });
                this.loadedViews.set(viewId, { view: cached.view, element: refreshed });
                if (cached.view.lifecycle?.onMount) {
                    await cached.view.lifecycle.onMount();
                }
                return refreshed;
            }
            // Update toolbar if view has one
            if (cached.view.getToolbar && this.toolbarContainer) {
                const toolbar = cached.view.getToolbar();
                this.setViewToolbar(toolbar);
            }
            return cached.element;
        }

        // Load view from registry
        const view = await ViewRegistry.load(viewId, {
            shellContext: this.getContext(),
            params,
            initialData,
        });

        if (VIEW_SERVICE_CHANNEL_IDS.has(viewId)) {
            try {
                await serviceChannels.initChannel(viewId as ServiceChannelId);
            } catch (err) {
                console.warn(`[${this.id}] initChannel(${viewId}) failed:`, err);
            }
        }

        // Render view
        const element = view.render({
            shellContext: this.getContext(),
            params,
            initialData,
        });

        // Cache view
        this.loadedViews.set(viewId, { view, element });

        // Set toolbar if view has one
        if (view.getToolbar && this.toolbarContainer) {
            const toolbar = view.getToolbar();
            this.setViewToolbar(toolbar);
        }

        // Call lifecycle
        if (view.lifecycle?.onMount) {
            await view.lifecycle.onMount();
        }

        return element;
    }

    setTheme(theme: ShellTheme): void {
        (this.theme as any).value = theme;
        this.applyTheme(theme);
        this.syncThemeToolbarControls();
    }

    getContext(): ShellContext {
        return {
            shellId: this.id,
            navigate: (viewId, params) => this.navigate(viewId, params),
            goBack: () => this.goBack(),
            showMessage: (msg, duration) => this.showMessage(msg, duration),
            navigationState: this.navigationState,
            theme: this.getThemeRefValue(),
            layout: this.layout,
            getContentContainer: () => this.contentContainer!,
            getOverlayContainer: () => this.overlayContainer,
            getToolbarContainer: () => this.toolbarContainer,
            setViewToolbar: (toolbar) => this.setViewToolbar(toolbar)
        };
    }

    getElement(): HTMLElement {
        if (!this.rootElement) {
            throw new Error(`[${this.id}] Shell not mounted`);
        }
        return this.rootElement;
    }

    // ========================================================================
    // PROTECTED METHODS
    // ========================================================================

    /**
     * Perform the raw DOM swap for a view change (no transition animation).
     *
     * This is the synchronous inner mutation used both as a standalone call
     * and as the update callback inside `renderViewWithTransition`.
     * `onHide` must be called by the caller BEFORE invoking this when using
     * a view transition so the old view's final state is captured correctly.
     */
    protected renderView(element: HTMLElement): void {
        if (!this.contentContainer) {
            console.warn(`[${this.id}] No content container available`);
            return;
        }

        this.contentContainer.setAttribute("data-current-view", this.currentView.value);

        // Detach previous view from DOM and keep it cached in loadedViews.
        const previousId = this.navigationState.previousView;
        if (previousId && previousId !== this.currentView.value && this.loadedViews.has(previousId)) {
            const prev = this.loadedViews.get(previousId)!;
            prev.element.removeAttribute("data-view");
            prev.element.hidden = true;
            if (this.contentContainer.contains(prev.element)) {
                prev.element.remove();
            }
        }

        // Show active view and mark it for :has() context selectors.
        element.setAttribute("data-view", this.currentView.value);
        element.hidden = false;

        // Add to content if not already there
        if (!this.contentContainer.contains(element)) {
            this.contentContainer.appendChild(element);
        }

        this.currentViewElement = element;

        // Mirror active view on <html> and the shell host. WHY: view roots often sit under an open
        // shadow root; `html:has([data-view="…"])` / `:root:has(…)` cannot match shadow descendants,
        // so Settings / theme token rules that target :root never run on first paint. `html[data-active-view]`
        // inherits into shadow and fixes cold-start styling; `data-active-view` on the host drives ::part-less shell chrome.
        try {
            const vid = this.currentView.value;
            document.documentElement.dataset.activeView = vid;
            if (this.rootElement) this.rootElement.dataset.activeView = vid;
        } catch {
            /* ignore */
        }
    }

    /**
     * Render a view with a View Transition animation.
     *
     * Calls `onHide` on the outgoing view BEFORE the transition starts so the
     * browser captures the old view in its final settled state.  The actual
     * DOM swap runs inside `document.startViewTransition()` so the browser can
     * capture before/after snapshots and cross-fade (or slide) between them.
     *
     * Falls back to a plain `renderView` call on browsers that do not support
     * the View Transition API.
     */
    protected async renderViewWithTransition(element: HTMLElement): Promise<void> {
        if (!this.contentContainer) {
            this.renderView(element);
            this.invokeCurrentViewOnShow();
            return;
        }

        const previousId = this.navigationState.previousView;
        const prevEntry =
            previousId && previousId !== this.currentView.value
                ? this.loadedViews.get(previousId)
                : undefined;

        // Fire onHide BEFORE the transition so the old view's state is stable
        // when the browser captures the "old" snapshot.
        if (prevEntry?.view.lifecycle?.onHide) {
            prevEntry.view.lifecycle.onHide();
        }

        const direction = getTransitionDirection(previousId ?? "", this.currentView.value);

        await withViewTransition(
            () => this.renderView(element),
            {
                direction,
                // Level 2 type labels for richer CSS targeting via
                // :active-view-transition-type() (Chrome 125+).
                types: [direction, `to-${this.currentView.value}`],
            },
        );
        this.invokeCurrentViewOnShow();
    }

    protected resolveShellColorScheme(theme: ShellTheme): "light" | "dark" {
        const prefersDark = globalThis?.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
        return theme.colorScheme === "dark"
            ? "dark"
            : theme.colorScheme === "light"
              ? "light"
              : prefersDark
                ? "dark"
                : "light";
    }

    /**
     * Apply theme to the shell
     */
    protected applyTheme(theme: ShellTheme): void {
        if (!this.rootElement) return;

        const resolved = this.resolveShellColorScheme(theme);

        this.rootElement.dataset.theme = resolved;
        this.rootElement.style.colorScheme = resolved;

        syncBrowserChromeTheme(resolved, theme.colorScheme);

        // Apply CSS variables if provided
        if (theme.cssVariables) {
            for (const [key, value] of Object.entries(theme.cssVariables)) {
                this.rootElement.style.setProperty(key, value);
            }
        }

        this.syncSystemColorSchemeListener();
    }

    private teardownSystemColorSchemeListener(): void {
        if (this.systemColorSchemeMq && this.systemColorSchemeHandler) {
            this.systemColorSchemeMq.removeEventListener("change", this.systemColorSchemeHandler);
        }
        this.systemColorSchemeMq = null;
        this.systemColorSchemeHandler = null;
    }

    /** Keep shell + document chrome aligned when settings use `auto` and the OS scheme changes. */
    private syncSystemColorSchemeListener(): void {
        this.teardownSystemColorSchemeListener();
        if (typeof globalThis.matchMedia !== "function") return;

        const shellTheme = this.getThemeRefValue();
        if (shellTheme.colorScheme !== "auto") return;

        const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
        const handler = (): void => {
            if (!this.mounted || this.getThemeRefValue().colorScheme !== "auto") return;
            this.applyTheme(this.getThemeRefValue());
        };
        this.systemColorSchemeMq = mq;
        this.systemColorSchemeHandler = handler;
        mq.addEventListener("change", handler);
    }

    protected getThemeRefValue(): ShellTheme {
        return (this.theme as any)?.value as ShellTheme;
    }

    /**
     * Go back in navigation history
     */
    protected goBack(): void {
        const history = this.navigationState.viewHistory;
        if (history.length > 1) {
            // Remove current
            history.pop();
            // Navigate to previous
            const previous = history[history.length - 1];
            if (previous) {
                this.navigate(previous);
            }
        }
    }

    /**
     * Show a status message
     */
    protected showMessage(message: string, duration = 3000): void {
        /*if (!this.statusContainer) {
            console.log(`[${this.id}] Status: ${message}`);
            return;
        }

        this.statusContainer.textContent = message;
        this.statusContainer.hidden = false;

        setTimeout(() => {
            if (this.statusContainer?.textContent === message) {
                this.statusContainer.textContent = "";
                this.statusContainer.hidden = true;
            }
        }, duration);*/

        showToast({ message, duration, kind: "info" });
    }

    /**
     * Set the current view's toolbar
     */
    protected setViewToolbar(toolbar: HTMLElement | null): void {
        this.ensureToolbarChrome();
        if (!this.toolbarViewSlot) return;
        this.toolbarViewSlot.replaceChildren();
        if (toolbar) this.toolbarViewSlot.appendChild(toolbar);
    }

    private ensureToolbarChrome(): void {
        if (!this.toolbarContainer) return;
        if (this.toolbarViewSlot && this.toolbarThemeSlot) return;

        this.toolbarContainer.replaceChildren();
        this.toolbarContainer.style.display = "flex";
        this.toolbarContainer.style.alignItems = "center";
        this.toolbarContainer.style.justifyContent = "space-between";
        this.toolbarContainer.style.gap = "0.5rem";
        this.toolbarContainer.style.flexWrap = "wrap";

        const themeSlot = document.createElement("div");
        themeSlot.className = "shell-theme-controls";
        themeSlot.setAttribute("data-shell-toolbar-theme", "true");
        themeSlot.style.display = "inline-flex";
        themeSlot.style.alignItems = "center";
        themeSlot.style.gap = "0.35rem";

        const cycleBtn = document.createElement("button");
        cycleBtn.type = "button";
        cycleBtn.className = "app-shell__nav-btn shell-theme-cycle-btn";
        cycleBtn.setAttribute("aria-label", "Theme: follow system");
        cycleBtn.title = "Theme: follow system — click to pin dark or light, then click again to return to auto";

        const icon = document.createElement("ui-icon");
        icon.setAttribute("icon", "lamp");
        icon.setAttribute("icon-style", "duotone");
        cycleBtn.appendChild(icon);

        cycleBtn.addEventListener("click", () => {
            const mode = this.getThemeModeFromShellTheme();
            if (mode === "auto") {
                const eff = this.resolveEffectiveSystemScheme();
                void this.applyThemeMode(eff === "light" ? "dark" : "light");
            } else {
                void this.applyThemeMode("auto");
            }
        });

        themeSlot.append(cycleBtn);

        const viewSlot = document.createElement("div");
        viewSlot.className = "shell-view-toolbar-slot";
        viewSlot.setAttribute("data-shell-toolbar-view", "true");
        viewSlot.style.display = "inline-flex";
        viewSlot.style.alignItems = "center";
        viewSlot.style.gap = "0.5rem";
        viewSlot.style.flex = "1 1 auto";
        viewSlot.style.justifyContent = "flex-end";

        this.toolbarContainer.append(themeSlot, viewSlot);
        this.toolbarThemeSlot = themeSlot;
        this.toolbarViewSlot = viewSlot;
        this.themeCycleButton = cycleBtn;
        this.themeCycleIcon = icon;
        this.syncThemeToolbarControls();
    }

    private getThemeModeFromShellTheme(): "auto" | "light" | "dark" {
        const theme = this.getThemeRefValue();
        const id = (theme?.id || "").toLowerCase();
        if (id === "dark" || theme?.colorScheme === "dark") return "dark";
        if (id === "light" || theme?.colorScheme === "light") return "light";
        return "auto";
    }

    private resolveEffectiveSystemScheme(): "light" | "dark" {
        return globalThis?.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
    }

    private createShellTheme(mode: "auto" | "light" | "dark"): ShellTheme {
        if (mode === "dark") return { id: "dark", name: "Dark", colorScheme: "dark" };
        if (mode === "light") return { id: "light", name: "Light", colorScheme: "light" };
        return { id: "auto", name: "Auto", colorScheme: "auto" };
    }

    private syncThemeToolbarControls(): void {
        const mode = this.getThemeModeFromShellTheme();
        const effectiveMode = mode === "auto" ? this.getExternalThemeModeHint() : mode;
        const iconEl = this.themeCycleIcon;
        const btn = this.themeCycleButton;
        if (!iconEl || !btn) return;

        const iconName =
            effectiveMode === "light" ? "sun-dim" : effectiveMode === "dark" ? "moon-stars" : "lamp";
        iconEl.setAttribute("icon", iconName);

        if (mode === "auto") {
            btn.title =
                "Theme: follow system — click to pin the opposite of the current appearance, then click again for auto";
            btn.setAttribute("aria-label", "Theme follows system. Activate to pin light or dark.");
        } else if (mode === "light") {
            btn.title = "Theme: light — click to follow system again";
            btn.setAttribute("aria-label", "Light theme is on. Activate to follow system appearance.");
        } else {
            btn.title = "Theme: dark — click to follow system again";
            btn.setAttribute("aria-label", "Dark theme is on. Activate to follow system appearance.");
        }
    }

    private async applyThemeMode(mode: "auto" | "light" | "dark"): Promise<void> {
        this.setTheme(this.createShellTheme(mode));
        try {
            const current = await loadSettings();
            const saved = await saveSettings({
                ...current,
                appearance: {
                    ...(current.appearance || {}),
                    theme: mode
                }
            });
            applyAppTheme(saved);
        } catch (error) {
            console.warn(`[${this.id}] Failed to save theme mode:`, error);
        }
    }

    private getExternalThemeModeHint(): "auto" | "light" | "dark" {
        const scheme = (document?.documentElement?.getAttribute?.("data-scheme") || "").toLowerCase();
        if (scheme === "light" || scheme === "dark") return scheme as "light" | "dark";
        return "auto";
    }

    private bindThemeAttrObserver(): void {
        this.themeAttrObserver?.disconnect();
        if (typeof document === "undefined") return;

        const root = document.documentElement;
        this.themeAttrObserver = new MutationObserver(() => {
            this.syncThemeToolbarControls();
        });
        this.themeAttrObserver.observe(root, {
            attributes: true,
            attributeFilter: ["data-scheme", "data-theme"]
        });
    }

    // ========================================================================
    // PATH-BASED NAVIGATION
    // ========================================================================

    /**
     * Setup path-based navigation (listen to route-change events)
     * @deprecated Use setupPopstateNavigation instead
     */
    protected setupHashNavigation(): void {
        // No-op for backwards compatibility
        // Path-based routing doesn't use hash changes
    }

    /**
     * Setup popstate navigation (back/forward buttons)
     */
    protected setupPopstateNavigation(): void {
        if (typeof window === "undefined" || typeof window == "undefined") return;

        globalThis?.addEventListener?.("popstate", (event) => {
            const navToken = ++this.navigationToken;
            const fallbackView = this.getViewFromPathname();
            const viewId = (event.state?.viewId || fallbackView || "home") as ViewId;
            const popParams = (event.state?.params ??
                Object.fromEntries(new URLSearchParams(globalThis.location.search || ""))) as
                | Record<string, string>
                | undefined;

            if (viewId !== this.currentView.value || !this.sameRouteParams(popParams, this.navigationState.params)) {
                const previousViewId = this.navigationState.currentView;

                // Update state before loading so renderViewWithTransition has
                // correct previousView and currentView values.
                this.navigationState.previousView = previousViewId;
                this.navigationState.currentView = viewId;
                this.navigationState.params = popParams;
                this.currentView.value = viewId;

                // Keep in-memory history consistent with the browser stack.
                const hist = this.navigationState.viewHistory;
                const idx = hist.lastIndexOf(viewId);
                if (idx >= 0) {
                    this.navigationState.viewHistory = hist.slice(0, idx + 1);
                } else {
                    this.navigationState.viewHistory = [viewId];
                }

                this.loadView(viewId, popParams)
                    .then((element) => {
                        if (navToken !== this.navigationToken) return;
                        return this.renderViewWithTransition(element);
                    })
                    .then(() => {
                        if (navToken !== this.navigationToken) return;
                        scheduleViewModulePrefetch(viewId);
                    })
                    .catch(console.error);
            }
        });
    }

    private invokeCurrentViewOnShow(): void {
        const entry = this.loadedViews.get(this.currentView.value);
        if (entry?.view?.lifecycle?.onShow) {
            try {
                entry.view.lifecycle.onShow();
            } catch (error) {
                console.warn(`[${this.id}] View ${this.currentView.value} onShow error:`, error);
            }
        }

        // Settings.scss depends on inherited M3 tokens (`--color-surface`, etc.). Cold start can paint
        // before Veela `light-dark()` + `color-scheme` fully reconcile; visiting another view forces a
        // repaint. Re-apply saved appearance + notify LUR.E dynamic theme after the view sheet mounts.
        if (this.currentView.value === "settings") {
            this.resyncDocumentThemeAfterSettingsShown();
        }
    }

    /**
     * Re-run theme bridge + token consumers after Settings view adopts its document stylesheet.
     * WHY: Fixes hybrid light chrome / dark content on first paint when deep-linking to /settings.
     */
    private resyncDocumentThemeAfterSettingsShown(): void {
        resyncThemeAfterAdoptedViewSheet();
    }

    /**
     * Get view ID from current pathname
     */
    protected getViewFromPathname(): ViewId | null {
        if (typeof window === "undefined" || typeof window == "undefined") return null;

        const pathname = globalThis?.location?.pathname?.replace(/^\//, "").toLowerCase();
        if (!pathname || pathname === "/") {
            const stateView = (globalThis?.history?.state as { viewId?: ViewId } | null)?.viewId;
            return stateView && isEnabledView(String(stateView)) ? stateView : null;
        }
        return isEnabledView(pathname) ? (pathname as ViewId) : null;
    }
}


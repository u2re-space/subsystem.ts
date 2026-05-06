/**
 * Shell System Types
 * 
 * Shells are UI/UX layout systems that provide frame, window, and view management.
 * They do NOT contain application logic - only layout structure and navigation.
 */

import type { refType } from "fest/object";

// ============================================================================
// CORE SHELL TYPES
// ============================================================================

/**
 * Available shell identifiers
 */
export type ShellId = "base" | "window" | "tabbed" | "minimal" | "environment" | "content" | "immersive" | "faint";

/**
 * Available view identifiers
 */
export type ViewId = 
    | "viewer" 
    | "workcenter" 
    | "airpad" 
    | "settings" 
    | "history" 
    | "explorer" 
    | "editor"
    | "home"
    | string; // Allow custom views

/**
 * Theme configuration for shells
 */
export interface ShellTheme {
    id: string;
    name: string;
    colorScheme: "light" | "dark" | "auto";
    cssVariables?: Record<string, string>;
    stylesheetUrl?: string;
}

/**
 * Navigation state within a shell
 */
export interface ShellNavigationState {
    currentView: ViewId;
    previousView?: ViewId;
    viewHistory: ViewId[];
    params?: Record<string, string>;
}

/**
 * Shell layout configuration
 */
export interface ShellLayoutConfig {
    /** Whether shell has a sidebar */
    hasSidebar: boolean;
    /** Whether shell has a toolbar/header */
    hasToolbar: boolean;
    /** Whether shell has a tabbed interface */
    hasTabs: boolean;
    /** Whether shell supports multiple simultaneous views */
    supportsMultiView: boolean;
    /** Whether shell supports window/frame management */
    supportsWindowing: boolean;
}

// ============================================================================
// SHELL INTERFACE
// ============================================================================

/**
 * Shell lifecycle events
 */
export interface ShellEvents {
    onMount?: (shell: Shell) => void | Promise<void>;
    onUnmount?: (shell: Shell) => void | Promise<void>;
    onViewChange?: (viewId: ViewId, shell: Shell) => void | Promise<void>;
    onThemeChange?: (theme: ShellTheme, shell: Shell) => void | Promise<void>;
}

/**
 * Shell context passed to views
 */
export interface ShellContext {
    /** Shell identifier */
    shellId: ShellId;
    /** Navigate to a view */
    navigate: (viewId: ViewId, params?: Record<string, string>) => void | Promise<void>;
    /**
     * Open a view in a stacking/overlay sense when the host supports it; otherwise same as {@link navigate}.
     * WHY: Home/speed-dial code prefers this so dedicated window layers can override without forking view code.
     */
    openView?: (viewId: ViewId, params?: Record<string, string>) => void | Promise<void>;
    /** Go back in navigation history */
    goBack: () => void;
    /** Show a status/toast message */
    showMessage: (message: string, duration?: number) => void;
    /** Current navigation state */
    navigationState: ShellNavigationState;
    /** Current theme */
    theme: ShellTheme;
    /** Shell layout configuration */
    layout: ShellLayoutConfig;
    /** Get the content container for views */
    getContentContainer: () => HTMLElement;
    /**
     * Optional stacking root above main content (modals, dialogs).
     * Base shell exposes a dedicated layer; others return null (use document / app overlay).
     */
    getOverlayContainer: () => HTMLElement | null;
    /** Get the toolbar container (if shell supports it) */
    getToolbarContainer: () => HTMLElement | null;
    /** Register a view toolbar */
    setViewToolbar: (toolbar: HTMLElement | null) => void;
}

/**
 * Core Shell interface
 * 
 * Shells provide the visual frame/layout and navigation,
 * but delegate actual content rendering to Views.
 */
export interface Shell {
    /** Unique identifier */
    id: ShellId;
    
    /** Display name */
    name: string;
    
    /** Layout configuration */
    layout: ShellLayoutConfig;
    
    /** Current theme */
    theme: refType<ShellTheme>;
    
    /** Current view */
    currentView: refType<ViewId>;
    
    /** Mount the shell into a container */
    mount(container: HTMLElement): Promise<void>;
    
    /** Unmount and cleanup */
    unmount(): void;
    
    /** Navigate to a specific view */
    navigate(viewId: ViewId, params?: Record<string, string>): Promise<void>;
    
    /** Load and render a view */
    loadView(viewId: ViewId, params?: Record<string, string>): Promise<HTMLElement>;
    
    /** Set theme */
    setTheme(theme: ShellTheme): void;
    
    /** Get shell context for views */
    getContext(): ShellContext;
    
    /** Get the root element */
    getElement(): HTMLElement;
}

// ============================================================================
// VIEW INTERFACE
// ============================================================================

/**
 * View component options
 */
export interface ViewOptions {
    /** Initial content/data */
    initialData?: unknown;
    /** Shell context */
    shellContext?: ShellContext;
    /** Additional parameters */
    params?: Record<string, string>;
}

/**
 * View lifecycle events
 */
export interface ViewLifecycle {
    /** Called when view is mounted */
    onMount?: () => void | Promise<void>;
    /** Called when view is about to unmount */
    onUnmount?: () => void | Promise<void>;
    /** Called when view becomes visible */
    onShow?: () => void;
    /** Called when view becomes hidden */
    onHide?: () => void;
    /** Called when view should refresh its content */
    onRefresh?: () => void | Promise<void>;
}

/**
 * View component interface
 * 
 * Views are content components that can be loaded into any shell.
 * They should be shell-agnostic and render their own content.
 */
export interface View extends HTMLElement, CustomElementLifecycle {
    /** Unique identifier */
    id: ViewId;
    
    /** Display name */
    name: string;
    
    /** Icon name (from fest/icon) */
    icon?: string;
    
    /** Render the view */
    render(options?: ViewOptions): HTMLElement;
    
    /** Get toolbar element for this view (optional) */
    getToolbar?(): HTMLElement | null;
    
    /** View lifecycle */
    lifecycle?: ViewLifecycle;
    
    /** Whether this view can handle external messages */
    canHandleMessage?(messageType: string): boolean;
    
    /** Handle external message */
    handleMessage?(message: unknown): Promise<void>;
}

/**
 * View factory function type
 */
export type ViewFactory = (options?: ViewOptions) => View | Promise<View>;

// ============================================================================
// VIEW REGISTRY
// ============================================================================

/**
 * View registration entry
 */
export interface ViewRegistration {
    id: ViewId;
    name: string;
    icon?: string;
    /** Dynamic import function for lazy loading */
    loader: () => Promise<{ default: ViewFactory } | { createView: ViewFactory }>;
    /** Pre-loaded view instance (if already loaded) */
    instance?: View;
}

/**
 * Shell registration entry
 */
export interface ShellRegistration {
    id: ShellId;
    name: string;
    description?: string;
    /** Dynamic import function for lazy loading */
    loader: () => Promise<{ default: (container: HTMLElement) => Shell } | { createShell: (container: HTMLElement) => Shell }>;
    /** Pre-loaded shell instance */
    instance?: Shell;
}

// ============================================================================
// BOOT CONFIGURATION
// ============================================================================

/**
 * Boot configuration for app initialization
 */
export interface BootConfig {
    /** Default shell to use */
    defaultShell: ShellId;
    /** Default view to load */
    defaultView: ViewId;
    /** Theme to apply */
    theme?: ShellTheme;
    /** Whether to remember user's shell preference */
    rememberShellChoice: boolean;
    /** Available shells */
    availableShells: ShellRegistration[];
    /** Available views */
    availableViews: ViewRegistration[];
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Result type for async operations
 */
export interface ShellResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
}

/**
 * View content types
 */
export type ContentType = "markdown" | "text" | "html" | "file" | "image" | "json" | "unknown";

/**
 * Content context for view loading
 */
export interface ContentContext {
    type: ContentType;
    data: unknown;
    filename?: string;
    mimeType?: string;
    source?: string;
}

// ============================================================================
// VIEW BASE TYPES
// ============================================================================

/**
 * Base options for view creation
 */
export interface BaseViewOptions extends ViewOptions {
    shellContext?: ShellContext;
    params?: Record<string, string>;
}

/**
 * Markdown content for viewer/editor
 */
export interface MarkdownContent {
    content: string;
    filename?: string;
    source?: string;
    modified?: boolean;
}

/**
 * File content for file-based views
 */
export interface FileContent {
    file: File;
    filename: string;
    mimeType: string;
    path?: string;
}

export type ViewReceiveSource = "share-target" | "launch-queue" | "pending" | "clipboard";

export interface ViewReceiveHint {
    destination?: string;
    action?: "open" | "attach" | "save" | "process";
    filename?: string;
    contentType?: string;
}

export interface ViewReceivePayload {
    source: ViewReceiveSource;
    route: string;
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
    pending?: boolean;
    hint?: ViewReceiveHint;
    metadata?: Record<string, unknown>;
}

/**
 * View state persistence
 */
export interface ViewState<T = unknown> {
    load(): T | null;
    save(state: T): void;
    clear(): void;
}

// ============================================================================
// VIEW EVENT TYPES
// ============================================================================

/**
 * View content change event
 */
export interface ContentChangeEvent {
    content: string;
    source: string;
    timestamp: number;
}

/**
 * View action event
 */
export interface ViewActionEvent {
    action: string;
    payload?: unknown;
    timestamp: number;
}

// ============================================================================
// VIEW UTILITIES
// ============================================================================

/**
 * Create a simple view state persistence helper
 */
export function createViewState<T>(key: string): ViewState<T> {
    return {
        load(): T | null {
            try {
                const stored = localStorage.getItem(key);
                return stored ? JSON.parse(stored) : null;
            } catch {
                return null;
            }
        },
        save(state: T): void {
            try {
                localStorage.setItem(key, JSON.stringify(state));
            } catch {
                // ignore
            }
        },
        clear(): void {
            try {
                localStorage.removeItem(key);
            } catch {
                // ignore
            }
        }
    };
}

/**
 * Create a loading placeholder element
 */
export function createLoadingElement(message = "Loading..."): HTMLElement {
    const el = document.createElement("div");
    el.className = "view-loading";
    el.innerHTML = `
        <div class="view-loading__spinner"></div>
        <span class="view-loading__text">${message}</span>
    `;
    return el;
}

/**
 * Create an error placeholder element
 */
export function createErrorElement(message: string, retryFn?: () => void): HTMLElement {
    const el = document.createElement("div");
    el.className = "view-error";
    el.innerHTML = `
        <div class="view-error__icon">⚠️</div>
        <h3 class="view-error__title">Error</h3>
        <p class="view-error__message">${message}</p>
        ${retryFn ? '<button class="view-error__retry" type="button">Try Again</button>' : ''}
    `;
    
    if (retryFn) {
        const btn = el.querySelector(".view-error__retry");
        btn?.addEventListener("click", retryFn);
    }
    
    return el;
}

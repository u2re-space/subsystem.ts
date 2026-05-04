/**
 * CSS Layer Manager
 *
 * Ensures correct @layer order by injecting layer declarations
 * before any other styles are loaded.
 *
 * This module provides:
 * - Unified layer hierarchy definition
 * - Layer initialization before style loading
 * - Layer name resolution for shells and views
 * - Layer status checking
 *
 * @module layer-manager
 */

import type { ShellId, ViewId } from "shells/types";

// ============================================================================
// TYPES
// ============================================================================

export type LayerCategory = 'system' | 'runtime' | 'shell' | 'view' | 'override';

export interface LayerDefinition {
    /** Layer name (e.g., 'layer.shell.minimal') */
    name: string;
    /** Layer category for grouping */
    category: LayerCategory;
    /** Order value (lower = earlier in cascade) */
    order: number;
    /** Optional description */
    description?: string;
}

export type { ShellId, ViewId };

// ============================================================================
// LAYER HIERARCHY DEFINITION
// ============================================================================

/**
 * Unified layer hierarchy - ORDER MATTERS!
 *
 * Layers are declared in this order to ensure:
 * 1. Reset/normalize come first (lowest specificity wins)
 * 2. Tokens (CSS custom properties) are available early
 * 3. Runtime provides base component styles
 * 4. Shell styles can override runtime
 * 5. View styles can override shell
 * 6. Overrides (theme, print, a11y) win last
 */
export const LAYER_HIERARCHY: LayerDefinition[] = [
    // === SYSTEM LAYERS (order 0-99) ===
    // Canonical normalize/reset aliases used across runtime variants.
    { name: 'ux-normalize',             category: 'system',   order: 0,   description: 'Veela normalize layer' },
    { name: 'layer.reset',              category: 'system',   order: 0,   description: 'CSS reset rules' },
    { name: 'layer.normalize',          category: 'system',   order: 10,  description: 'Normalize browser defaults' },
    { name: 'tokens',                   category: 'system',   order: 20,  description: 'Legacy tokens layer' },
    { name: 'ux-tokens',                category: 'system',   order: 20,  description: 'Veela token layer' },
    { name: 'layer.tokens',             category: 'system',   order: 20,  description: 'CSS custom properties (variables)' },
    { name: 'base',                     category: 'system',   order: 30,  description: 'Legacy base layer' },
    { name: 'ux-base',                  category: 'system',   order: 30,  description: 'Veela base layer' },
    { name: 'layout',                   category: 'system',   order: 40,  description: 'Legacy layout layer' },
    { name: 'ux-layout',                category: 'system',   order: 40,  description: 'Veela layout layer' },
    { name: 'components',               category: 'system',   order: 50,  description: 'Legacy components layer' },
    { name: 'ux-components',            category: 'system',   order: 50,  description: 'Veela components layer' },
    { name: 'utilities',                category: 'system',   order: 60,  description: 'Legacy utilities layer' },
    { name: 'ux-utilities',             category: 'system',   order: 60,  description: 'Veela utilities layer' },
    { name: 'ux-theme',                 category: 'system',   order: 70,  description: 'Veela theme layer' },
    { name: 'ux-overrides',             category: 'system',   order: 80,  description: 'Veela overrides layer' },
    { name: 'layer.properties.shell',   category: 'system',   order: 30,  description: 'Shell context custom properties' },
    { name: 'layer.properties.views',   category: 'system',   order: 35,  description: 'View context custom properties' },

    // === RUNTIME LAYERS (order 100-199) ===
    { name: 'layer.runtime.base',       category: 'runtime',  order: 100, description: 'Veela runtime base styles' },
    { name: 'layer.runtime.components', category: 'runtime',  order: 110, description: 'Reusable component styles' },
    { name: 'layer.runtime.forms',      category: 'runtime',  order: 115, description: 'Form element base styles' },
    { name: 'layer.runtime.utilities',  category: 'runtime',  order: 120, description: 'Utility classes' },
    { name: 'layer.runtime.animations', category: 'runtime',  order: 130, description: 'Keyframes and animation definitions' },
    { name: 'layer.boot',               category: 'runtime',  order: 140, description: 'Boot/choice screen styles' },
    { name: 'boot.tokens',              category: 'runtime',  order: 142, description: 'Boot tokens layer' },
    { name: 'boot.base',                category: 'runtime',  order: 144, description: 'Boot base layer' },
    { name: 'boot.components',          category: 'runtime',  order: 146, description: 'Boot components layer' },
    { name: 'boot.responsive',          category: 'runtime',  order: 148, description: 'Boot responsive adjustments' },

    // === SHELL LAYERS (order 200-299) ===
    { name: 'layer.shell.common',             category: 'shell', order: 200, description: 'Shared shell styles' },
    { name: 'shell.tokens',                   category: 'shell', order: 202, description: 'Legacy shell tokens' },
    { name: 'shell.base',                     category: 'shell', order: 204, description: 'Legacy shell base' },
    { name: 'shell.components',               category: 'shell', order: 206, description: 'Legacy shell components' },
    { name: 'shell.utilities',                category: 'shell', order: 208, description: 'Legacy shell utilities' },
    { name: 'shell.overrides',                category: 'shell', order: 209, description: 'Legacy shell overrides' },
    { name: 'layer.shell.raw',                category: 'shell', order: 210, description: 'Raw shell (minimal)' },
    { name: 'layer.shell.minimal',              category: 'shell', order: 220, description: 'Minimal shell (toolbar navigation)' },
    { name: 'layer.shell.minimal.layout',       category: 'shell', order: 222, description: 'Minimal shell layout rules' },
    { name: 'layer.shell.minimal.components',   category: 'shell', order: 224, description: 'Minimal shell component styles' },
    { name: 'layer.shell.window',             category: 'shell', order: 226, description: 'Window shell (desktop/process frames)' },
    { name: 'layer.shell.faint',              category: 'shell', order: 230, description: 'Faint shell (tabbed sidebar)' },
    { name: 'layer.shell.faint.layout',       category: 'shell', order: 232, description: 'Faint shell layout' },
    { name: 'layer.shell.faint.sidebar',      category: 'shell', order: 234, description: 'Faint shell sidebar' },
    { name: 'layer.shell.faint.toolbar',      category: 'shell', order: 236, description: 'Faint shell toolbar' },
    { name: 'layer.shell.faint.forms',        category: 'shell', order: 238, description: 'Faint shell form components' },

    // === VIEW LAYERS (order 300-399) ===
    { name: 'layer.view.common',              category: 'view', order: 300, description: 'Shared view styles' },
    { name: 'layer.view.viewer',              category: 'view', order: 310, description: 'Markdown viewer' },
    { name: 'layer.view.workcenter',          category: 'view', order: 320, description: 'Work center (AI prompts)' },
    { name: 'layer.view.workcenter.keyframes', category: 'view', order: 322, description: 'Work center animations' },
    { name: 'view.workcenter',                category: 'view', order: 324, description: 'Work center styles (legacy name)' },
    { name: 'view.workcenter.animations',     category: 'view', order: 326, description: 'Work center animations (legacy name)' },
    { name: 'layer.view.settings',            category: 'view', order: 330, description: 'Settings view' },
    { name: 'layer.view.explorer',            category: 'view', order: 340, description: 'File explorer' },
    { name: 'layer.view.history',             category: 'view', order: 350, description: 'History view' },
    { name: 'layer.view.editor',              category: 'view', order: 360, description: 'Editor view' },
    { name: 'layer.view.editor.markdown',     category: 'view', order: 362, description: 'Markdown editor sublayer' },
    { name: 'layer.view.editor.quill',        category: 'view', order: 364, description: 'Quill editor sublayer' },
    { name: 'layer.view.airpad',              category: 'view', order: 370, description: 'Airpad (touch input)' },
    { name: 'view.airpad',                    category: 'view', order: 371, description: 'Airpad SCSS @layer view.airpad (alias)' },
    { name: 'layer.view.home',                category: 'view', order: 380, description: 'Home/landing view' },
    { name: 'layer.view.print',               category: 'view', order: 390, description: 'Print view' },
    { name: 'view-explorer',                  category: 'view', order: 392, description: 'Explorer legacy layered scope' },

    // === VIEW TRANSITION LAYERS (order 850-899) ===
    { name: 'view-transitions',           category: 'override', order: 850, description: 'View Transition API named targets and keyframes' },

    // === OVERRIDE LAYERS (order 900-999) ===
    { name: 'layer.override.theme',  category: 'override', order: 900, description: 'Theme customizations' },
    { name: 'layer.override.print',  category: 'override', order: 910, description: 'Print media styles' },
    { name: 'layer.override.a11y',   category: 'override', order: 920, description: 'Accessibility enhancements' },
];

// ============================================================================
// STATE
// ============================================================================

let _initialized = false;
let _layerElement: HTMLStyleElement | null = null;

// ============================================================================
// LAYER INITIALIZATION
// ============================================================================

/**
 * Initialize CSS layer order
 *
 * MUST be called before any other styles are loaded to ensure
 * the cascade layer order is established correctly.
 *
 * This function is idempotent - calling it multiple times is safe.
 *
 * @example
 * ```ts
 * // In application entry point
 * import { initializeLayers } from './shared/layer-manager';
 *
 * async function main() {
 *     // Initialize layers FIRST
 *     initializeLayers();
 *
 *     // Then load styles
 *     await loadStyleSystem('vl-advanced');
 *     // ...
 * }
 * ```
 */
export function initializeLayers(): void {
    if (_initialized) {
        console.debug('[LayerManager] Already initialized');
        return;
    }

    if (typeof document === 'undefined') {
        console.warn('[LayerManager] No document available (SSR context?)');
        return;
    }

    // Sort layers by order value
    const sortedLayers = [...LAYER_HIERARCHY].sort((a, b) => a.order - b.order);
    const layerNames = sortedLayers.map(l => l.name);

    // Create @layer declaration
    const layerRule = `@layer ${layerNames.join(', ')};`;

    // Inject as first stylesheet
    const style = document.createElement('style');
    style.id = 'css-layer-init';
    style.setAttribute('data-layer-manager', 'true');
    style.textContent = layerRule;

    // Insert at the very beginning of <head>
    const head = document.head;
    head.insertBefore(style, head.firstChild);

    _layerElement = style;
    _initialized = true;

    console.log(`[LayerManager] Initialized ${layerNames.length} layers`);
}

/**
 * Reset layer initialization (mainly for testing)
 */
export function resetLayers(): void {
    if (_layerElement && _layerElement.parentNode) {
        _layerElement.parentNode.removeChild(_layerElement);
    }
    _layerElement = null;
    _initialized = false;
    console.debug('[LayerManager] Reset');
}

// ============================================================================
// LAYER NAME HELPERS
// ============================================================================

/**
 * Get layer name for a shell
 *
 * @param shellId - Shell identifier
 * @returns Layer name (e.g., 'layer.shell.minimal')
 *
 * @example
 * ```scss
 * // In shell SCSS file
 * @layer #{getShellLayer('minimal')} {
 *     .app-shell { ... }
 * }
 * ```
 */
export function getShellLayer(shellId: ShellId): string {
    return `layer.shell.${shellId}`;
}

/**
 * Get layer name for a view
 *
 * @param viewId - View identifier
 * @returns Layer name (e.g., 'layer.view.viewer')
 *
 * @example
 * ```scss
 * // In view SCSS file
 * @layer #{getViewLayer('viewer')} {
 *     .view-viewer { ... }
 * }
 * ```
 */
export function getViewLayer(viewId: ViewId): string {
    return `layer.view.${viewId}`;
}

/**
 * Get all layer names in order
 *
 * @returns Array of layer names sorted by cascade order
 */
export function getLayerOrder(): string[] {
    return [...LAYER_HIERARCHY]
        .sort((a, b) => a.order - b.order)
        .map(l => l.name);
}

/**
 * Get layers by category
 *
 * @param category - Layer category to filter
 * @returns Array of layer definitions
 */
export function getLayersByCategory(category: LayerCategory): LayerDefinition[] {
    return LAYER_HIERARCHY.filter(l => l.category === category);
}

// ============================================================================
// STATUS CHECKING
// ============================================================================

/**
 * Check if layers are initialized
 */
export function areLayersInitialized(): boolean {
    return _initialized;
}

/**
 * Get the layer initialization element
 */
export function getLayerElement(): HTMLStyleElement | null {
    return _layerElement;
}

// ============================================================================
// LAYER CONSTANTS (for use in SCSS or TypeScript)
// ============================================================================

/** Layer names as constants */
export const LAYERS = {
    // System
    RESET: 'layer.reset',
    NORMALIZE: 'layer.normalize',
    TOKENS: 'layer.tokens',
    PROPERTIES_SHELL: 'layer.properties.shell',
    PROPERTIES_VIEWS: 'layer.properties.views',

    // Runtime
    RUNTIME_BASE: 'layer.runtime.base',
    RUNTIME_COMPONENTS: 'layer.runtime.components',
    RUNTIME_FORMS: 'layer.runtime.forms',
    RUNTIME_UTILITIES: 'layer.runtime.utilities',
    RUNTIME_ANIMATIONS: 'layer.runtime.animations',
    BOOT: 'layer.boot',

    // Shell
    SHELL_COMMON: 'layer.shell.common',
    SHELL_RAW: 'layer.shell.raw',
    SHELL_MINIMAL: 'layer.shell.minimal',
    SHELL_MINIMAL_LAYOUT: 'layer.shell.minimal.layout',
    SHELL_MINIMAL_COMPONENTS: 'layer.shell.minimal.components',
    SHELL_WINDOW: 'layer.shell.window',
    SHELL_FAINT: 'layer.shell.faint',
    SHELL_FAINT_LAYOUT: 'layer.shell.faint.layout',
    SHELL_FAINT_SIDEBAR: 'layer.shell.faint.sidebar',
    SHELL_FAINT_TOOLBAR: 'layer.shell.faint.toolbar',
    SHELL_FAINT_FORMS: 'layer.shell.faint.forms',

    // View
    VIEW_COMMON: 'layer.view.common',
    VIEW_VIEWER: 'layer.view.viewer',
    VIEW_WORKCENTER: 'layer.view.workcenter',
    VIEW_WORKCENTER_KEYFRAMES: 'layer.view.workcenter.keyframes',
    VIEW_SETTINGS: 'layer.view.settings',
    VIEW_EXPLORER: 'layer.view.explorer',
    VIEW_HISTORY: 'layer.view.history',
    VIEW_EDITOR: 'layer.view.editor',
    VIEW_EDITOR_MARKDOWN: 'layer.view.editor.markdown',
    VIEW_EDITOR_QUILL: 'layer.view.editor.quill',
    VIEW_AIRPAD: 'layer.view.airpad',
    VIEW_HOME: 'layer.view.home',
    VIEW_PRINT: 'layer.view.print',

    // View Transitions
    VIEW_TRANSITIONS: 'view-transitions',

    // Override
    OVERRIDE_THEME: 'layer.override.theme',
    OVERRIDE_PRINT: 'layer.override.print',
    OVERRIDE_A11Y: 'layer.override.a11y',
} as const;

export type LayerName = (typeof LAYERS)[keyof typeof LAYERS];

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
    initializeLayers,
    resetLayers,
    getShellLayer,
    getViewLayer,
    getLayerOrder,
    getLayersByCategory,
    areLayersInitialized,
    getLayerElement,
    LAYERS,
    LAYER_HIERARCHY,
};

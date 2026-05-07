/**
 * CrossWord Styles Module
 *
 * Provides style system integration for the CrossWord application.
 * Supports multiple style systems based on veela CSS variants.
 *
 * Style Systems:
 * - veela-advanced: Full-featured CSS framework (default)
 * - veela-basic: Lightweight minimal styling
 * - veela-beercss: Beer CSS compatible styling
 * - raw: No styling framework (browser defaults)
 */

import { loadVeelaVariant, type VeelaVariant } from "./boot/veela-variant-runtime";
import type { StyleSystem } from "./boot/BootLoader";

export type StyleSystemId = StyleSystem;

export interface StyleConfig {
    id: StyleSystem;
    name: string;
    description?: string;
    variant?: VeelaVariant;
    initFn?: () => Promise<void>;
}

// ============================================================================
// STYLE SYSTEM CONFIGURATIONS
// ============================================================================

export const STYLE_CONFIGS: Record<StyleSystem, StyleConfig> = {
    "vl-advanced": {
        id: "vl-advanced",
        name: "Veela Advanced",
        description: "Full-featured CSS framework with design tokens and effects",
        variant: "advanced",
        initFn: async () => {
            try {
                await loadVeelaVariant("advanced");
                console.log("[Styles] Veela Advanced loaded");
            } catch (e) {

            }
        }
    },
    "vl-basic": {
        id: "vl-basic",
        name: "Veela Basic Styles",
        description: "Lightweight minimal styling for basic functionality",
        variant: "basic",
        initFn: async () => {
            try {
                await loadVeelaVariant("basic");
                console.log("[Styles] Veela Basic Styles loaded");
            } catch (e) {
                console.warn("[Styles] Failed to load Veela Basic Styles:", e);
                // Fallback to local basic styles
            }
        }
    },
    "vl-beercss": {
        id: "vl-beercss",
        name: "Veela BeerCSS",
        description: "Beer CSS compatible styling with Material Design 3",
        variant: "beercss",
        initFn: async () => {
            try {
                await loadVeelaVariant("beercss");
                console.log("[Styles] Veela BeerCSS loaded");
            } catch (e) {
                console.warn("[Styles] Failed to load Veela BeerCSS:", e);
            }
        }
    },
    "vl-core": {
        id: "vl-core",
        name: "Veela Core",
        description: "Shared foundation styles for all veela variants",
        variant: "core",
        initFn: async () => {
            try {
                await loadVeelaVariant("core");
                console.log("[Styles] Veela Core loaded");
            } catch (e) {
                console.warn("[Styles] Failed to load Veela Core:", e);
            }
        }
    },
    "raw": {
        id: "raw",
        name: "Raw",
        description: "No styling framework, browser defaults",
        variant: "core",
        initFn: async () => {
            console.log("[Styles] Raw mode - no styles loaded");
        }
    }
};

// ============================================================================
// STYLE LOADER
// ============================================================================

let _currentStyle: StyleSystem | null = null;

/**
 * Load a style system
 *
 * @param styleId - Style system identifier
 */
export async function loadStyleSystem(styleId: StyleSystem): Promise<void> {
    const config = STYLE_CONFIGS[styleId] || STYLE_CONFIGS["vl-basic"];
    if (!config) {
        throw new Error(`Unknown style system: ${styleId}`);
    }

    if (_currentStyle === styleId) {
        console.log(`[Styles] Style system '${styleId}' already loaded`);
        return;
    }

    console.log(`[Styles] Loading style system: ${config.name}`);

    if (config.initFn) {
        await config.initFn();
    }

    _currentStyle = styleId;
    console.log(`[Styles] Style system ${config.name} loaded`);
}

/**
 * Get style system configuration
 */
export function getStyleConfig(styleId: StyleSystem): StyleConfig {
    return STYLE_CONFIGS[styleId];
}

/**
 * List available style systems
 */
export function listStyleSystems(): StyleConfig[] {
    return Object.values(STYLE_CONFIGS);
}

/**
 * Get the currently loaded style system
 */
export function getCurrentStyleSystem(): StyleConfig | null {
    return _currentStyle ? STYLE_CONFIGS[_currentStyle] : null;
}

/**
 * Check if a style system is loaded
 */
export function isStyleSystemLoaded(styleId: StyleSystem): boolean {
    return _currentStyle ? _currentStyle === styleId : false;
}

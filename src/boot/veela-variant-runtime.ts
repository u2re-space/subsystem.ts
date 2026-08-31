/**
 * Veela stylesheet loader for CWSP-shell (no `fest/fl-ui` runtime SCSS dependency).
 *
 * Uses Veela's curated public SCSS entry-points (core + foundation).
 */

import { loadAsAdopted } from "@fest-lib/style-lib";

// WHY: `scss/core` is a directory. Vite `?inline` does not resolve `index.scss`.
//@ts-expect-error vite inline
import coreStyles from "@fest-lib/veela/scss/core/index.scss?inline";
//@ts-expect-error vite inline
import stackStyles from "@fest-lib/veela/scss/index.scss?inline";

export type VeelaVariant = "core" | "basic" | "advanced" | "beercss";

let loadedVariant: VeelaVariant | null = null;

/**
 * Loads Veela stylesheet slices for the coarse variant presets used by BootLoader.
 */
export async function loadVeelaVariant(variant: VeelaVariant): Promise<void> {
    if (loadedVariant === variant) return;

    console.log("[Veela] Loading variant:", variant);

    const apply = async (text: unknown) => {
        if (typeof text === "string" && text.length) await loadAsAdopted(text);
    };

    if (variant === "core") {
        await apply(coreStyles);
        loadedVariant = variant;
        return;
    }

    await apply(stackStyles);
    loadedVariant = variant;
}

export function getLoadedVariant(): VeelaVariant | null {
    return loadedVariant;
}

export function isVariantLoaded(variant: VeelaVariant): boolean {
    return loadedVariant === variant;
}

export default loadVeelaVariant;

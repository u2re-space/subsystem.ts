/**
 * Veela stylesheet loader for CrossWord (no `fest/fl-ui` runtime SCSS dependency).
 *
 * Uses the canonical forwarded stack in `veela.css/src/scss/index.scss` (core + curated basic surface).
 * `advanced` / `beercss` currently share that stack until a standalone advanced bundle exists with stable `@use` paths.
 */

import { loadAsAdopted } from "fest/dom";

//@ts-expect-error vite inline
import coreStyles from "../../../veela.css/src/scss/core/index.scss?inline";
//@ts-expect-error vite inline
import stackStyles from "../../../veela.css/src/scss/index.scss?inline";

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

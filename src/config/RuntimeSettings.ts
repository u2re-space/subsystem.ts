import type { AppSettings } from "./SettingsTypes";
import { DEFAULT_SETTINGS } from "./SettingsTypes";

export type RuntimeSettingsProvider = () => Promise<AppSettings> | AppSettings;

let provider: RuntimeSettingsProvider | undefined;
/** Lazily resolved so we never read `loadSettings` at module init (avoids TDZ when Rollup splits com-app ↔ boot chunks). */
let defaultProvider: RuntimeSettingsProvider | null = null;

async function getDefaultProvider(): Promise<RuntimeSettingsProvider> {
    if (defaultProvider) return defaultProvider;
    const { loadSettings } = await import("./Settings");
    defaultProvider = loadSettings;
    return defaultProvider;
}

/**
 * Allows non-browser runtimes (Node/Deno backend) to supply settings without IndexedDB/chrome storage.
 * Frontend apps can also set this to bridge to their existing settings storage.
 */
export const setRuntimeSettingsProvider = (next: RuntimeSettingsProvider) => {
    provider = next;
};

export const getRuntimeSettings = async (): Promise<AppSettings> => {
    try {
        const fn = provider ?? (await getDefaultProvider());
        const value = await fn();
        return value || DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
};

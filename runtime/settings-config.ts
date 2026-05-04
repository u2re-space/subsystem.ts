import type { AppSettings } from "./app-settings";

const KEY = "view-settings";

export function loadSettings(): AppSettings {
    try {
        return JSON.parse(globalThis.localStorage?.getItem(KEY) || "{}") as AppSettings;
    } catch {
        return {};
    }
}

export function saveSettings(settings: AppSettings): void {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
}

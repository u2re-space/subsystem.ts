export const StorageKeys = {
    EXPLORER_PATH: "rs-explorer-path",
    SETTINGS: "rs-settings"
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys] | string;

const getStore = (): Storage | null => {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
};

export function getItem<T>(key: StorageKey, fallback: T): T {
    const raw = getStore()?.getItem(String(key));
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export function setItem<T>(key: StorageKey, value: T): void {
    getStore()?.setItem(String(key), JSON.stringify(value));
}

export function removeItem(key: StorageKey): void {
    getStore()?.removeItem(String(key));
}

export function getString(key: StorageKey, fallback = ""): string {
    return getStore()?.getItem(String(key)) ?? fallback;
}

export function setString(key: StorageKey, value: string): void {
    getStore()?.setItem(String(key), value);
}

export function isLocalStorageAvailable(): boolean {
    return Boolean(getStore());
}

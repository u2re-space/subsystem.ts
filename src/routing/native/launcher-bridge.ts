/*
 * Filename: launcher-bridge.ts
 * FullPath: apps/CWSP-crx/src/shared/routing/native/launcher-bridge.ts
 * Reason for changes: CRX stub — Android launcher IPC is Capacitor-only; keep dynamic imports resolvable.
 */

export interface LauncherAppEntry {
    packageName: string;
    label: string;
    componentName: string;
    iconCacheKey: string;
}

export async function launcherIsDefault(): Promise<boolean> {
    return false;
}

export async function launcherRequestDefault(): Promise<boolean> {
    return false;
}

export async function launcherList(_query?: string): Promise<LauncherAppEntry[]> {
    return [];
}

export async function launcherLaunch(_pkg: string, _component?: string): Promise<boolean> {
    return false;
}

export async function launcherIcon(_cacheKey: string, _size = 64): Promise<string> {
    return "";
}

export async function launcherIconBlobUrl(_cacheKey: string, _size = 64): Promise<string> {
    return "";
}

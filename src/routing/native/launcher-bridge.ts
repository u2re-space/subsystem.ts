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

export async function launcherHasPackages(_pkgs: string[]): Promise<Record<string, boolean>> {
    return {};
}

export async function launcherIcon(
    _cacheKey: string,
    _size = 64,
    _variant = "default",
    _pack = "",
    _drawable = ""
): Promise<string> {
    return "";
}

export async function launcherIconVariants(
    _cacheKey: string
): Promise<Array<{ id: string; label: string; available: boolean }>> {
    return [];
}

export async function launcherIconPacks(): Promise<
    Array<{ packageName: string; label: string; iconCacheKey?: string }>
> {
    return [];
}

export async function launcherIconPackIcons(
    _pack: string,
    _query = "",
    _limit = 120
): Promise<Array<{ drawable: string; label: string }>> {
    return [];
}

export async function launcherIconBlobUrl(
    _cacheKey: string,
    _size = 64,
    _variant = "default",
    _pack = "",
    _drawable = ""
): Promise<string> {
    return "";
}

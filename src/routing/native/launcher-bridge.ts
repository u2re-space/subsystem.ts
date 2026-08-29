/*
 * Filename: launcher-bridge.ts
 * FullPath: modules/projects/subsystem/src/routing/native/launcher-bridge.ts
 * FIND:open-policy
 * Reason for changes: launcherOpenFile — share OPFS / in-memory bytes to a sibling APK via FileProvider.
 */

import { invokeCwsPlatformIPC } from "./cws-bridge";

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
    const packageName = String(_pkg || "").trim();
    if (!packageName) return false;
    try {
        const r = await invokeCwsPlatformIPC({
            channel: "launcher:launch",
            payload: {
                packageName,
                ...(_component ? { componentName: String(_component).trim() } : {})
            }
        });
        return r.ok === true;
    } catch {
        return false;
    }
}

export type LauncherOpenUriOptions = {
    packageName?: string;
    chooser?: boolean;
    title?: string;
    mimeType?: string;
};

/** ACTION_VIEW / Open-with. No-op on web when CwsBridge is a stub. */
export async function launcherOpenUri(
    uri: string,
    options: LauncherOpenUriOptions = {}
): Promise<boolean> {
    const url = String(uri || "").trim();
    if (!url) return false;
    const packageName = String(options.packageName || "").trim();
    const mimeType = String(options.mimeType || "").trim();
    const chooser = options.chooser !== false;
    const title = String(options.title || "Open with").trim() || "Open with";
    try {
        const r = await invokeCwsPlatformIPC({
            channel: "launcher:open-uri",
            payload: {
                uri: url,
                url,
                ...(packageName ? { packageName } : {}),
                ...(mimeType ? { mimeType } : {}),
                chooser,
                title
            }
        });
        return launcherNativeOpened(r);
    } catch {
        return false;
    }
}

/** WHY: CwsBridgeWeb echoes `{ ok: true }` for every channel and never opens a file. */
const launcherNativeOpened = (r: { ok?: boolean; echo?: Record<string, unknown> } | null | undefined): boolean => {
    if (!r || r.ok !== true) return false;
    const echo = (r.echo || {}) as { opened?: unknown; sent?: unknown };
    return echo.opened === true || echo.sent === true;
};

const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("read-failed"));
        reader.readAsDataURL(file);
    });

/** Write bytes to this APK's cache FileProvider and ACTION_VIEW a sibling package. */
export async function launcherOpenFile(
    file: File,
    options: LauncherOpenUriOptions = {}
): Promise<boolean> {
    if (!file) return false;
    if (file.size <= 0 || file.size > 8 * 1024 * 1024) return false;
    const packageName = String(options.packageName || "").trim();
    const mimeType = String(options.mimeType || file.type || "").trim();
    const chooser = options.chooser === true;
    const title = String(options.title || "Open").trim() || "Open";
    try {
        const data = await fileToDataUrl(file);
        const r = await invokeCwsPlatformIPC({
            channel: "launcher:open-bytes",
            payload: {
                name: file.name || "shared.bin",
                mimeType,
                data,
                ...(packageName ? { packageName } : {}),
                chooser,
                title
            }
        });
        return launcherNativeOpened(r);
    } catch {
        return false;
    }
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

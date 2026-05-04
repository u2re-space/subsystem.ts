/**
 * Runtime-safe helpers for mixed environments
 * (window, service worker, worker, extension contexts).
 */

export const getRuntimeLocation = (): Location | undefined =>
    (globalThis as any)?.location as Location | undefined;

export const getRuntimeLocationOrigin = (): string | undefined =>
    getRuntimeLocation()?.origin;

export const getRuntimeLocationHref = (): string =>
    getRuntimeLocation()?.href || "";

export const getRuntimeLocationSearch = (): string =>
    getRuntimeLocation()?.search || "";

export const canParseURL = (value: string, base?: string): boolean => {
    const source = value?.trim?.() || "";
    if (!source) return false;
    const fallbackBase = base ?? getRuntimeLocationOrigin();
    if (typeof URL?.canParse === "function") {
        return URL.canParse(source, fallbackBase);
    }
    try {
        new URL(source, fallbackBase);
        return true;
    } catch {
        return false;
    }
};

export const scheduleFrame = (cb: () => void): void => {
    if (typeof (globalThis as any)?.requestAnimationFrame === "function") {
        (globalThis as any).requestAnimationFrame(cb);
        return;
    }
    globalThis.setTimeout(cb, 0);
};

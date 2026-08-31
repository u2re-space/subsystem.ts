/*
 * Filename: process-api.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-api.ts
 * FIND:process
 * Change date: 14.20.00_27.08.2026
 * Reason: One process API URL for hub PWA, Capacitor, and CRX (same-origin vs public host).
 *
 * INVARIANT: POST work stays on /api/process/* (COMPAT /api/processing still works on :443).
 * INVARIANT: chrome-extension: and Capacitor native must not fetch a relative /api path.
 */

export const PROCESS_API_PUBLIC_ORIGIN = "https://process.u2re.space";
export const PROCESS_API_PREFIX = "/api/process";

export type ProcessApiSuffix = "processing" | "recognize" | "analyze" | "health";

const PROCESS_API_SUFFIX: Record<ProcessApiSuffix, string> = {
    processing: "processing",
    recognize: "ai/recognize",
    analyze: "ai/analyze",
    health: "health"
};

const PROCESS_SAME_ORIGIN_HOSTS = new Set([
    "process.u2re.space",
    "workcenter.u2re.space",
    "ai.u2re.space",
    "u2re.space",
    "www.u2re.space"
]);

const isExtensionProtocol = (protocol: string): boolean =>
    protocol === "chrome-extension:" || protocol === "moz-extension:" || protocol === "safari-web-extension:";

const isCapacitorNative = (): boolean => {
    try {
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
        return typeof g.Capacitor?.isNativePlatform === "function" && g.Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

/** Hub + process PWAs stay same-origin. CRX / Capacitor / other hosts use the public process API. */
export const needsRemoteProcessApi = (): boolean => {
    try {
        const protocol = String(globalThis.location?.protocol || "").toLowerCase();
        if (isExtensionProtocol(protocol)) return true;
        if (isCapacitorNative()) return true;
        const host = String(globalThis.location?.hostname || "").toLowerCase();
        if (!host) return true;
        if (PROCESS_SAME_ORIGIN_HOSTS.has(host)) return false;
        if (host === "localhost" || host === "127.0.0.1") return true;
        return protocol !== "http:" && protocol !== "https:";
    } catch {
        return true;
    }
};

export const processApiPath = (suffix: ProcessApiSuffix = "processing"): string =>
    `${PROCESS_API_PREFIX}/${PROCESS_API_SUFFIX[suffix]}`;

export const resolveProcessApiUrl = (suffix: ProcessApiSuffix = "processing"): string => {
    const path = processApiPath(suffix);
    return needsRemoteProcessApi() ? `${PROCESS_API_PUBLIC_ORIGIN}${path}` : path;
};

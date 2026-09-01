/*
 * Filename: process-api-path.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-api-path.ts
 * FIND:process
 *
 * Path helpers only — no native / alias imports.
 * WHY: Vite loads process-api-vite from vite.config; pulling process-api.ts
 * also bundled cws-bridge (`cwsp-shared/*`) and broke config evaluate.
 */

export const PROCESS_API_PUBLIC_ORIGIN = "https://process.u2re.space";
export const PROCESS_API_PREFIX = "/api/process";

/** True for public / legacy process API paths that must not SPA-fallback to index.html. */
export const isProcessApiPath = (pathname: string): boolean => {
    const path = String(pathname || "").split("?")[0] || "/";
    return (
        path === PROCESS_API_PREFIX ||
        path.startsWith(`${PROCESS_API_PREFIX}/`) ||
        path === "/api/processing" ||
        path.startsWith("/process/ai") ||
        path.startsWith("/process/processing") ||
        path.startsWith("/process/api") ||
        path === "/process/health"
    );
};

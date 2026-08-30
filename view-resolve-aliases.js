/**
 * FIND:view-resolve
 * Re-export for imports from the subsystem package root.
 * WHY: Node ESM treats `modules/...` as an npm package; Vite config bundling
 * copies this graph into `.vite-temp` so the path must be found by walking up.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function findWorkspaceFile(rel) {
    for (const start of [import.meta.dirname, process.cwd()]) {
        let dir = start;
        for (let i = 0; i < 16; i++) {
            const candidate = resolve(dir, rel);
            if (existsSync(candidate)) return candidate;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    throw new Error(`Cannot find ${rel} from ${import.meta.dirname}`);
}

const m = await import(
    pathToFileURL(findWorkspaceFile("modules/views/view-resolve-aliases.js")).href
);

export const getViewResolveAliases = m.getViewResolveAliases;
export const workspaceRoot = m.workspaceRoot;
export const viewsRoot = m.viewsRoot;
export const sharedRoot = m.sharedRoot;
export const subsystemRoot = m.subsystemRoot;

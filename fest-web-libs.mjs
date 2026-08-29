/**
 * FIND:fest-shared
 * Web/PWA library-mode for isolated @fest-lib/* packages.
 *
 * WHY: app Vite used to tree-shake fest into per-SKU chunks. Real library-mode
 * builds each package once and serves `/fest/<name>.js` to every host.
 *
 * INVARIANT: lure + fl-ui stay bundled in com/app.js (TDZ).
 * INVARIANT: package `dist/*.js` keeps `@fest-lib/*` (bundlers). `/fest/*.js` is written only when copying to `_shared` / app `fest/`.
 * INVARIANT: `@fest-lib/veela` stays an app Vite chunk (`fest/veela.js` from `?inline` SCSS).
 * The package dist is a style loader (`loadAsAdopted`) and does not export chunk names like `n`/`t`.
 * INVARIANT: only exact package ids are external (`@fest-lib/veela/runtime` stays aliased).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FEST_WEB_LIBS = [
    { id: "@fest-lib/core", name: "core", dir: "core.ts" },
    { id: "@fest-lib/object", name: "object", dir: "object.ts" },
    { id: "@fest-lib/dom", name: "dom", dir: "dom.ts" },
    { id: "@fest-lib/uniform", name: "uniform", dir: "uniform.ts" },
    { id: "@fest-lib/icon", name: "icon", dir: "icon.ts" },
];

export const festWebUrl = (name) => `/fest/${name}.js`;

export const festLibDist = (workspaceRoot, lib) =>
    join(workspaceRoot, "modules/projects", lib.dir, "dist", `${lib.name}.js`);

export const festWebLibsReady = (workspaceRoot) =>
    FEST_WEB_LIBS.every((lib) => existsSync(festLibDist(workspaceRoot, lib)));

export const isFestWebExternal = (id) => {
    if (typeof id !== "string") return false;
    const n = id.split("\\").join("/");
    if (n.startsWith("/fest/") && n.endsWith(".js")) return true;
    return FEST_WEB_LIBS.some((lib) => {
        if (id === lib.id) return true;
        return n.includes(`/modules/projects/${lib.dir}/dist/`);
    });
};

const rewriteExact = (code) => {
    let out = code;
    for (const { id, name } of FEST_WEB_LIBS) {
        const to = festWebUrl(name);
        out = out.replaceAll(`from "${id}"`, `from "${to}"`);
        out = out.replaceAll(`from '${id}'`, `from '${to}'`);
        out = out.replaceAll(`import("${id}")`, `import("${to}")`);
        out = out.replaceAll(`import('${id}')`, `import('${to}')`);
    }
    return out;
};

/** Rewrite `@fest-lib/core` → `/fest/core.js` in emitted chunks. */
export function festWebImportRewritePlugin() {
    return {
        name: "fest-web-import-rewrite",
        apply: "build",
        enforce: "post",
        generateBundle(_options, bundle) {
            for (const item of Object.values(bundle)) {
                if (item.type !== "chunk" || typeof item.code !== "string") continue;
                if (!item.code.includes("@fest-lib/")) continue;
                const next = rewriteExact(item.code);
                if (next !== item.code) item.code = next;
            }
        },
    };
}

const stripFestWebAliases = (aliases) => {
    if (!Array.isArray(aliases)) return aliases;
    return aliases.filter((entry) => {
        const key = typeof entry?.find === "string" ? entry.find : entry?.find?.source ?? "";
        return !FEST_WEB_LIBS.some((lib) => {
            const bare = lib.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return key === lib.id || key === `^${bare}$` || key === `fest/${lib.name}` || key === `^fest/${lib.name}$`;
        });
    });
};

const mergeExternal = (prev, extra) => {
    if (typeof prev === "function") {
        return (id, ...rest) => Boolean(prev(id, ...rest) || extra(id));
    }
    if (Array.isArray(prev)) {
        return (id) => prev.includes(id) || extra(id);
    }
    return extra;
};

export function copyFestWebLibsToDir(workspaceRoot, destDir, { overwrite = true } = {}) {
    mkdirSync(destDir, { recursive: true });
    let n = 0;
    for (const lib of FEST_WEB_LIBS) {
        const distDir = join(workspaceRoot, "modules/projects", lib.dir, "dist");
        if (!existsSync(distDir)) continue;
        for (const name of readdirSync(distDir)) {
            if (!/\.(js|css)$/i.test(name)) continue;
            const from = join(distDir, name);
            const to = join(destDir, name);
            if (!overwrite && existsSync(to)) continue;
            if (/\.js$/i.test(name)) {
                writeFileSync(to, rewriteExact(readFileSync(from, "utf8")));
            } else {
                writeFileSync(to, readFileSync(from));
            }
            for (const enc of [".br", ".gz"]) {
                const stale = `${to}${enc}`;
                if (existsSync(stale)) rmSync(stale);
            }
            n += 1;
        }
    }
    return n;
}

function festWebCopyToOutDirPlugin(workspaceRoot) {
    return {
        name: "fest-web-copy-libs",
        apply: "build",
        enforce: "post",
        writeBundle(outputOptions) {
            const outDir = outputOptions.dir;
            if (!outDir) return;
            const n = copyFestWebLibsToDir(workspaceRoot, join(outDir, "fest"), { overwrite: false });
            if (n) console.log(`[fest-web] copied ${n} library file(s) → ${outDir}/fest`);
        },
    };
}

/**
 * Production-only: externalize isolated fest-lib packages and emit `/fest/*.js`.
 * Dev keeps source aliases. Set FEST_LIBRARY_MODE=0 to force the old bundle path.
 *
 * @param {import("vite").UserConfig} config
 * @param {{ isBuild: boolean, workspaceRoot: string }} ctx
 */
export function applyFestLibraryMode(config, { isBuild, workspaceRoot }) {
    if (!isBuild || process.env.FEST_LIBRARY_MODE === "0") return config;
    const ready = festWebLibsReady(workspaceRoot);
    if (!ready) {
        if (process.env.FEST_LIBRARY_MODE === "1") {
            throw new Error("[fest-web] FEST_LIBRARY_MODE=1 but library dists are missing — run npm run stage:fest-libs --prefix apps/CWSP-shell");
        }
        console.warn("[fest-web] library dists missing; bundling @fest-lib/* (run stage:fest-libs)");
        return config;
    }

    if (config.resolve && Array.isArray(config.resolve.alias)) {
        config.resolve.alias = stripFestWebAliases(config.resolve.alias);
    }

    config.build = config.build || {};
    config.build.rollupOptions = config.build.rollupOptions || {};
    config.build.rolldownOptions = config.build.rolldownOptions || {};
    const extra = isFestWebExternal;
    config.build.rollupOptions.external = mergeExternal(config.build.rollupOptions.external, extra);
    config.build.rolldownOptions.external = mergeExternal(config.build.rolldownOptions.external, extra);
    const paths = Object.fromEntries(FEST_WEB_LIBS.map((lib) => [lib.id, festWebUrl(lib.name)]));
    const prevOut = config.build.rolldownOptions.output;
    const out = Array.isArray(prevOut) ? prevOut[0] : prevOut || {};
    out.paths = { ...(out.paths || {}), ...paths };
    config.build.rolldownOptions.output = Array.isArray(prevOut) ? [out, ...prevOut.slice(1)] : out;
    if (config.build.rollupOptions.output && !Array.isArray(config.build.rollupOptions.output)) {
        config.build.rollupOptions.output.paths = {
            ...(config.build.rollupOptions.output.paths || {}),
            ...paths,
        };
    }

    config.plugins = [
        ...(config.plugins || []),
        festWebImportRewritePlugin(),
        festWebCopyToOutDirPlugin(workspaceRoot),
    ];
    console.log("[fest-web] library-mode: external", FEST_WEB_LIBS.map((l) => l.id).join(", "));
    return config;
}

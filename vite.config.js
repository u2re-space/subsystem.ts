/**
 * Library build config for `@fest-lib/subsystem` sources under modules/shared/src.
 * Named export `initiate` is reused by modules/projects/subsystem and fl.ui vite configs.
 * Dev playground with HTTPS: npm run dev → vite.dev.config.js
 */
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import pluginExternal from "vite-plugin-external";
import deduplicate from "postcss-discard-duplicates";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";
import { npmFestImportRewritePlugin } from "./vite-npm-imports.mjs";

const NAME = "subsystem";

//
export const importConfig = (url, ...args)=>{ return import(url)?.then?.((m)=>m?.default?.(...args)); }
export const objectAssign = (target, ...sources) => {
    if (!sources.length) return target;

    const source = sources.shift();
    if (source && typeof source === 'object') {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                if (source[key] && typeof source[key] === 'object') {
                    if (!target[key] || typeof target[key] !== 'object') {
                        target[key] = Array.isArray(source[key]) ? [] : {};
                    }
                    objectAssign(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
    }

    return objectAssign(target, ...sources);
}


export function normalizeAliasPattern(pattern) {
    return pattern.replace(/\/\*+$/, "");
}

export function importFromTSConfig(tsconfig, dir) {
    const paths = tsconfig?.compilerOptions?.paths || {};
    /** Longer `find` first so e.g. `com/config/Names` wins over `com` from `com/*`. */
    const keys = Object.keys(paths).sort((a, b) => {
        const na = normalizeAliasPattern(a);
        const nb = normalizeAliasPattern(b);
        if (nb.length !== na.length) return nb.length - na.length;
        return a.localeCompare(b);
    });
    const out = [];
    for (const key of keys) {
        const normalizedKey = normalizeAliasPattern(key);
        const target = paths[key][0];
        const normalizedTarget = normalizeAliasPattern(target);
        out.push({
            find: normalizedKey,
            replacement: resolve(dir, normalizedTarget)
        });
    }
    return out;
}

export const projectMap = new Map([
    ["fest/core", "core.ts"],
    ["fest/icon", "icon.ts"],
    ["fest/fl-ui", "fl.ui"],
    ["fest/object", "object.ts"],
    ["fest/uniform", "uniform.ts"],
    ["fest/dom", "dom.ts"],
    ["fest/veela", "veela.css"],
    ["veela-lib", "veela.css"],
    ["fest/lure", "lur.e"],
    ["fest/image", "image.ts"]
]);

export function initiate(name = NAME, tsconfig = {}, dir = resolve(import.meta.dirname, "./")) {
    const $resolve = { alias: importFromTSConfig(tsconfig, dir) };

    const plugins = [
        pluginExternal({
            include: Array.from(projectMap.keys()).filter((n) => !n.endsWith(name)),
            exclude: [
                resolve(dir, "./src/index.ts"),
                "./src/index.ts",
                resolve(dir, `./dist/${name}.js`),
                `./dist/${name}.js`
            ]
        }),
        ...(process.env.FEST_NPM_IMPORTS === "1" ? [npmFestImportRewritePlugin()] : [])
    ];

    const rollupOptions = {
        shimMissingExports: true,
        treeshake: {
            annotations: false,
            moduleSideEffects: true,
            tryCatchDeoptimization: false,
            unknownGlobalSideEffects: true,
            correctVarValueBeforeDeclaration: true,
            propertyReadSideEffects: true
        },
        input: "./src/index.ts",
        external: (source) => {
            if (source?.includes?.("node_modules/")) return false;
            if (
                source?.includes?.(`fest/${name}`) ||
                source?.includes?.("./src/index.ts") ||
                source?.includes?.(projectMap.get(`fest/${name}`)) ||
                source?.includes?.("dist/")
            )
                return false;
            if (Array.from(projectMap.keys()).some((n) => source.includes(n))) return true;
            return false;
        },
        output: {
            compact: true,
            name,
            dir: "./dist",
            exports: "auto",
            minifyInternalExports: true
        }
    };

    const css = {
        postcss: {
            plugins: [
                deduplicate(),
                autoprefixer(),
                cssnano({
                    preset: [
                        "advanced",
                        {
                            calc: false,
                            layer: false,
                            scope: false,
                            discardComments: {
                                removeAll: true
                            }
                        }
                    ]
                })
            ]
        }
    };

    const optimizeDeps = {
        include: [
            "./node_modules/**/*.mjs",
            "./node_modules/**/*.js",
            "./node_modules/**/*.ts",
            "./src/**/*.mjs",
            "./src/**/*.js",
            "./src/**/*.ts",
            "./src/*.mjs",
            "./src/*.js",
            "./src/*.ts",
            "./test/*.mjs",
            "./test/*.js",
            "./test/*.ts"
        ],
        entries: [resolve(dir, "./src/index.ts")],
        force: true
    };

    const server = {
        port: 8443,
        open: false,
        host: "0.0.0.0",
        strictPort: false,
        origin: "https://localhost:8443",
        allowedHosts: ["localhost", "127.0.0.1", "0.0.0.0", "192.168.0.200", "95.188.82.223"],
        appType: "spa",
        fs: {
            strict: false,
            allow: [
                searchForWorkspaceRoot(process.cwd()),
                "../**/*",
                "../*",
                "..",
                resolve(dir, "./**/*"),
                resolve(dir, "./*"),
                dir
            ]
        }
    };

    const build = {
        chunkSizeWarningLimit: 1600,
        assetsInlineLimit: 1024 * 1024,
        minify: "esbuild",
        emptyOutDir: true,
        target: "esnext",
        modulePreload: {
            polyfill: true,
            include: ["fest/core", "fest/dom", "fest/lure", "fest/object", "fest/uniform"]
        },
        rollupOptions,
        name,
        lib: {
            formats: ["es"],
            entry: resolve(dir, "./src/index.ts"),
            name,
            fileName: name
        }
    };

    const esbuild = {
        legalComments: "none",
        minify: true,
        minifySyntax: true,
        minifyIdentifiers: true,
        minifyWhitespace: true
    };

    return { esbuild, rollupOptions, plugins, resolve: $resolve, build, css, optimizeDeps, server };
}

const pkgDir = resolve(import.meta.dirname, "./");

export default defineConfig(async () => {
    const tsconfig = JSON.parse(await readFile(resolve(pkgDir, "./tsconfig.json"), { encoding: "utf8" }));
    return initiate(NAME, tsconfig, pkgDir);
});

/**
 * Filename: vite.config.js
 * FullPath: modules/projects/subsystem/vite.config.js
 * Change date and time: 21.00.00_15.08.2026
 * Reason for changes: Serve demos must not hardcode origin/port 8434 (CWSP owns :8434;
 * wrong origin breaks HMR so edits look like "sources not updating").
 *
 * Library build config for `@fest-lib/subsystem` (also linked as modules/shared).
 *
 * INVARIANT: Sibling packages (core/dom/lure/…) MUST import named `initiate(NAME, tsconfig, dir)`.
 * Calling `default` always builds this package as `subsystem.js` and ignores any NAME args —
 * that was why every library emitted dist/subsystem.js.
 *
 * Dev playground with HTTPS: npm run dev → vite.dev.config.js
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { defineConfig, searchForWorkspaceRoot } from "vite";
//import pluginExternal from "vite-plugin-external";
import deduplicate from "postcss-discard-duplicates";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";
import { npmFestImportRewritePlugin } from "./vite-npm-imports.mjs";

// WHY: This config lives in subsystem/, but consumers (lur.e) own @vitejs/plugin-react.
// Resolve from process.cwd() first so library builds don't warn UNRESOLVED_IMPORT.
const requireFromCwd = createRequire(resolve(process.cwd(), "package.json"));
const requireHere = createRequire(import.meta.url);
function loadReactPlugin() {
    try { return requireFromCwd("@vitejs/plugin-react"); } catch {}
    try { return requireHere("@vitejs/plugin-react"); } catch {}
    return null;
}
const react = loadReactPlugin();

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

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * WHY: Vite/rollup string aliases use prefix matching. Mapping `@fest-lib/lure` →
 * `src/index.ts` would also rewrite `@fest-lib/lure/src/lure/node/jsx-runtime` to
 * `src/index.ts/src/...`. File targets must be exact-match only.
 */
export function toViteAlias(find, replacement) {
    const isFileTarget = /\.(m?[jt]sx?|cjs|mjs|json)$/i.test(replacement);
    if (isFileTarget && typeof find === "string") {
        return { find: new RegExp(`^${escapeRegex(find)}$`), replacement };
    }
    return { find, replacement };
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
        out.push(toViteAlias(normalizedKey, resolve(dir, normalizedTarget)));
    }
    return out;
}

const festPackageRE = /^@fest-lib(?:\/|$)/;

function isFestExternal(id, name) {
    if (typeof id !== "string") return false;
    if (!festPackageRE.test(id)) return false;

    const currentPackage = `@fest-lib/${name}`;

    // Не externalize сам пакет, который сейчас собирается
    if (id === currentPackage) return false;
    if (id.startsWith(`${currentPackage}/`)) return false;

    return true;
}

export const projectMap = new Map([
    ["@fest-lib/core", "core.ts"],
    ["@fest-lib/icon", "icon.ts"],
    ["@fest-lib/fl-ui", "fl.ui"],
    ["@fest-lib/object", "object.ts"],
    ["@fest-lib/uniform", "uniform.ts"],
    ["@fest-lib/dom", "dom.ts"],
    ["@fest-lib/veela", "veela.css"],
    ["veela-lib", "veela.css"],
    ["@fest-lib/lure", "lur.e"],
    ["@fest-lib/image", "image.ts"]
]);

/**
 * Shared Vite lib config for fest-lib packages.
 * @param {string} name - Output basename (`core` → dist/core.js). Must match package.json main.
 * @param {object} tsconfig - Parsed tsconfig for path→alias mapping.
 * @param {string} dir - Package root (usually import.meta.dirname of the caller).
 * @param {"build"|"serve"|"test"} [command="build"] - Vite command; serve keeps @fest-lib aliases → src.
 */
export function initiate(
    name = "subsystem",
    tsconfig = {},
    dir = resolve(import.meta.dirname, "./"),
    command = "build"
) {
    const allAliases = importFromTSConfig(tsconfig, dir);
    const selfId = `@fest-lib/${name}`;
    const selfSrc = resolve(dir, "./src/index.ts");

    // INVARIANT: library `build` externalizes sibling @fest-lib/* (no src aliases).
    // WHY (serve): demos import `@fest-lib/<self>` and siblings; package.json points at
    // dist/*.js which is often stale / missing named ESM exports (e.g. animatable).
    let aliases =
        command === "serve"
            ? allAliases
            : allAliases.filter(({ find }) => {
                const key = typeof find === "string" ? find : find?.source ?? "";
                return !festPackageRE.test(key) && !festPackageRE.test(String(find));
            });

    if (command === "serve") {
        // Exact self entry only — must not prefix-match jsxImportSource subpaths.
        const withoutSelf = aliases.filter(({ find }) => {
            if (find instanceof RegExp) return find.source !== `^${escapeRegex(selfId)}$`;
            return find !== selfId;
        });
        aliases = [toViteAlias(selfId, selfSrc), ...withoutSelf];
    }

    const $resolve = {
        alias: aliases,
        conditions: ['custom', 'import', 'module', 'browser', 'default']
    };

    //
    const webLibs = process.env.FEST_WEB_IMPORTS === "1";
    if (tsconfig?.compilerOptions) {
        tsconfig.compilerOptions.declaration = !webLibs;
        tsconfig.compilerOptions.declarationMap = !webLibs;
        tsconfig.compilerOptions.inlineSourceMap = !webLibs;
        tsconfig.compilerOptions.inlineSources = !webLibs;
    }

    // WHY: vite-plugin-external injects esbuild optimizeDeps hooks that Vite 8/Rolldown
    // cannot load (`vite:dep-pre-bundle:external-conversion:fest/*` → UNLOADABLE_DEPENDENCY).
    // INVARIANT: externalize fest/* only for library `build`; `serve` must resolve via aliases.
    /*const externalPlugin = pluginExternal({
        include: Array.from(projectMap.keys()).filter((n) => !n.endsWith(name)),
        exclude: [
            resolve(dir, "./src/index.ts"),
            "./src/index.ts",
            resolve(dir, `./dist/${name}.js`),
            `./dist/${name}.js`
        ]
    });
    externalPlugin.apply = "build";*/

    const plugins = [
        //externalPlugin,
        ...(react
            ? [react({
                jsx: 'preserve',
                jsxImportSource: '@fest-lib/lure/src/lure/node',
                jsxFactory: 'createElement',
                jsxFragmentFactory: 'Fragment',
                include: /\.(tsx)$/,
                exclude: /node_modules/
            })]
            : []),
        ...(process.env.FEST_NPM_IMPORTS === "1" ? [npmFestImportRewritePlugin()] : []),
    ];

    const rolldownOptions = {
        shimMissingExports: true,

        // WHY: Vite 8/Rolldown only accepts propertyReadSideEffects: false | "always".
        treeshake: {
            annotations: false,
            moduleSideEffects: true,
            tryCatchDeoptimization: false,
            unknownGlobalSideEffects: true,
            correctVarValueBeforeDeclaration: true,
            propertyReadSideEffects: "always"
        },

        input: resolve(dir, "./src/index.ts"),

        external: (id) => {
            return isFestExternal(id, name);
        },

        output: {
            // NOTE: `compact` is not a Rolldown output option (Vite 8 warning).
            name,
            dir: resolve(dir, "./dist"),
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
        force: true,
        exclude: []
    };

    if (command === "serve") {
        // Playground HTML + source graph; do not prebundle workspace fest packages from dist.
        optimizeDeps.force = false;
        optimizeDeps.entries = [
            resolve(dir, "./index.html"),
            resolve(dir, "./src/index.ts"),
            ...optimizeDeps.entries
        ];
        optimizeDeps.exclude = Array.from(projectMap.keys());
    }

    // WHY: :8434 is the CWSP Control/gateway port on this fleet. Library demos that
    // bind 8434 silently fall over to 8435 while `origin` still pointed at
    // https://localhost:8434 — browser HMR/asset URLs hit CWSP, so src edits never show.
    // INVARIANT: only set `origin` when VITE_DEV_ORIGIN is explicit (same as vite.dev.config.js).
    const viteDevOrigin = String(process.env.VITE_DEV_ORIGIN || "").trim();
    const demoPort = Number(process.env.VITE_PORT || process.env.VIEW_DEV_PORT || 5173);
    const workspaceRoot = searchForWorkspaceRoot(process.cwd());
    const server = {
        port: Number.isFinite(demoPort) && demoPort > 0 ? demoPort : 5173,
        open: false,
        host: "0.0.0.0",
        strictPort: false,
        ...(viteDevOrigin ? { origin: viteDevOrigin } : {}),
        allowedHosts: ["localhost", "127.0.0.1", "0.0.0.0", "192.168.0.200", "95.188.82.223"],
        appType: "spa",
        // Sibling @fest-lib/* resolve to ../dom.ts etc.; watch those trees on serve.
        ...(command === "serve"
            ? {
                watch: {
                    ignored: [
                        "**/node_modules/**",
                        "**/dist/**",
                        "**/.git/**",
                        "**/.gradle/**"
                    ]
                }
            }
            : {}),
        fs: {
            strict: false,
            allow: [
                workspaceRoot,
                resolve(dir, ".."),
                resolve(dir, "../.."),
                resolve(dir, "../../.."),
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
        target: 'esnext',
        chunkSizeWarningLimit: 1600,
        assetsInlineLimit: 1024 * 1024,
        minify: "esbuild",
        emptyOutDir: true,
        sourcemap: process.env.FEST_WEB_IMPORTS === "1" ? false : undefined,
        target: "esnext",
        loader: 'jsx',
        jsx: 'preserve',
        jsxImportSource: '@fest-lib/lure/src/lure/node',
        jsxFactory: 'createElement',
        jsxFragmentFactory: 'Fragment',
        include: /\.(ts|tsx)$/,
        modulePreload: {
            polyfill: true,
            include: [
                "@fest-lib/core",
                "@fest-lib/dom",
                "@fest-lib/lure",
                "@fest-lib/object",
                "@fest-lib/uniform"
            ]
        },

        rolldownOptions,

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
        minifyWhitespace: true,
        sourcemap: process.env.FEST_WEB_IMPORTS === "1" ? false : "inline",
        tsconfigRaw: JSON.stringify(tsconfig)
    };

    return { esbuild, rolldownOptions, plugins, resolve: $resolve, build, css, optimizeDeps, server };
}

const pkgDir = resolve(import.meta.dirname, "./");

// WHY: Default export is only for building @fest-lib/subsystem itself.
// Other packages must use named `initiate(NAME, …)` — see header INVARIANT.
export default defineConfig(async () => {
    const tsconfig = JSON.parse(await readFile(resolve(pkgDir, "./tsconfig.json"), { encoding: "utf8" }));
    return initiate("subsystem", tsconfig, pkgDir);
});

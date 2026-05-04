import { resolve  } from "node:path";
import { readFile } from "node:fs/promises";


//
const importConfig = (url, ...args)=>{ return import(url)?.then?.((m)=>m?.default?.(...args)); }
const objectAssign = (target, ...sources) => {
    if (!sources?.length) return target;
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

//
export const NAME = "subsystem";
export const __dirname = resolve(import.meta.dirname, "./");
export default objectAssign(
    await importConfig(resolve(__dirname, "../../shared/vite.config.js"),
        NAME,
        JSON.parse(await readFile(resolve(__dirname, "./tsconfig.json"), {encoding: "utf8"})),
        __dirname
    ),
    {}
);


import { resolve } from "node:path";
//import { compression } from 'vite-plugin-compression2';

//
//import optimizer from 'vite-plugin-optimizer';
import { externalPlugin } from "@praha/vite-plugin-external";
import deduplicate from "postcss-discard-duplicates";
//import postcssPresetEnv from 'postcss-preset-env';
import autoprefixer from "autoprefixer";
//import tsconfigPaths from 'vite-tsconfig-paths';
import cssnano from "cssnano";
import https from "./https/certificate.mjs";
import { searchForWorkspaceRoot } from "vite";
import { npmFestImportRewritePlugin } from "./vite-npm-imports.mjs";

//
function normalizeAliasPattern(pattern) {
    // Удаляет /*, /**, /**/* с конца строки
    return pattern.replace(/\/\*+$/, '');
}

//
const importFromTSConfig = (tsconfig, __dirname) => {
    const paths = tsconfig?.compilerOptions?.paths || {};
    const alias = [];
    for (const key in paths) {
        const normalizedKey = normalizeAliasPattern(key);
        const target = paths[key][0];
        const normalizedTarget = normalizeAliasPattern(target);
        alias.push({
            find: normalizedKey,
            replacement: resolve(__dirname, normalizedTarget),
        });
    }
    return alias;
};

//
export const initiate = (NAME = "generic", tsconfig = {}, __dirname = resolve("./", import.meta.dirname))=>{
    const $resolve = { alias: importFromTSConfig(tsconfig, __dirname) }
    const projectMap = new Map([
        ["fest/core", "core.ts"],
        ["fest/icon", "icon.ts"],
        ["fest/fl-ui", "fl.ui"],
        ["fest/object", "object.ts"],
        ["fest/uniform", "uniform.ts"],
        ["fest/dom", "dom.ts"],
        ["fest/veela", "veela.css"],
        ["fest/veela-runtime", "veela.css"],
        ["fest/lure", "lur.e"],
    ]);

    //
    const plugins = [
        /*tsconfigPaths({
            projects: [resolve(__dirname, './tsconfig.json')],
        }),*/
        //optimizer({}),
        //compression(),
        externalPlugin({
            include: Array.from(projectMap?.keys()).filter((n)=>!n?.endsWith(NAME)), // Explicitly externalize specific packages
            exclude: [resolve(__dirname, "./src/index.ts"), "./src/index.ts", resolve(__dirname, "./dist/"+NAME+".js"), "./dist/"+NAME+".js"]
        }),
        ...(process.env.FEST_NPM_IMPORTS === "1" ? [npmFestImportRewritePlugin()] : []),
    ];

    //
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
            if (source?.includes?.("fest/"+NAME) || source?.includes?.("./src/index.ts") || source?.includes?.(projectMap.get("fest/"+NAME)) || source?.includes?.("dist/")) return false;
            if (Array.from(projectMap.keys()).some((name)=>source.includes(name))) return true;
            return false;
        },
        output: {
            compact: true,
            name: NAME,
            dir: './dist',
            exports: "auto",
            minifyInternalExports: true
        }
    };

    //
    const css = {
        postcss: {
            plugins: [
                deduplicate(),
                autoprefixer(),
                cssnano({
                    preset: ['advanced', {
                        calc: false,
                        layer: false,
                        scope: false,
                        discardComments: {
                            removeAll: true
                        }
                    }],
                }),
                /*postcssPresetEnv({
                    features: { 'nesting-rules': false, 'custom-properties': false },
                    stage: 0
                })*/
            ],
        },
    }

    //
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
        entries: [resolve(__dirname, './src/index.ts'),],
        force: true
    }

    //
    const server = {
        port: 443,
        open: false,
        host: "0.0.0.0",
        origin: "https://localhost",
        allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', '192.168.0.200', '95.188.82.223'],
        appType: 'spa',
        https,
        fs: {
            strict: false,
            allow: [searchForWorkspaceRoot(process.cwd()), '../**/*', '../*', '..', resolve(__dirname, './**/*'), resolve(__dirname, './*'), __dirname ]
        },
    };

    //
    const build = {
        chunkSizeWarningLimit: 1600,
        assetsInlineLimit: 1024 * 1024,
        minify: "esbuild",
        emptyOutDir: true,
        target: 'esnext',
        modulePreload: {
            polyfill: true,
            include: [
                "fest/core",
                "fest/dom",
                "fest/lure",
                "fest/object",
                "fest/uniform",
            ]
        },
        rollupOptions,
        name: NAME,
        lib: {
            formats: ["es"],
            entry: resolve(__dirname, './src/index.ts'),
            name: NAME,
            fileName: NAME,
        },
    }

    const esbuild = {
        legalComments: 'none',
        minify: true,
        minifySyntax: true,
        minifyIdentifiers: true,
        minifyWhitespace: true
    }

    //
    return {esbuild, rollupOptions, plugins, resolve: $resolve, build, css, optimizeDeps, server};
}

//
export default initiate;

/**
 * When FEST_NPM_IMPORTS=1, rewrite external `fest/*` specifiers in emitted chunks to
 * `@fest-lib/*` so published packages resolve on npm without a bundler alias map.
 *
 * Default `vite build` (no env) keeps `fest/*` for monorepo / symlink workflows.
 */

/** Subpath imports: prefix replacement only */
const PREFIXES = [
    ["@fest-lib/veela/", "@fest-lib/veela/"],
    ["@fest-lib/fl-ui/", "@fest-lib/fl-ui/"],
];

/** Package root imports: exact specifier replacement */
const EXACT = [
    ["@fest-lib/core", "@fest-lib/core"],
    ["@fest-lib/dom", "@fest-lib/dom"],
    ["@fest-lib/style-lib", "@fest-lib/style-lib"],
    ["@fest-lib/object", "@fest-lib/object"],
    ["@fest-lib/lure", "@fest-lib/lure"],
    ["@fest-lib/uniform", "@fest-lib/uniform"],
    ["@fest-lib/icon", "@fest-lib/icon"],
    ["@fest-lib/veela", "@fest-lib/veela"],
    ["@fest-lib/fl-ui", "@fest-lib/fl-ui"],
];

function rewritePrefixes(code) {
    let out = code;
    for (const [from, to] of PREFIXES) {
        out = out.replaceAll(`from "${from}`, `from "${to}`);
        out = out.replaceAll(`from '${from}`, `from '${to}`);
        out = out.replaceAll(`import("${from}`, `import("${to}`);
        out = out.replaceAll(`import('${from}`, `import('${to}`);
    }
    return out;
}

function rewriteExact(code) {
    let out = code;
    for (const [from, to] of EXACT) {
        out = out.replaceAll(`from "${from}"`, `from "${to}"`);
        out = out.replaceAll(`from '${from}'`, `from '${to}'`);
        out = out.replaceAll(`import("${from}")`, `import("${to}")`);
        out = out.replaceAll(`import('${from}')`, `import('${to}')`);
        out = out.replaceAll(`import("${from}?`, `import("${to}?`);
        out = out.replaceAll(`import('${from}?`, `import('${to}?`);
    }
    return out;
}

function rewriteAll(code) {
    if (!code.includes("@fest-lib/")) return code;
    let next = rewritePrefixes(code);
    next = rewriteExact(next);
    return next;
}

/**
 * @returns {import('vite').Plugin}
 */
export function npmFestImportRewritePlugin() {
    return {
        name: "fest-npm-import-rewrite",
        apply: "build",
        enforce: "post",
        /** Vite lib builds reliably hit this hook (renderChunk alone may not). */
        generateBundle(_options, bundle) {
            if (process.env.FEST_NPM_IMPORTS !== "1") return;
            for (const item of Object.values(bundle)) {
                if (item.type !== "chunk" || typeof item.code !== "string") continue;
                if (!item.code.includes("@fest-lib/")) continue;
                const next = rewriteAll(item.code);
                if (next !== item.code) item.code = next;
            }
        },
    };
}

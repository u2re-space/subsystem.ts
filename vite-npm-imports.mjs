/**
 * When FEST_NPM_IMPORTS=1, rewrite external `fest/*` specifiers in emitted chunks to
 * `@fest-lib/*` so published packages resolve on npm without a bundler alias map.
 *
 * Default `vite build` (no env) keeps `fest/*` for monorepo / symlink workflows.
 */

/** Subpath imports: prefix replacement only */
const PREFIXES = [
    ["fest/veela/", "@fest-lib/veela/"],
    ["fest/fl-ui/", "@fest-lib/fl-ui/"],
];

/** Package root imports: exact specifier replacement */
const EXACT = [
    ["fest/core", "@fest-lib/core"],
    ["fest/dom", "@fest-lib/dom"],
    ["fest/object", "@fest-lib/object"],
    ["fest/lure", "@fest-lib/lure"],
    ["fest/uniform", "@fest-lib/uniform"],
    ["fest/icon", "@fest-lib/icon"],
    ["fest/veela", "@fest-lib/veela"],
    ["fest/fl-ui", "@fest-lib/fl-ui"],
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
    if (!code.includes("fest/")) return code;
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
                if (!item.code.includes("fest/")) continue;
                const next = rewriteAll(item.code);
                if (next !== item.code) item.code = next;
            }
        },
    };
}

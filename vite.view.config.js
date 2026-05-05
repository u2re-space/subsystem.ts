import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { getViewResolveAliases, workspaceRoot, viewsRoot } from "./view-resolve-aliases.js";

const alias = (find, replacement) => ({ find, replacement });

/**
 * PEM pair under `projectRoot/sslDir` (default filenames or env overrides).
 * Env: `VITE_SSL_CERT`, `VITE_SSL_KEY` (absolute or relative paths).
 * @returns {{ key: Buffer, cert: Buffer } | null}
 */
export function tryLoadDevSslFromDir(projectRoot, { sslDir = "certs", certFile = "cert.pem", keyFile = "key.pem" } = {}) {
    const dir = resolve(projectRoot, sslDir);
    const certPath = process.env.VITE_SSL_CERT ? resolve(projectRoot, process.env.VITE_SSL_CERT) : resolve(dir, certFile);
    const keyPath = process.env.VITE_SSL_KEY ? resolve(projectRoot, process.env.VITE_SSL_KEY) : resolve(dir, keyFile);
    try {
        if (!existsSync(certPath) || !existsSync(keyPath)) return null;
        return {
            cert: readFileSync(certPath),
            key: readFileSync(keyPath)
        };
    } catch {
        return null;
    }
}

/** @param {number | string | undefined} [defaultDevPort] e.g. 443 for OPFS-friendly demos */
function resolveDevServerPort(defaultDevPort) {
    const raw = process.env.VIEW_DEV_PORT;
    if (raw != null && String(raw).trim() !== "") {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    if (defaultDevPort != null && String(defaultDevPort).trim() !== "") {
        const n = Number(defaultDevPort);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    return undefined;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.sslDir] — if set, try PEMs under project root before basic-ssl.
 * @param {Record<string, unknown>} [opts.buildExtend] — shallow-merged into Vite `build` (e.g. `{ cssMinify: false }`).
 */
export function defineViewProject({ name, root = process.cwd(), defaultDevPort, sslDir, buildExtend } = {}) {
    const projectRoot = resolve(root);
    const entry = resolve(projectRoot, "src/index.ts");
    const sharedRoot = resolve(import.meta.dirname);
    const testEntry = resolve(sharedRoot, "test/module-smoke.ts");

    const port = resolveDevServerPort(defaultDevPort);
    const useHttps = process.env.VIEW_DEV_HTTP !== "1";
    const projectSsl = sslDir !== undefined ? tryLoadDevSslFromDir(projectRoot, { sslDir: sslDir || "certs" }) : null;
    const plugins = useHttps ? (projectSsl ? [] : [basicSsl()]) : [];
    const serverHttps =
        !useHttps ? false : projectSsl !== null ? projectSsl : undefined;

    /*
     * Do not default server.origin to localhost: with host 0.0.0.0, pages opened as
     * https://192.168.x.x still get worker /@fs URLs pinned to https://localhost → Worker SecurityError.
     * Set VITE_DEV_ORIGIN when you need a fixed public URL (tunnel / reverse proxy).
     */
    const viteDevOrigin = (process.env.VITE_DEV_ORIGIN || "").trim();

    return defineConfig(({ mode }) => ({
        root: projectRoot,
        plugins,
        resolve: {
            alias: getViewResolveAliases([alias("view-entry", entry)])
        },
        server: {
            host: "0.0.0.0",
            open: false,
            strictPort: false,
            port,
            ...(viteDevOrigin ? { origin: viteDevOrigin } : {}),
            https: serverHttps,
            fs: {
                allow: [searchForWorkspaceRoot(projectRoot), workspaceRoot, viewsRoot]
            }
        },
        build: {
            target: "esnext",
            emptyOutDir: true,
            outDir: mode === "test" ? "dist-test" : "dist",
            lib: {
                entry: mode === "test" ? testEntry : entry,
                name: name ?? "view",
                formats: ["es"],
                fileName: name ?? "view"
            },
            rollupOptions: {
                external: []
            },
            ...(buildExtend || {})
        },
        css: {
            preprocessorOptions: {
                scss: {
                    quietDeps: true
                }
            }
        },
        define: {
            __VIEW_PROJECT_NAME__: JSON.stringify(name ?? "view")
        }
    }));
}

export default defineViewProject;

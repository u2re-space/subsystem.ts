/*
 * Filename: vite.view.config.js
 * FullPath: modules/views/explorer-view/vite.view.config.js
 * Change date and time: 10.17.00_29.07.2026
 * Reason for changes: Optional VitePWA + /pwa static middleware for explorer host.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { getViewResolveAliases, workspaceRoot, viewsRoot } from "./view-resolve-aliases.js";
import { createSsreAndProcessVitePlugins } from "./vite-ssre.mjs";

const alias = (find, replacement) => ({ find, replacement });

/**
 * PEM pair candidates for view-dev HTTPS.
 * WHY: localhost-only `certs/*.pem` makes browsers flag `https://192.168.x.x` as Not secure;
 * CrossWord / CWSP-shared `multi.crt` already covers LAN + public SANs.
 *
 * Env: `VITE_SSL_CERT`, `VITE_SSL_KEY` (absolute or relative to projectRoot) win first.
 * @returns {{ key: Buffer, cert: Buffer } | null}
 */
export function tryLoadDevSslFromDir(projectRoot, { sslDir = "certs", certFile = "cert.pem", keyFile = "key.pem" } = {}) {
    const root = resolve(projectRoot);
    const pairs = [];
    if (process.env.VITE_SSL_CERT && process.env.VITE_SSL_KEY) {
        pairs.push({
            cert: resolve(root, process.env.VITE_SSL_CERT),
            key: resolve(root, process.env.VITE_SSL_KEY)
        });
    }
    const localDir = resolve(root, sslDir);
    // Prefer multi (LAN SANs) over localhost-only cert.pem / basic-ssl.
    pairs.push(
        { cert: resolve(localDir, "multi.crt"), key: resolve(localDir, "multi.key") },
        {
            cert: resolve(workspaceRoot, "apps/CrossWord/private/https/local/multi.crt"),
            key: resolve(workspaceRoot, "apps/CrossWord/private/https/local/multi.key")
        },
        {
            cert: resolve(workspaceRoot, "apps/CWSP-shared/private/https/local/multi.crt"),
            key: resolve(workspaceRoot, "apps/CWSP-shared/private/https/local/multi.key")
        },
        { cert: resolve(localDir, certFile), key: resolve(localDir, keyFile) }
    );
    for (const { cert: certPath, key: keyPath } of pairs) {
        try {
            if (!existsSync(certPath) || !existsSync(keyPath)) continue;
            return {
                cert: readFileSync(certPath),
                key: readFileSync(keyPath)
            };
        } catch {
            /* try next candidate */
        }
    }
    return null;
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
 * Serve `src/pwa/manifest.json` + icons under `/pwa/*` in Vite dev,
 * and copy them flat into `dist/pwa/` on build (avoids symlink path nesting).
 * @param {string} projectRoot
 */
function explorerPwaAssetsPlugin(projectRoot) {
    const pwaRoot = resolve(projectRoot, "src/pwa");
    const copyBuildAssets = (outDir) => {
        const dest = resolve(projectRoot, outDir, "pwa");
        const iconsDest = resolve(dest, "icons");
        mkdirSync(iconsDest, { recursive: true });
        copyFileSync(resolve(pwaRoot, "manifest.json"), resolve(dest, "manifest.json"));
        for (const name of readdirSync(resolve(pwaRoot, "icons"))) {
            copyFileSync(resolve(pwaRoot, "icons", name), resolve(iconsDest, name));
        }
    };
    return {
        name: "explorer-pwa-assets",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const raw = req.url?.split("?")[0] || "";
                if (raw === "/pwa/manifest.json") {
                    const fp = resolve(pwaRoot, "manifest.json");
                    if (!existsSync(fp)) return next();
                    res.setHeader("Content-Type", "application/manifest+json");
                    res.end(readFileSync(fp));
                    return;
                }
                if (raw.startsWith("/pwa/icons/")) {
                    const name = raw.slice("/pwa/icons/".length);
                    if (!name || name.includes("..")) return next();
                    const fp = resolve(pwaRoot, "icons", name);
                    if (!existsSync(fp)) return next();
                    if (name.endsWith(".svg")) res.setHeader("Content-Type", "image/svg+xml");
                    else if (name.endsWith(".png")) res.setHeader("Content-Type", "image/png");
                    else if (name.endsWith(".ico")) res.setHeader("Content-Type", "image/x-icon");
                    res.end(readFileSync(fp));
                    return;
                }
                next();
            });
        },
        closeBundle() {
            // WHY: vite-plugin-static-copy nests `src/pwa/...` when root is a symlink.
            try {
                copyBuildAssets("dist");
            } catch (err) {
                console.warn("[explorer-pwa-assets] dist copy failed", err);
            }
        }
    };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.sslDir] — if set, try PEMs under project root before basic-ssl.
 * @param {Record<string, unknown>} [opts.buildExtend] — shallow-merged into Vite `build`.
 * @param {boolean} [opts.pwa] — enable slim Explorer PWA (VitePWA injectManifest + /pwa assets).
 * @param {boolean} [opts.ssre] — inject ssre into existing index.html + `/ssre/channel` on Vite Dev.
 */
export function defineViewProject({ name, root = process.cwd(), defaultDevPort, sslDir, buildExtend, pwa = false, ssre = false } = {}) {
    const projectRoot = resolve(root);
    const entry = resolve(projectRoot, "src/index.ts");
    const sharedRoot = resolve(import.meta.dirname);
    const testEntry = resolve(sharedRoot, "test/module-smoke.ts");
    const outDirDefault = "dist";

    const port = resolveDevServerPort(defaultDevPort);
    const useHttps = process.env.VIEW_DEV_HTTP !== "1";
    const projectSsl = sslDir !== undefined ? tryLoadDevSslFromDir(projectRoot, { sslDir: sslDir || "certs" }) : null;
    /** @type {import('vite').Plugin[]} */
    const plugins = useHttps ? (projectSsl ? [] : [basicSsl()]) : [];
    const serverHttps =
        !useHttps ? false : projectSsl !== null ? projectSsl : undefined;

    if (ssre) {
        plugins.push(...createSsreAndProcessVitePlugins(projectRoot));
    }

    if (pwa) {
        plugins.push(explorerPwaAssetsPlugin(projectRoot));
        plugins.push(
            VitePWA({
                srcDir: "src/pwa",
                filename: "sw.ts",
                strategies: "injectManifest",
                injectRegister: false,
                registerType: "autoUpdate",
                manifest: false,
                injectManifest: {
                    rollupFormat: "iife",
                    injectionPoint: "self.__WB_MANIFEST",
                    maximumFileSizeToCacheInBytes: 1024 * 1024 * 8,
                    // Online-first: do not pull the whole app into precache via glob.
                    globPatterns: [],
                    globIgnores: ["**/*"]
                },
                devOptions: {
                    enabled: true,
                    type: "module",
                    navigateFallback: "index.html"
                }
            })
        );
    }

    /*
     * Do not default server.origin to localhost: with host 0.0.0.0, pages opened as
     * https://192.168.x.x still get worker /@fs URLs pinned to https://localhost → Worker SecurityError.
     * Set VITE_DEV_ORIGIN when you need a fixed public URL (tunnel / reverse proxy).
     */
    const viteDevOrigin = (process.env.VITE_DEV_ORIGIN || "").trim();

    return defineConfig(({ mode }) => {
        const isTest = mode === "test";
        const spaBuild = pwa && !isTest;

        return {
            root: projectRoot,
            plugins,
            resolve: {
                alias: getViewResolveAliases(projectRoot, [alias("view-entry", entry)])
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
                outDir: isTest ? "dist-test" : outDirDefault,
                ...(spaBuild
                    ? {
                          rollupOptions: {
                              input: resolve(projectRoot, "index.html"),
                              external: []
                          }
                      }
                    : {
                          lib: {
                              entry: isTest ? testEntry : entry,
                              name: name ?? "view",
                              formats: ["es"],
                              fileName: name ?? "view"
                          },
                          rollupOptions: {
                              external: []
                          }
                      }),
                /* WHY: lightningcss chokes on some Veela `::slotted` shapes (same as environment-shell). */
                cssMinify: false,
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
        };
    });
}

export default defineViewProject;

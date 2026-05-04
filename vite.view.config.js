import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { getViewResolveAliases, workspaceRoot, viewsRoot } from "./view-resolve-aliases.js";

const alias = (find, replacement) => ({ find, replacement });

/** HTTPS for view dev servers unless VIEW_DEV_HTTP=1 (plain HTTP for quick local checks). */
const viewDevHttpsPlugins = process.env.VIEW_DEV_HTTP === "1" ? [] : [basicSsl()];

export function defineViewProject({ name, root = process.cwd() } = {}) {
    const projectRoot = resolve(root);
    const entry = resolve(projectRoot, "src/index.ts");
    const sharedRoot = resolve(import.meta.dirname);
    const testEntry = resolve(sharedRoot, "test/module-smoke.ts");

    return defineConfig(({ mode }) => ({
        root: projectRoot,
        plugins: viewDevHttpsPlugins,
        resolve: {
            alias: getViewResolveAliases([alias("view-entry", entry)])
        },
        server: {
            host: "0.0.0.0",
            open: false,
            port: Number(process.env.VIEW_DEV_PORT || 0) || undefined,
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
            }
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

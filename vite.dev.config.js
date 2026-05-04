/**
 * HTTPS dev server for modules/shared/index.html — loads view modules via test/playground.ts.
 * Run: npm run dev  (default https://localhost:8443 — port shown in terminal if busy)
 */
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { getViewResolveAliases, viewsRoot, workspaceRoot } from "../../views/shared/view-resolve-aliases.js";

const pkgRoot = resolve(import.meta.dirname);

export default defineConfig({
    root: pkgRoot,
    plugins: [basicSsl()],
    resolve: {
        alias: getViewResolveAliases()
    },
    server: {
        host: "0.0.0.0",
        port: Number(process.env.VIEW_DEV_PORT || 8443),
        strictPort: false,
        open: false,
        fs: {
            allow: [
                searchForWorkspaceRoot(pkgRoot),
                workspaceRoot,
                viewsRoot,
                resolve(pkgRoot, ".."),
                resolve(pkgRoot, "../.."),
                resolve(pkgRoot, "../../views")
            ]
        }
    },
    css: {
        preprocessorOptions: {
            scss: {
                quietDeps: true
            }
        }
    }
});

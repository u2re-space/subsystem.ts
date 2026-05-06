/**
 * HTTPS dev server for views playground (`index.html`, `demo.html`).
 * Default port 443 (needs bind permission on Linux: `sudo setcap 'cap_net_bind_service=+ep' $(command -v node)` or run via sudo).
 * Fallback: `VIEW_DEV_PORT=8443 npm run dev` (localhost remains a secure context; OPFS works there too).
 */
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { getViewResolveAliases, viewsRoot, workspaceRoot } from "../../views/view-resolve-aliases.js";

const pkgRoot = resolve(import.meta.dirname);
const port = Number(process.env.VIEW_DEV_PORT || 443);
const viteDevOrigin = (process.env.VITE_DEV_ORIGIN || "").trim();

export default defineConfig({
    root: pkgRoot,
    plugins: [basicSsl()],
    resolve: {
        alias: getViewResolveAliases(pkgRoot)
    },
    server: {
        host: "0.0.0.0",
        port,
        strictPort: false,
        ...(viteDevOrigin ? { origin: viteDevOrigin } : {}),
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

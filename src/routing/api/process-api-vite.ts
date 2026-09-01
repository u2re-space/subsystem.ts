/*
 * Filename: process-api-vite.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-api-vite.ts
 * FIND:process
 *
 * Vite Dev middleware for `/api/process/*` — same local-first fallback as Fastify / SW.
 */
import { isProcessApiPath } from "./process-api.ts";
import { handleProcessApiPost, processApiMissPayload } from "./process-local.ts";
import { isProcessApiRequest } from "./process-api-sw.ts";

const pathOf = (url = "/"): string => {
    try {
        return new URL(url, "http://process.local").pathname;
    } catch {
        return url.split("?")[0] || "/";
    }
};

const readBody = (req: { on: (ev: string, cb: (chunk?: unknown) => void) => void }): Promise<string> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? "")));
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });

const sendJson = (res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, json: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(json));
};

export function processApiVite(): { name: string; configureServer: (server: { middlewares: { use: (fn: any) => void } }) => void } {
    return {
        name: "process-api",
        configureServer(server) {
            server.middlewares.use(async (req: any, res: any, next: () => void) => {
                const pathname = pathOf(req.url || "/");
                const method = String(req.method || "GET").toUpperCase();
                if (!isProcessApiRequest(pathname, method)) return next();
                if (method === "GET" || method === "HEAD") {
                    sendJson(res, {
                        ok: true,
                        id: "cw-process-api",
                        fallback: "vite",
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
                try {
                    const raw = await readBody(req);
                    let body: Record<string, unknown> | null = null;
                    try {
                        const json = raw ? JSON.parse(raw) : null;
                        body = json && typeof json === "object" ? json : null;
                    } catch {
                        body = null;
                    }
                    sendJson(res, await handleProcessApiPost(body, "vite"));
                } catch (error) {
                    sendJson(res, {
                        ...processApiMissPayload("vite"),
                        error: String(error instanceof Error ? error.message : error)
                    });
                }
            });
        }
    };
}

export { isProcessApiPath };

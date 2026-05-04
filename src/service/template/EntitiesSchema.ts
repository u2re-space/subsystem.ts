/**
 * Lazy loader for `Entities-v2.md`.
 *
 * This replaces bundler-specific `?raw` imports so the schema can be used from Node/Deno backend too.
 * In browser builds, this will simply return an empty string unless your bundler polyfills node:fs.
 */

export const loadEntitiesSchemaMarkdown = async (): Promise<string> => {
    try {
        const [{ readFile }, pathMod, urlMod] = await Promise.all([
            import("node:fs/promises"),
            import("node:path"),
            import("node:url")
        ]);
        const dir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
        return await readFile(pathMod.join(dir, "Entities-v2.md"), "utf8");
    } catch {
        return "";
    }
};



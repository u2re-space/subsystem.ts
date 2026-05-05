/**
 * Bootstraps the app from index.html. Kept as a separate module so Vite does not
 * use addInlineModule() on a large inline script (avoids MagicString
 * "Cannot overwrite a zero-length range" with PWA / other index transforms).
 */
(async () => {
    const mount = document.getElementById("app");
    if (!mount) {
        console.error("[Boot] #app missing");
        return;
    }
    try {
        const mod = await import("../../index.ts");
        const run = mod?.default;
        if (typeof run !== "function") {
            console.error("[Boot] default export is not a function:", run);
            return;
        }
        await run(mount);
    } catch (error) {
        console.error("[Boot] Failed:", error);
        mount.replaceChildren();
        const wrap = document.createElement("div");
        wrap.style.cssText =
            "display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;padding:2rem;font-family:system-ui,sans-serif;text-align:center;";
        const title = document.createElement("h2");
        title.style.color = "#d32f2f";
        title.textContent = "Failed to start";
        const msg = document.createElement("p");
        msg.style.color = "#666";
        msg.textContent = error instanceof Error ? error.message : String(error);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Reload";
        btn.style.cssText =
            "margin-top:1rem;padding:0.5rem 1rem;cursor:pointer;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;";
        btn.addEventListener("click", () => location.reload());
        wrap.append(title, msg, btn);
        mount.append(wrap);
    }
})();
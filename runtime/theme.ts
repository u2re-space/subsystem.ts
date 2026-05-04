export function applyTheme(theme: "auto" | "light" | "dark" | string): void {
    const resolved =
        theme === "auto"
            ? globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches
                ? "dark"
                : "light"
            : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved === "dark" ? "dark" : "light";
}

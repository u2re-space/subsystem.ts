import type { ViewOptions } from "../types";

export async function navigateToView(viewId: string, options?: ViewOptions): Promise<void> {
    globalThis.dispatchEvent?.(new CustomEvent("view:navigate", { detail: { viewId, options } }));
}

/**
 * Dispatch imperative view APIs loaded in {@link ViewRegistry} — used by shells, CRX bridges, SW fan-out.
 */

import type { ViewId } from "shells/types";
import type { ChannelInvokableView } from "views/apis/channel-invokable";
import { ViewRegistry } from "./registry";

export type ViewChannelInvokeResult =
    | { ok: true; result?: unknown }
    | { ok: false; reason: "not-loaded" | "not-invokable" | "error"; detail?: string };

export async function invokeCrossWordViewChannel(
    viewId: ViewId,
    action: string,
    payload?: unknown
): Promise<ViewChannelInvokeResult> {
    const view = ViewRegistry.getLoaded(viewId);
    if (!view) return { ok: false, reason: "not-loaded" };

    const inv = view as unknown as ChannelInvokableView;
    if (typeof inv.invokeChannelApi !== "function") {
        return { ok: false, reason: "not-invokable" };
    }

    try {
        const result = await Promise.resolve(inv.invokeChannelApi(action, payload));
        return { ok: true, result };
    } catch (e) {
        return { ok: false, reason: "error", detail: String(e) };
    }
}

/**
 * Optional imperative surface for routing / SW / extensions without coupling views to transport names.
 * Views implement {@link invokeChannelApi}; shells and {@link com/routing/view-channel-invoke} call it.
 */

import type { ViewId } from "shells/types";

export interface ChannelInvokableView {
    readonly id: ViewId;

    /**
     * Stable action ids (prefer values from `./channel-actions`).
     * Payload shape is per-action; unknown actions should return undefined / false or delegate to handleMessage where appropriate.
     */
    invokeChannelApi?(action: string, payload?: unknown): unknown | Promise<unknown>;
}

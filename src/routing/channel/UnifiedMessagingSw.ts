/**
 * MV3 service worker–safe unified messaging: BroadcastChannel only.
 * Avoids `fest/uniform` (IndexedDB queue, worker bootstrap, import() side effects).
 */

import { createDestinationChannelMappings } from "com/config/Names";
import { createInteropEnvelope, type InteropEnvelope, type InteropMessageInput } from "./UniformInterop";

/** Shared SW-safe interop envelope used by CRX and PWA worker surfaces. */
export type SwUnifiedMessage<T = unknown> = InteropEnvelope<T>;

const CHANNEL_BY_DESTINATION: Record<string, string> = createDestinationChannelMappings();

async function postToBroadcast(name: string, message: SwUnifiedMessage): Promise<boolean> {
    try {
        const bc = new BroadcastChannel(name);
        bc.postMessage(message);
        bc.close();
        return true;
    } catch {
        return false;
    }
}

export const unifiedMessaging = {
    async sendMessage(message: InteropMessageInput): Promise<boolean> {
        const envelope = createInteropEnvelope({
            ...message,
            source: message.source ?? "crx-service-worker",
            protocol: message.protocol ?? "worker",
            transport: message.transport ?? "service-worker:http",
            purpose: message.purpose ?? ["mail"],
            srcChannel: message.srcChannel ?? message.source ?? "crx-service-worker",
            dstChannel: message.dstChannel ?? message.destination
        });
        const dest = String(envelope.destination ?? "").trim();
        const channelName = CHANNEL_BY_DESTINATION[dest];
        if (!channelName) return false;

        return postToBroadcast(channelName, envelope);
    },
};

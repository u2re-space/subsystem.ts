/**
 * Unified Messaging System for CrossWord
 * Extends fest/uniform messaging with app-specific configuration
 */

import {
    UnifiedMessagingManager,
    getUnifiedMessaging as getBaseMessaging,
    createProtocolEnvelope,
    isProtocolEnvelope,
    normalizeProtocolEnvelope,
    type UnifiedMessage,
    type ProtocolMessage,
    type CreateEnvelopeInput,
    type UniformProtocolName,
    type MessageHandler,
    type WorkerChannelConfig,
    type PipelineConfig,
    type PipelineStage,
    type UnifiedMessagingConfig
} from 'fest/uniform';

import {
    BROADCAST_CHANNELS,
    CONTENT_TYPES,
    DESTINATIONS,
    createDestinationChannelMappings,
    getDestinationAliases,
    normalizeDestination,
} from 'com/config/Names';

import { resolveAssociation, resolveAssociationPipeline } from './ContentAssociations';
import { createInteropEnvelope, toUnifiedInteropMessage } from "./UniformInterop";

// Re-export types for consumers
export type {
    UnifiedMessage,
    ProtocolMessage,
    CreateEnvelopeInput,
    UniformProtocolName,
    MessageHandler,
    WorkerChannelConfig,
    PipelineConfig,
    PipelineStage,
    UnifiedMessagingConfig
};

// ============================================================================
// APP-SPECIFIC CHANNEL MAPPINGS
// ============================================================================

const APP_CHANNEL_MAPPINGS: Record<string, string> = {
    ...createDestinationChannelMappings(),
    [DESTINATIONS.WORKCENTER]: BROADCAST_CHANNELS.WORK_CENTER,
    [DESTINATIONS.CLIPBOARD]: BROADCAST_CHANNELS.CLIPBOARD,
};

// ============================================================================
// APP-SPECIFIC MESSAGING MANAGER
// ============================================================================

let appMessagingInstance: UnifiedMessagingManager | null = null;

/**
 * Get the app-configured UnifiedMessagingManager
 */
export function getUnifiedMessaging(): UnifiedMessagingManager {
    if (!appMessagingInstance) {
        appMessagingInstance = getBaseMessaging({
            channelMappings: APP_CHANNEL_MAPPINGS,
            queueOptions: {
                dbName: 'CrossWordMessageQueue',
                storeName: 'messages',
                maxRetries: 3,
                defaultExpirationMs: 24 * 60 * 60 * 1000 // 24 hours
            },
            pendingStoreOptions: {
                storageKey: 'rs-unified-messaging-pending',
                maxMessages: 200,
                defaultTTLMs: 24 * 60 * 60 * 1000 // 24 hours
            }
        });
    }
    return appMessagingInstance;
}

// Singleton instance for backward compatibility
export const unifiedMessaging = getUnifiedMessaging();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Send a message using the app-configured manager
 */
export function sendMessage(message: Omit<UnifiedMessage, 'id' | 'source'> & { source?: string }): Promise<boolean> {
    return unifiedMessaging.sendMessage(toUnifiedInteropMessage({
        ...message,
        source: message.source ?? 'unified-messaging'
    }) as UnifiedMessage);
}

export function sendProtocolMessage(
    message: Omit<CreateEnvelopeInput, 'source'> & { source?: string; protocol?: UniformProtocolName }
): Promise<boolean> {
    const interop = createInteropEnvelope({
        ...message,
        source: message.source ?? 'crossword-unified-messaging',
        protocol: message.protocol ?? 'window',
        purpose: message.purpose ?? 'mail',
        srcChannel: message.srcChannel ?? (message.source ?? 'crossword-unified-messaging'),
        dstChannel: message.dstChannel ?? message.destination
    });
    const envelope = createProtocolEnvelope({
        ...interop,
        source: interop.source,
        destination: interop.destination,
        data: interop.data,
        payload: interop.payload,
        metadata: interop.metadata,
        protocol: interop.protocol as UniformProtocolName,
        purpose: interop.purpose,
        srcChannel: interop.srcChannel,
        dstChannel: interop.dstChannel,
        redirect: interop.redirect,
        flags: interop.flags,
        op: interop.op,
        timestamp: interop.timestamp,
        result: interop.result,
        error: interop.error ? String(interop.error) : undefined
    });
    return unifiedMessaging.sendMessage(envelope as UnifiedMessage);
}

export { createProtocolEnvelope, isProtocolEnvelope, normalizeProtocolEnvelope };

/**
 * Register a handler using the app-configured manager
 */
export function registerHandler(destination: string, handler: MessageHandler): void {
    const aliases = getDestinationAliases(destination);
    const names = aliases.length > 0 ? aliases : [normalizeDestination(destination) || destination];
    for (const name of names) {
        unifiedMessaging.registerHandler(name, handler as any);
    }
}

export function unregisterHandler(destination: string, handler: MessageHandler): void {
    const aliases = getDestinationAliases(destination);
    const names = aliases.length > 0 ? aliases : [normalizeDestination(destination) || destination];
    for (const name of names) {
        unifiedMessaging.unregisterHandler(name, handler as any);
    }
}

/**
 * Get a worker channel from the app manager
 */
export function getWorkerChannel(viewHash: string, workerName: string) {
    return unifiedMessaging.getWorkerChannel(viewHash, workerName);
}

/**
 * Get a broadcast channel from the app manager
 */
export function getBroadcastChannel(channelName: string): BroadcastChannel {
    return unifiedMessaging.getBroadcastChannel(channelName);
}

// ============================================================================
// BACKWARD COMPATIBILITY FUNCTIONS
// ============================================================================

export function sendToWorkCenter(data: unknown, options?: Record<string, unknown>): Promise<boolean> {
    return sendMessage({
        type: 'content-share',
        source: 'unified-messaging',
        destination: DESTINATIONS.WORKCENTER,
        data,
        metadata: options
    });
}

export function sendToClipboard(data: unknown, options?: Record<string, unknown>): Promise<boolean> {
    return sendMessage({
        type: 'clipboard-copy',
        source: 'unified-messaging',
        destination: DESTINATIONS.CLIPBOARD,
        data,
        metadata: options
    });
}

export function navigateToView(view: string): Promise<boolean> {
    return sendMessage({
        type: 'navigation',
        source: 'unified-messaging',
        destination: 'router',
        data: { view },
        metadata: { priority: 'high' }
    });
}

export function initializeComponent(componentId: string): UnifiedMessage[] {
    return unifiedMessaging.initializeComponent(componentId);
}

export function hasPendingMessages(destination: string): boolean {
    return unifiedMessaging.hasPendingMessages(normalizeDestination(destination) || destination);
}

export function enqueuePendingMessage(destination: string, message: UnifiedMessage): void {
    const dest = normalizeDestination(destination) || String(destination ?? '').trim();
    if (!dest || !message) return;
    unifiedMessaging.enqueuePendingMessage(dest, message);
}

/**
 * Replay IndexedDB-backed queued messages for a destination (mail/deferred pipeline).
 * Safe after handlers register — implicit view bridge calls this post-bind.
 */
export function replayQueuedMessagesForDestination(destination?: string): Promise<void> {
    return unifiedMessaging.processQueuedMessages(destination);
}

export function registerComponent(componentId: string, destination: string): void {
    unifiedMessaging.registerComponent(componentId, normalizeDestination(destination) || destination);
}

// ============================================================================
// CONTENT PROCESSING (APP-SPECIFIC)
// ============================================================================

export function processInitialContent(content: Record<string, unknown>): Promise<void> {
    const contentType = String(content?.contentType ?? content?.type ?? CONTENT_TYPES.OTHER);
    const contentMetadata = (content?.metadata ?? {}) as Record<string, unknown>;
    const resolved = resolveAssociationPipeline({
        contentType,
        context: content?.context as string | undefined,
        processingSource: content?.processingSource as string | undefined,
        overrideFactors: (content?.overrideFactors ?? contentMetadata.overrideFactors) as string[] | undefined
    });

    const payload = content?.content ?? content?.data ?? content;
    const meta = contentMetadata;

    const source = String(content?.source ?? meta?.source ?? 'content-association');
    const tasks = resolved.pipeline.map((dest) => {
        if (dest === DESTINATIONS.VIEWER) {
            return sendMessage({
                type: 'content-view',
                source,
                destination: DESTINATIONS.VIEWER,
                contentType: resolved.normalizedContentType,
                data: {
                    content: (payload as Record<string, unknown>)?.text ?? (payload as Record<string, unknown>)?.content ?? payload,
                    text: (payload as Record<string, unknown>)?.text,
                    filename: (payload as Record<string, unknown>)?.filename ?? meta?.filename,
                },
                metadata: {
                    ...meta,
                    overrideFactors: resolved.overrideFactors,
                    context: content?.context,
                    processingSource: content?.processingSource
                }
            });
        }

        if (dest === DESTINATIONS.EXPLORER) {
            return sendMessage({
                type: 'content-explorer',
                source,
                destination: DESTINATIONS.EXPLORER,
                contentType: resolved.normalizedContentType,
                data: {
                    action: 'save',
                    ...(payload as Record<string, unknown>),
                },
                metadata: {
                    ...meta,
                    overrideFactors: resolved.overrideFactors,
                    context: content?.context,
                    processingSource: content?.processingSource
                }
            });
        }

        // Default: attach into workcenter
        return sendMessage({
            type: 'content-share',
            source,
            destination: DESTINATIONS.WORKCENTER,
            contentType: resolved.normalizedContentType,
            data: payload,
            metadata: {
                ...meta,
                overrideFactors: resolved.overrideFactors,
                context: content?.context,
                processingSource: content?.processingSource
            }
        });
    });

    return Promise.allSettled(tasks).then(() => {});
}

// ============================================================================
// MESSAGE CREATION HELPERS
// ============================================================================

export function createMessageWithOverrides(
    type: string,
    source: string,
    contentType: string,
    data: unknown,
    overrideFactors: string[] = [],
    processingSource?: string
): UnifiedMessage {
    const resolved = resolveAssociation({
        contentType,
        context: processingSource,
        processingSource,
        overrideFactors
    });

    return {
        id: crypto.randomUUID(),
        type,
        source,
        destination: resolved.destination === DESTINATIONS.VIEWER
            ? DESTINATIONS.VIEWER
            : resolved.destination === DESTINATIONS.EXPLORER
                ? DESTINATIONS.EXPLORER
                : DESTINATIONS.WORKCENTER,
        contentType,
        data,
        metadata: {
            timestamp: Date.now(),
            overrideFactors,
            processingSource,
            priority: 'normal'
        }
    };
}

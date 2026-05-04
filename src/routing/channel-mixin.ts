
import type {
    View,
    ViewLifecycle,
    ViewOptions
} from "shells/types";
import type {
    ChannelConnectedView,
    ViewMessageHandler,
    ChannelViewOptions,
    ShareTargetHandler,
    ShareTargetData
} from "./registry";
import { 
    serviceChannels, 
    affectedToChannel,
    sendToChannel,
    type ServiceChannelId,
    type ChannelMessage 
} from "com/core/ServiceChannels";
import { BROADCAST_CHANNELS, MESSAGE_TYPES, getDestinationAliases, matchesDestination, normalizeViewId } from "com/config/Names";
import {
    registerHandler,
    unregisterHandler,
    registerComponent,
    initializeComponent,
    type UnifiedMessage
} from "com/core/UnifiedMessaging";
import { fetchSwCachedEntries } from "com/core/ShareTargetGateway";
import { inferViewDestination, mapUnifiedMessageToView } from "./view-message-routing";
import { subscribeViewChannel } from "./view-api";
import { toUnifiedInteropMessage } from "com/core/UniformInterop";

/**
 * Creates a channel-connected view by mixing channel functionality into an existing view.
 * 
 * Usage:
 * ```ts
 * class MyView implements View { ... }
 * const ConnectedView = withViewChannel(MyView, "workcenter");
 * ```
 */
export function withViewChannel<T extends new (...args: any[]) => View>(
    ViewClass: T,
    defaultChannelId: ServiceChannelId
) {
    return class extends ViewClass implements ChannelConnectedView {
        channelId: ServiceChannelId = defaultChannelId;
        _channelUnaffected: (() => void) | null = null;
        _channelConnected = false;
        _messageHandlers = new Map<string, Set<ViewMessageHandler>>();

        constructor(...args: any[]) {
            super(...args);
            
            // Extract channel options if provided
            const options = args[0] as ChannelViewOptions | undefined;
            if (options?.channelId) {
                this.channelId = options.channelId;
            }
        }

        async connectChannel(): Promise<void> {
            if (this._channelConnected) return;

            console.log(`[ViewChannel] Connecting ${this.id} to channel ${this.channelId}`);

            // Initialize the service channel
            await serviceChannels.initChannel(this.channelId);

            // Subscribe to messages
            this._channelUnaffected = affectedToChannel(
                this.channelId,
                (message) => this._handleChannelMessage(message)
            );

            this._channelConnected = true;
            console.log(`[ViewChannel] ${this.id} connected to ${this.channelId}`);
        }

        disconnectChannel(): void {
            if (this._channelUnaffected) {
                this._channelUnaffected();
                this._channelUnaffected = null;
            }
            this._channelConnected = false;
            console.log(`[ViewChannel] ${this.id} disconnected from ${this.channelId}`);
        }

        async sendMessage<D>(type: string, data: D): Promise<void> {
            if (!this._channelConnected) {
                await this.connectChannel();
            }
            await sendToChannel(this.channelId, type, data);
        }

        isChannelConnected(): boolean {
            return this._channelConnected;
        }

        /**
         * Register a message handler
         */
        onChannelMessage(type: string, handler: ViewMessageHandler): () => void {
            if (!this._messageHandlers.has(type)) {
                this._messageHandlers.set(type, new Set());
            }
            this._messageHandlers.get(type)!.add(handler);

            return () => {
                this._messageHandlers.get(type)?.delete(handler);
            };
        }

        /**
         * Handle incoming channel message
         */
        _handleChannelMessage(message: ChannelMessage): void {
            // Call type-specific handlers
            const handlers = this._messageHandlers.get(message.type);
            if (handlers) {
                for (const handler of handlers) {
                    try {
                        handler(message);
                    } catch (error) {
                        console.error(`[ViewChannel] Handler error:`, error);
                    }
                }
            }

            // Call the view's handleMessage if it exists
            if (typeof (this as any).handleMessage === "function") {
                (this as any).handleMessage(message).catch(console.error);
            }
        }

        // Override lifecycle to connect/disconnect channel
        get lifecycle(): ViewLifecycle {
            const parentLifecycle = super.lifecycle || {};
            
            return {
                ...parentLifecycle,
                onMount: async () => {
                    await this.connectChannel();
                    if (parentLifecycle.onMount) {
                        await parentLifecycle.onMount();
                    }
                },
                onUnmount: async () => {
                    this.disconnectChannel();
                    if (parentLifecycle.onUnmount) {
                        await parentLifecycle.onUnmount();
                    }
                }
            };
        }
    };
}

/**
 * Mixin for views that can handle share targets
 */
export function withShareTargetHandler<T extends new (...args: any[]) => View>(
    ViewClass: T
) {
    return class extends ViewClass implements ShareTargetHandler {
        _shareTargetChannel: BroadcastChannel | null = null;

        constructor(...args: any[]) {
            super(...args);
        }

        async handleShareTarget(data: ShareTargetData): Promise<void> {
            console.log(`[ShareTarget] ${this.id} received:`, data);
            
            // Default implementation - override in subclass
            if (typeof (this as any).handleMessage === "function") {
                await (this as any).handleMessage({
                    type: MESSAGE_TYPES.SHARE_TARGET_INPUT,
                    data
                });
            }
        }

        canHandleShareTarget(_data: ShareTargetData): boolean {
            // Default: can handle if view has handleMessage method
            return typeof (this as any).handleMessage === "function";
        }

        /**
         * Start listening for share target broadcasts
         */
        startShareTargetListener(): void {
            if (this._shareTargetChannel) return;

            this._shareTargetChannel = new BroadcastChannel(BROADCAST_CHANNELS.SHARE_TARGET);
            this._shareTargetChannel.onmessage = async (event) => {
                const { type, data } = event.data || {};
                
                if (type === MESSAGE_TYPES.SHARE_RECEIVED && this.canHandleShareTarget(data)) {
                    await this.handleShareTarget(data);
                }
            };
        }

        /**
         * Stop listening for share target broadcasts
         */
        stopShareTargetListener(): void {
            if (this._shareTargetChannel) {
                this._shareTargetChannel.close();
                this._shareTargetChannel = null;
            }
        }

        // Override lifecycle
        get lifecycle(): ViewLifecycle {
            const parentLifecycle = super.lifecycle || {};
            
            return {
                ...parentLifecycle,
                onMount: async () => {
                    this.startShareTargetListener();
                    if (parentLifecycle.onMount) {
                        await parentLifecycle.onMount();
                    }
                },
                onUnmount: async () => {
                    this.stopShareTargetListener();
                    if (parentLifecycle.onUnmount) {
                        await parentLifecycle.onUnmount();
                    }
                }
            };
        }
    };
}

// ============================================================================
// COMBINED MIXINS
// ============================================================================

/**
 * Creates a fully connected view with channel and share target support
 */
export function withFullChannelSupport<T extends new (...args: any[]) => View>(
    ViewClass: T,
    channelId: ServiceChannelId
) {
    return withShareTargetHandler(withViewChannel(ViewClass, channelId));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check for pending share target data and deliver to view
 */
export async function checkAndDeliverShareData(
    view: View & Partial<ShareTargetHandler>
): Promise<boolean> {
    if (!view.handleShareTarget || !view.canHandleShareTarget) {
        return false;
    }

    try {
        const cacheEntries = await fetchSwCachedEntries();
        const latestShare = [...cacheEntries].reverse().find((entry) => entry.context === "share-target");
        const rawContent = latestShare?.content;

        if (rawContent && typeof rawContent === "object") {
            const shareData: ShareTargetData = {
                ...(rawContent as Record<string, unknown>),
                timestamp: Date.now(),
                source: "share-target"
            } as ShareTargetData;

            if (view.canHandleShareTarget(shareData)) {
                await view.handleShareTarget(shareData);
                return true;
            }
        }
    } catch (error) {
        console.warn("[ViewChannel] Failed to check share data:", error);
    }

    return false;
}

/**
 * Check URL params for cached content
 */
export function getContentFromUrlParams(): string | null {
    const params = new URLSearchParams(globalThis?.location?.search);
    return params.get("cached") || params.get("markdown-content");
}

export interface ViewReceiveBindingOptions {
    destination?: string;
    componentId?: string;
}

const deliverUnifiedMessageToView = async (view: View, message: UnifiedMessage): Promise<void> => {
    const mapped = mapUnifiedMessageToView(view, message);
    if (!mapped) return;
    await view.handleMessage?.(mapped);
};

export function bindViewReceiveChannel(
    view: View,
    options: ViewReceiveBindingOptions = {}
): () => void {
    if (!view.handleMessage) {
        return () => { };
    }

    const destination = options.destination || inferViewDestination(String(view.id || ""));
    const componentId = options.componentId || `view:${view.id}`;
    const receiveDestinations = getDestinationAliases(destination);

    const handler = {
        canHandle: (message) => matchesDestination(message.destination, destination),
        handle: async (message) => {
            await deliverUnifiedMessageToView(view, message as UnifiedMessage);
        }
    };

    const pendingSeen = new Set<string>();
    for (const alias of receiveDestinations) {
        const aliasComponentId = `${componentId}:${alias}`;
        registerComponent(aliasComponentId, alias);
        registerHandler(alias, handler as any);

        const pending = initializeComponent(aliasComponentId);
        if (pending.length > 0) {
            for (const message of pending) {
                if (pendingSeen.has(message.id)) continue;
                pendingSeen.add(message.id);
                void handler.handle(message);
            }
        }
    }

    const viewChannelCleanup = subscribeViewChannel(normalizeViewId(destination), (event) => {
        const payload = event.data;
        if (!payload || typeof payload !== "object") return;

        if (payload.type === "view-transfer" && payload.message && typeof payload.message === "object") {
            void deliverUnifiedMessageToView(view, toUnifiedInteropMessage(payload.message as Record<string, unknown>) as UnifiedMessage);
            return;
        }

        if (payload.type === "view-post") {
            const viewId = normalizeViewId(payload.viewId);
            if (viewId !== normalizeViewId(String(view.id || destination))) return;
            void view.handleMessage?.({
                type: "view-post",
                data: {
                    bodyText: String(payload.bodyText || ""),
                    contentType: String(payload.contentType || ""),
                    viewId
                },
                metadata: {
                    source: "view-channel",
                    destination: viewId
                }
            });
        }
    });

    return () => {
        for (const alias of receiveDestinations) {
            unregisterHandler(alias, handler as any);
        }
        viewChannelCleanup();
    };
}

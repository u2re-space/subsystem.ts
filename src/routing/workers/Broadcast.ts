/**
 * BroadcastChannel utilities for cross-context communication
 * Works across: Service Worker, PWA, Web App, Chrome Extension contexts
 */

export type BroadcastMessageHandler<T = unknown> = (data: T) => void;

const channelCache = new Map<string, BroadcastChannel>();

/**
 * Get or create a named BroadcastChannel
 */
export const getChannel = (name: string): BroadcastChannel | null => {
    if (typeof BroadcastChannel === 'undefined') return null;

    if (!channelCache.has(name)) {
        try {
            channelCache.set(name, new BroadcastChannel(name));
        } catch (e) {
            console.warn(`[Broadcast] Failed to create channel '${name}':`, e);
            return null;
        }
    }
    return channelCache.get(name) || null;
};

/**
 * Subscribe to a channel with a message handler
 */
export const affected = <T = unknown>(
    channelName: string,
    handler: BroadcastMessageHandler<T>
): (() => void) => {
    const channel = getChannel(channelName);
    if (!channel) return () => {};

    const listener = (event: MessageEvent<T>) => {
        try {
            handler(event.data);
        } catch (e) {
            console.warn(`[Broadcast] Handler error on '${channelName}':`, e);
        }
    };

    channel.addEventListener('message', listener);
    return () => channel.removeEventListener('message', listener);
};

/**
 * Post a message to a channel
 */
export const postMessage = <T = unknown>(channelName: string, data: T): boolean => {
    const channel = getChannel(channelName);
    if (!channel) return false;

    try {
        channel.postMessage(data);
        return true;
    } catch (e) {
        console.warn(`[Broadcast] Failed to post to '${channelName}':`, e);
        return false;
    }
};

/**
 * Close and cleanup a channel
 */
export const closeChannel = (name: string): void => {
    const channel = channelCache.get(name);
    if (channel) {
        try {
            channel.close();
        } catch (e) { /* ignore */ }
        channelCache.delete(name);
    }
};

/**
 * Close all channels
 */
export const closeAllChannels = (): void => {
    for (const [name] of channelCache) {
        closeChannel(name);
    }
};

// Standard channel names
export const CHANNEL_NAMES = {
    TOAST: 'rs-toast',
    CLIPBOARD: 'rs-clipboard',
    SHARE_TARGET: 'rs-share-target',
    AI_RECOGNITION: 'rs-ai-recognition'
} as const;

// Type definitions for standard messages
export interface ToastMessage {
    type: 'show-toast';
    options: {
        message: string;
        kind?: 'info' | 'success' | 'warning' | 'error';
        duration?: number;
        persistent?: boolean;
    };
}

export interface ClipboardMessage {
    type: 'copy';
    data: unknown;
    options?: {
        showFeedback?: boolean;
    };
}

export interface ShareTargetMessage {
    type: 'share-received';
    data: {
        title?: string;
        text?: string;
        url?: string;
        files?: File[];
        timestamp: number;
    };
}

export interface AIRecognitionMessage {
    type: 'recognize' | 'analyze' | 'result' | 'error';
    data?: unknown;
    error?: string;
}


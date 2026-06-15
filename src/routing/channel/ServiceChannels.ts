/**
 * Service Channels for CrossWord
 * Extends fest/uniform ServiceChannelManager with app-specific configuration
 */

import {
    ServiceChannelManager,
    createServiceChannelManager,
    type ServiceChannelConfig,
    type ChannelMessage,
    type ChannelState
} from 'fest/uniform';

import { BROADCAST_CHANNELS, ROUTE_HASHES, COMPONENTS } from 'com/config/Names';

// Re-export types for consumers
export type { ServiceChannelConfig, ChannelMessage, ChannelState };

// ============================================================================
// CHANNEL TYPES
// ============================================================================

/**
 * Service/view channel identifiers
 */
export type ServiceChannelId = 
    | "workcenter"
    | "settings"
    | "viewer"
    | "explorer"
    | "print"
    | "history"
    | "editor"
    | "home"
    | "airpad";

// ============================================================================
// APP-SPECIFIC CHANNEL CONFIGURATION
// ============================================================================

export const SERVICE_CHANNEL_CONFIG: Record<ServiceChannelId, ServiceChannelConfig> = {
    workcenter: {
        broadcastName: BROADCAST_CHANNELS.WORK_CENTER,
        routeHash: ROUTE_HASHES.WORKCENTER,
        component: COMPONENTS.WORK_CENTER,
        description: "AI work center for processing files and content"
    },
    settings: {
        broadcastName: BROADCAST_CHANNELS.SETTINGS,
        routeHash: ROUTE_HASHES.SETTINGS,
        component: COMPONENTS.SETTINGS,
        description: "Application settings and configuration"
    },
    airpad: {
        broadcastName: BROADCAST_CHANNELS.SERVICE_AIRPAD,
        routeHash: ROUTE_HASHES.AIRPAD,
        component: COMPONENTS.AIRPAD,
        description: "AirPad remote trackpad/keyboard + clipboard"
    },
    viewer: {
        broadcastName: BROADCAST_CHANNELS.MARKDOWN_VIEWER,
        routeHash: ROUTE_HASHES.MARKDOWN_VIEWER,
        component: COMPONENTS.MARKDOWN_VIEWER,
        description: "Content viewer for markdown and files"
    },
    explorer: {
        broadcastName: BROADCAST_CHANNELS.FILE_EXPLORER,
        routeHash: ROUTE_HASHES.FILE_EXPLORER,
        component: COMPONENTS.FILE_EXPLORER,
        description: "File explorer and browser"
    },
    print: {
        broadcastName: BROADCAST_CHANNELS.PRINT_CHANNEL,
        routeHash: ROUTE_HASHES.PRINT,
        component: COMPONENTS.BASIC_PRINT,
        description: "Print preview and export"
    },
    history: {
        broadcastName: BROADCAST_CHANNELS.HISTORY_CHANNEL,
        routeHash: ROUTE_HASHES.HISTORY,
        component: COMPONENTS.HISTORY,
        description: "Action history and undo/redo"
    },
    editor: {
        broadcastName: "rs-editor",
        routeHash: ROUTE_HASHES.MARKDOWN_EDITOR,
        component: COMPONENTS.MARKDOWN_EDITOR,
        description: "Content editor"
    },
    home: {
        broadcastName: "rs-home",
        routeHash: "#home",
        component: "home",
        description: "Home/landing view"
    }
};

// ============================================================================
// APP-SPECIFIC SERVICE CHANNEL MANAGER
// ============================================================================

let appServiceChannelManager: ServiceChannelManager<ServiceChannelId> | null = null;

/**
 * Get the app-configured ServiceChannelManager
 */
export function getServiceChannels(): ServiceChannelManager<ServiceChannelId> {
    if (!appServiceChannelManager) {
        appServiceChannelManager = createServiceChannelManager<ServiceChannelId>({
            channels: SERVICE_CHANNEL_CONFIG,
            logPrefix: '[ServiceChannels]'
        });
    }
    return appServiceChannelManager;
}

// Singleton instance for backward compatibility
export const serviceChannels = getServiceChannels();

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * Initialize a service channel
 */
export const initServiceChannel = (channelId: ServiceChannelId) => 
    serviceChannels.initChannel(channelId);

/**
 * Send a message to a channel
 */
export const sendToChannel = <T>(target: ServiceChannelId, type: string, data: T) =>
    serviceChannels.send(target, type, data);

/**
 * Subscribe to channel messages
 */
export const affectedToChannel = (
    channelId: ServiceChannelId,
    handler: (msg: ChannelMessage) => void
) => serviceChannels.affected(channelId, handler);

/**
 * Broadcast to all channels
 */
export const broadcastToAll = <T>(type: string, data: T) =>
    serviceChannels.broadcast(type, data);

// Re-export the ServiceChannelManager class for advanced usage
export { ServiceChannelManager };

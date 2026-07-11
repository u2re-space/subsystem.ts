/**
 * Centralized naming system for CrossWord application
 * Consolidates component names, channel names, route names, etc.
 */

// ============================================================================
// BROADCAST CHANNELS
// ============================================================================

/**
 * Broadcast channel names used throughout the application
 */
export const BROADCAST_CHANNELS = {
    // Service Worker Channels (matching SW implementation)
    SHARE_TARGET: 'rs-share-target',
    TOAST: 'rs-toast',
    CLIPBOARD: 'rs-clipboard',

    // App Component Channels (for AppCommunicator)
    WORK_CENTER: 'rs-workcenter',
    MARKDOWN_VIEWER: 'rs-markdown-viewer',
    SETTINGS: 'rs-settings',
    GENERAL: 'rs-app-general',

    // Unified Messaging Channels
    MINIMAL_APP: 'minimal-app',
    MAIN_APP: 'main-app',
    FILE_EXPLORER: 'file-explorer',
    PRINT_VIEWER: 'print-viewer',
    SETTINGS_VIEWER: 'settings-viewer',
    HISTORY_VIEWER: 'history-viewer',

    // Additional channels used in routing
    MARKDOWN_VIEWER_CHANNEL: 'markdown-viewer',
    FILE_EXPLORER_CHANNEL: 'file-explorer',
    SETTINGS_CHANNEL: 'settings',
    HISTORY_CHANNEL: 'history',
    PRINT_CHANNEL: 'print',

    // Service Channels (new architecture)
    SERVICE_WORKCENTER: 'rs-service-workcenter',
    SERVICE_SETTINGS: 'rs-service-settings',
    SERVICE_VIEWER: 'rs-service-viewer',
    SERVICE_EXPLORER: 'rs-service-explorer',
    SERVICE_AIRPAD: 'rs-service-airpad',
    SERVICE_NETWORK: 'rs-service-network',
    SERVICE_PRINT: 'rs-service-print',
    SERVICE_HISTORY: 'rs-service-history',
    SERVICE_EDITOR: 'rs-service-editor',
    SERVICE_HOME: 'rs-service-home'
} as const;

/** Same-origin view POST API + per-view BroadcastChannel (`rs-view-<id>`). */
export const VIEW_POST_API_SEGMENTS = [
    'viewer',
    'workcenter',
    'settings',
    'explorer',
    'history',
    'editor',
    'airpad',
    'print',
    'home'
] as const;

export type ViewPostApiSegment = (typeof VIEW_POST_API_SEGMENTS)[number];

export const isViewPostApiPath = (pathname: string): ViewPostApiSegment | null => {
    const seg = String(pathname || '')
        .split('?')[0]!
        .replace(/^\/+|\/+$/g, '')
        .split('/')[0]!
        .toLowerCase();
    return (VIEW_POST_API_SEGMENTS as readonly string[]).includes(seg) ? (seg as ViewPostApiSegment) : null;
};

export const viewBroadcastChannelName = (viewId: string): string => {
    const id = normalizeViewId(viewId);
    return `rs-view-${id || 'app'}`;
};

// ============================================================================
// COMPONENT/MODULE NAMES
// ============================================================================

/**
 * Component and module identifiers
 */
export const COMPONENTS = {
    // Core Components
    WORK_CENTER: 'workcenter',
    MARKDOWN_VIEWER: 'markdown-viewer',
    MARKDOWN_EDITOR: 'markdown-editor',
    RICH_EDITOR: 'rich-editor',
    SETTINGS: 'settings',
    HISTORY: 'history',
    FILE_PICKER: 'file-picker',
    FILE_EXPLORER: 'file-explorer',

    // Sub-components
    WORKCENTER_CORE: 'workcenter-core',
    BASIC_WORKCENTER: 'basic-workcenter',
    BASIC_VIEWER: 'basic-viewer',
    BASIC_EXPLORER: 'basic-explorer',
    BASIC_SETTINGS: 'basic-settings',
    BASIC_HISTORY: 'basic-history',
    BASIC_PRINT: 'basic-print',

    // New architecture views
    AIRPAD: 'airpad',
    NETWORK: 'network',
    HOME: 'home',
    EDITOR: 'editor',
    VIEWER: 'viewer',
    EXPLORER: 'explorer',
    PRINT: 'print'
} as const;

// ============================================================================
// SHELL IDENTIFIERS
// ============================================================================

/**
 * Shell identifiers for boot/layout selection
 */
export const SHELLS = {
    BASIC: 'basic',
    FAINT: 'faint',
    RAW: 'raw'
} as const;

/**
 * Style system identifiers
 */
export const STYLE_SYSTEMS = {
    VEELA: 'veela',
    BASIC: 'basic',
    RAW: 'raw'
} as const;

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * API endpoint paths
 */
export const API_ENDPOINTS = {
    // Processing APIs
    PROCESSING: '/api/processing',
    ANALYZE: '/api/analyze',
    TEST: '/api/test',
    HEALTH: '/health',

    // Asset proxies
    ICONS: '/assets/icons',
    DUOTONE_ICONS: '/assets/icons/duotone',
    PHOSPHOR_ICONS: '/assets/icons/phosphor',
    ICON_PROXY: '/api/icon-proxy',

    // Content APIs
    SHARE_TARGET: '/share-target',
    SHARE_TARGET_ALT: '/share_target',
    LAUNCH_QUEUE: '/launch-queue',

    // Internal SW APIs
    SW_CONTENT: '/sw-content',
    SW_CONTENT_AVAILABLE: '/sw-content/available',
    CLIPBOARD_PENDING: '/clipboard/pending',
    CLIPBOARD_CLEAR: '/clipboard/clear'
} as const;

// ============================================================================
// ROUTE/HASH IDENTIFIERS
// ============================================================================

/**
 * Location hash identifiers for app navigation
 */
export const ROUTE_HASHES = {
    // Basic app views
    MARKDOWN_VIEWER: '#markdown-viewer',
    MARKDOWN_EDITOR: '#markdown-editor',
    RICH_EDITOR: '#rich-editor',
    SETTINGS: '#settings',
    HISTORY: '#history',
    WORKCENTER: '#workcenter',
    FILE_PICKER: '#file-picker',
    FILE_EXPLORER: '#file-explorer',
    PRINT: '#print',
    AIRPAD: '#airpad',
    NETWORK: '#network',

    // Work center specific hashes
    WORKCENTER_FILES: '#workcenter-files',
    WORKCENTER_TEXT: '#workcenter-text',
    WORKCENTER_IMAGES: '#workcenter-images',
    WORKCENTER_PROCESSING: '#workcenter-processing',

    // Share target specific hashes
    SHARE_TARGET_TEXT: '#share-target-text',
    SHARE_TARGET_FILES: '#share-target-files',
    SHARE_TARGET_URL: '#share-target-url',
    SHARE_TARGET_IMAGE: '#share-target-image'
} as const;

// ============================================================================
// DATABASE/STORAGE KEYS
// ============================================================================

/**
 * IndexedDB and LocalStorage key names
 */
export const STORAGE_KEYS = {
    // Service Worker
    SW_CACHE_KEYS: 'sw-cache-keys',
    SW_CONTENT_CACHE: 'sw-content-cache',
    SHARE_TARGET_DATA: 'share-target-data',
    SHARE_TARGET_FILES: 'share-target-files',
    CLIPBOARD_OPERATIONS: 'clipboard-operations',

    // Frontend
    WORKCENTER_STATE: 'rs-workcenter-state',
    WORKCENTER_TEMPLATES: 'rs-workcenter-templates',
    SETTINGS: 'rs-settings',
    HISTORY: 'rs-history',

    // Theme and UI
    THEME_PREFERENCES: 'theme-preferences',
    UI_STATE: 'ui-state'
} as const;

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Message types used in broadcast channels and unified messaging
 */
export const MESSAGE_TYPES = {
    // Service Worker Messages
    SHARE_RECEIVED: 'share-received',
    SHARE_RESULT: 'share-result',
    AI_RESULT: 'ai-result',
    CONTENT_CACHED: 'content-cached',
    CONTENT_RECEIVED: 'content-received',

    // Clipboard Messages
    COPY: 'copy',
    CLIPBOARD_READY: 'clipboard-ready',

    // Work Center Messages
    SHARE_TARGET_INPUT: 'share-target-input',
    SHARE_TARGET_RESULT: 'share-target-result',
    FILES_CHANGED: 'files-changed',

    // Toast Messages
    SHOW_TOAST: 'show-toast',

    // Ping/Pong
    PING: 'ping',
    PONG: 'pong',

    // Content Sharing
    CONTENT_SHARE: 'content-share',
    CONTENT_REQUEST: 'content-request'
} as const;

// ============================================================================
// CONTENT TYPES AND CONTEXTS
// ============================================================================

/**
 * Content type identifiers
 */
export const CONTENT_TYPES = {
    TEXT: 'text',
    URL: 'url',
    FILE: 'file',
    IMAGE: 'image',
    MARKDOWN: 'markdown',
    HTML: 'html',
    JSON: 'json',
    PDF: 'pdf',
    AUDIO: 'audio',
    VIDEO: 'video',
    OTHER: 'other'
} as const;

/**
 * Content context identifiers
 */
export const CONTENT_CONTEXTS = {
    SHARE_TARGET: 'share-target',
    LAUNCH_QUEUE: 'launch-queue',
    PUSH_MESSAGE: 'push-message',
    BACKGROUND_SYNC: 'background-sync',
    CLIPBOARD: 'clipboard',
    DRAG_DROP: 'drag-drop',
    PASTE: 'paste'
} as const;

// ============================================================================
// DESTINATION NAMES
// ============================================================================

/**
 * Destination identifiers for unified messaging
 */
export const DESTINATIONS = {
    WORKCENTER: 'workcenter',
    CLIPBOARD: 'clipboard',
    VIEWER: 'viewer',
    MARKDOWN_VIEWER: 'markdown-viewer',
    SETTINGS: 'settings',
    HISTORY: 'history',
    EXPLORER: 'explorer',
    FILE_EXPLORER: 'file-explorer',
    PRINT: 'print',
    PRINT_VIEWER: 'print-viewer',
    EDITOR: 'editor',
    AIRPAD: 'airpad',
    HOME: 'home',
    BASIC_APP: 'basic-app',
    MAIN_APP: 'main-app'
} as const;

export const CANONICAL_VIEW_IDS = [
    'viewer',
    'workcenter',
    'explorer',
    'editor',
    'settings',
    'history',
    'home',
    'airpad',
    'print'
] as const;

export type CanonicalViewId = (typeof CANONICAL_VIEW_IDS)[number];

/**
 * COMPAT: legacy shells still emit `markdown-viewer`, `file-explorer`, and
 * `basic-*` destinations. Keep alias resolution centralized here so transports,
 * views, and workers can agree on one canonical target vocabulary.
 */
export const DESTINATION_ALIASES: Record<string, readonly string[]> = {
    viewer: [DESTINATIONS.VIEWER, DESTINATIONS.MARKDOWN_VIEWER, COMPONENTS.BASIC_VIEWER],
    workcenter: [DESTINATIONS.WORKCENTER, COMPONENTS.BASIC_WORKCENTER, COMPONENTS.WORKCENTER_CORE],
    explorer: [DESTINATIONS.EXPLORER, DESTINATIONS.FILE_EXPLORER, COMPONENTS.BASIC_EXPLORER],
    editor: [DESTINATIONS.EDITOR, COMPONENTS.MARKDOWN_EDITOR, COMPONENTS.RICH_EDITOR],
    settings: [DESTINATIONS.SETTINGS, BROADCAST_CHANNELS.SETTINGS_CHANNEL, COMPONENTS.BASIC_SETTINGS],
    history: [DESTINATIONS.HISTORY, BROADCAST_CHANNELS.HISTORY_CHANNEL, COMPONENTS.BASIC_HISTORY],
    print: [DESTINATIONS.PRINT, DESTINATIONS.PRINT_VIEWER, COMPONENTS.BASIC_PRINT],
    airpad: [DESTINATIONS.AIRPAD],
    home: [DESTINATIONS.HOME],
    clipboard: [DESTINATIONS.CLIPBOARD],
    "basic-app": [DESTINATIONS.BASIC_APP],
    "main-app": [DESTINATIONS.MAIN_APP]
} as const;

const DESTINATION_LOOKUP = Object.entries(DESTINATION_ALIASES).reduce<Record<string, string>>((out, [canonical, aliases]) => {
    out[canonical] = canonical;
    for (const alias of aliases) {
        out[String(alias).toLowerCase()] = canonical;
    }
    return out;
}, {});

export const normalizeDestination = (value: string | null | undefined): string => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return DESTINATION_LOOKUP[raw] || raw;
};

export const getDestinationAliases = (value: string | null | undefined): string[] => {
    const canonical = normalizeDestination(value);
    if (!canonical) return [];
    return [...new Set([canonical, ...(DESTINATION_ALIASES[canonical] || [])])];
};

export const matchesDestination = (candidate: string | null | undefined, expected: string | null | undefined): boolean =>
    Boolean(normalizeDestination(candidate) && normalizeDestination(candidate) === normalizeDestination(expected));

export const normalizeViewId = (value: string | null | undefined): CanonicalViewId => {
    const canonical = normalizeDestination(value);
    if ((CANONICAL_VIEW_IDS as readonly string[]).includes(canonical)) {
        return canonical as CanonicalViewId;
    }
    return 'viewer';
};

export const getBroadcastChannelForDestination = (value: string | null | undefined): string | null => {
    switch (normalizeDestination(value)) {
        case 'viewer':
            return BROADCAST_CHANNELS.MARKDOWN_VIEWER;
        case 'workcenter':
            return BROADCAST_CHANNELS.WORK_CENTER;
        case 'explorer':
            return BROADCAST_CHANNELS.FILE_EXPLORER;
        case 'settings':
            return BROADCAST_CHANNELS.SETTINGS;
        case 'history':
            return BROADCAST_CHANNELS.HISTORY_VIEWER;
        case 'print':
            return BROADCAST_CHANNELS.PRINT_VIEWER;
        case 'clipboard':
            return BROADCAST_CHANNELS.CLIPBOARD;
        case 'main-app':
            return BROADCAST_CHANNELS.MAIN_APP;
        case 'basic-app':
            return BROADCAST_CHANNELS.MINIMAL_APP;
        default:
            return null;
    }
};

export const createDestinationChannelMappings = (): Record<string, string> => {
    const mappings: Record<string, string> = {};
    for (const canonical of Object.keys(DESTINATION_ALIASES)) {
        const channel = getBroadcastChannelForDestination(canonical);
        if (!channel) continue;
        for (const alias of getDestinationAliases(canonical)) {
            mappings[alias] = channel;
        }
    }
    return mappings;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get broadcast channel name by component
 */
export function getChannelForComponent(component: string): string {
    return getBroadcastChannelForDestination(component)
        || getBroadcastChannelForDestination(normalizeDestination(component))
        || BROADCAST_CHANNELS.GENERAL;
}

/**
 * Get route hash for component
 */
export function getHashForComponent(component: string): string {
    const hashMap: Record<string, string> = {
        [COMPONENTS.WORK_CENTER]: ROUTE_HASHES.WORKCENTER,
        [COMPONENTS.MARKDOWN_VIEWER]: ROUTE_HASHES.MARKDOWN_VIEWER,
        [COMPONENTS.MARKDOWN_EDITOR]: ROUTE_HASHES.MARKDOWN_EDITOR,
        [COMPONENTS.RICH_EDITOR]: ROUTE_HASHES.RICH_EDITOR,
        [COMPONENTS.SETTINGS]: ROUTE_HASHES.SETTINGS,
        [COMPONENTS.HISTORY]: ROUTE_HASHES.HISTORY,
        [COMPONENTS.FILE_PICKER]: ROUTE_HASHES.FILE_PICKER,
        [COMPONENTS.FILE_EXPLORER]: ROUTE_HASHES.FILE_EXPLORER
    };

    return hashMap[component] || '#';
}

/**
 * Get storage key for component data
 */
export function getStorageKeyForComponent(component: string, dataType: string): string {
    const keyMap: Record<string, Record<string, string>> = {
        [COMPONENTS.WORK_CENTER]: {
            state: STORAGE_KEYS.WORKCENTER_STATE,
            templates: STORAGE_KEYS.WORKCENTER_TEMPLATES
        },
        [COMPONENTS.SETTINGS]: {
            data: STORAGE_KEYS.SETTINGS
        },
        [COMPONENTS.HISTORY]: {
            data: STORAGE_KEYS.HISTORY
        }
    };

    return keyMap[component]?.[dataType] || `${component}-${dataType}`;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type BroadcastChannelName = typeof BROADCAST_CHANNELS[keyof typeof BROADCAST_CHANNELS];
export type ComponentName = typeof COMPONENTS[keyof typeof COMPONENTS];
export type RouteHash = typeof ROUTE_HASHES[keyof typeof ROUTE_HASHES];
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];
export type ContentType = typeof CONTENT_TYPES[keyof typeof CONTENT_TYPES];
export type ContentContext = typeof CONTENT_CONTEXTS[keyof typeof CONTENT_CONTEXTS];
export type Destination = typeof DESTINATIONS[keyof typeof DESTINATIONS];
export type ShellName = typeof SHELLS[keyof typeof SHELLS];
export type StyleSystemName = typeof STYLE_SYSTEMS[keyof typeof STYLE_SYSTEMS];
export type ApiEndpoint = typeof API_ENDPOINTS[keyof typeof API_ENDPOINTS];

// ============================================================================
// SERVICE CHANNEL MAPPING
// ============================================================================

/**
 * Map service channel IDs to broadcast channel names
 */
export const SERVICE_CHANNEL_MAP: Record<string, string> = {
    workcenter: BROADCAST_CHANNELS.SERVICE_WORKCENTER,
    settings: BROADCAST_CHANNELS.SERVICE_SETTINGS,
    viewer: BROADCAST_CHANNELS.SERVICE_VIEWER,
    explorer: BROADCAST_CHANNELS.SERVICE_EXPLORER,
    airpad: BROADCAST_CHANNELS.SERVICE_AIRPAD,
    network: BROADCAST_CHANNELS.SERVICE_NETWORK,
    print: BROADCAST_CHANNELS.SERVICE_PRINT,
    history: BROADCAST_CHANNELS.SERVICE_HISTORY,
    editor: BROADCAST_CHANNELS.SERVICE_EDITOR,
    home: BROADCAST_CHANNELS.SERVICE_HOME
} as const;

/**
 * Map view IDs to route hashes
 */
export const VIEW_ROUTE_MAP: Record<string, string> = {
    workcenter: ROUTE_HASHES.WORKCENTER,
    settings: ROUTE_HASHES.SETTINGS,
    viewer: ROUTE_HASHES.MARKDOWN_VIEWER,
    explorer: ROUTE_HASHES.FILE_EXPLORER,
    airpad: '#airpad',
    network: ROUTE_HASHES.NETWORK,
    print: ROUTE_HASHES.PRINT,
    history: ROUTE_HASHES.HISTORY,
    editor: ROUTE_HASHES.MARKDOWN_EDITOR,
    home: '#home'
} as const;

export const getRouteForView = (viewId: string | null | undefined): string =>
    VIEW_ROUTE_MAP[normalizeViewId(viewId)] || ROUTE_HASHES.MARKDOWN_VIEWER;
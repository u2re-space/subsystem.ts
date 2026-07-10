export type FieldType = "text" | "password" | "select" | "color-palette" | "shape-palette" | "number-select" | "textarea";

export type FieldOption = {
    value: string;
    label: string;
    color?: string;
    shape?: string;
};

export type FieldConfig = {
    path: string;
    label: string;
    type: FieldType;
    placeholder?: string;
    helper?: string;
    options?: FieldOption[];
};

export type GroupConfig = {
    key?: string;
    label: string;
    description?: string;
    collapsible?: boolean;
    startOpen?: boolean;
    fields: FieldConfig[];
};

export type SectionKey = "runtime" | "core" | "app" | "ai" | "mcp" | "webdav" | "timeline" | "additional";

export type SectionConfig = {
    key: SectionKey;
    title: string;
    icon: string;
    description: string;
    groups: GroupConfig[];
};

export type CoreMode = "native" | "endpoint";
export type CoreSocketProtocol = "auto" | "http" | "https";
export type CoreSocketTransportMode = "plaintext" | "secure";

export type RemoteTarget = {
    id: string;
    label?: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    unencrypted?: boolean;
};

export type MCPConfig = {
    id: string;
    serverLabel: string;
    origin: string;
    clientKey: string;
    secretKey: string;
};

export type GridShape =
    | "square" | "squircle" | "circle" | "rounded" | "blob"     // Border-radius based
    | "hexagon" | "diamond" | "star" | "badge" | "heart"        // Clip-path polygonal
    | "clover" | "flower"                                        // Clip-path decorative
    | "egg" | "tear" | "wavy";                                           // Asymmetric / procedural

export type CustomInstruction = {
    id: string;
    label: string;
    instruction: string;
    enabled?: boolean;
    order?: number;
};

export type ResponseLanguage = "en" | "ru" | "auto" | "follow";
export type SpeechRecognitionLanguage = "ru" | "en" | "en-GB" | "en-US";
export type ReasoningEffort = "none" | "low" | "medium" | "high";
export type ResponseVerbosity = "low" | "medium" | "high";
export type ContextTruncation = "disabled" | "auto";
export type PromptCacheRetention = "in-memory" | "24h";
export type MarkdownStylePreset = "default" | "classic" | "compact" | "paper";
export type MarkdownFontFamilyPreset = "system" | "sans" | "serif" | "mono";
export type MarkdownPageSize = "auto" | "A4" | "Letter" | "Legal" | "A5";
export type MarkdownPageOrientation = "portrait" | "landscape";
export type MarkdownExtensionRule = {
    id?: string;
    pattern: string;
    replacement: string;
    flags?: string;
    enabled?: boolean;
};
export type MarkdownStyleModules = {
    typography?: boolean;
    /** Lists (ul/ol): spacing, markers, nesting */
    lists?: boolean;
    tables?: boolean;
    codeBlocks?: boolean;
    blockquotes?: boolean;
    media?: boolean;
    printBreaks?: boolean;
};
export type MarkdownStylePlugins = {
    smartTypography?: boolean;
    softBreaksAsBr?: boolean;
    externalLinksNewTab?: boolean;
};

export const BUILTIN_AI_MODELS = [
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.3",
    "gpt-5.4",
    "gpt-5.2-chat-latest",
    "gpt-5.3-chat-latest",
    "gpt-5.4-chat-latest",
    "gpt-5.3-instant"
] as const;

const defaultSpeechLanguage = (): SpeechRecognitionLanguage => {
    const fallback: SpeechRecognitionLanguage = "en-US";
    if (typeof navigator === "undefined") return fallback;
    const normalized = (navigator.language || "").trim();
    if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
    if (normalized === "en-GB") return "en-GB";
    if (normalized === "en-US") return "en-US";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    return fallback;
};

/** Capacitor / embedded WebView shell — mirrors CWSAndroid-style toggles and AirPad transport defaults. Native IPC: {@code shared/native/cws-bridge.ts} + {@code CwsBridge} plugin. */
export type ShellSettings = {
    /**
     * Prefer the native Kotlin websocket runtime on CWSAndroid.
     * When enabled, web WebSocket background maintenance should stay off.
     */
    preferNativeWebsocket?: boolean;
    /**
     * When true, CrossWord keeps a **WebSocket** connection to the hub (cwsp / endpoint) in the background,
     * not only when the AirPad view is open — enables clipboard coordinator and realtime ops from any shell (PWA, CRX, Capacitor).
     * Connection uses {@link AppSettings.core.endpointUrl}.
     * Default **off**: connect on demand from AirPad/UI or coordinator asks; toggle on here for persistent hub.
     */
    maintainHubSocketConnection?: boolean;
    /** Coordinator / remote clipboard bridge (PC clipboard from server). */
    enableRemoteClipboardBridge?: boolean;
    /**
     * When true (default), incoming `clipboard:update` / coordinator packets are written to the device clipboard
     * (Web `navigator.clipboard` or Capacitor `@capacitor/clipboard` on cwsp Android).
     */
    applyRemoteClipboardToDevice?: boolean;
    /**
     * Periodically read the local clipboard and broadcast to configured peers.
     * Use sparingly; pairs with server `clients.json` / `modules.clipboard` share/accept rules.
     */
    pushLocalClipboardToLan?: boolean;
    /** Polling interval for {@link pushLocalClipboardToLan} (ms). */
    clipboardPushIntervalMs?: number;
    /**
     * Comma/semicolon list of peer ids for outbound clipboard fan-out (optional; supports `ID::AccessToken`).
     * When empty, routing falls back to the AirPad route target and other defaults from runtime config.
     */
    clipboardBroadcastTargets?: string;
    /** Reserved for native SMS bridge (Kotlin shell); persisted for parity with CWSAndroid. */
    enableNativeSms?: boolean;
    /** Reserved for native contacts bridge; persisted for parity with CWSAndroid. */
    enableNativeContacts?: boolean;
    /**
     * When false, inbound coordinator / `clipboard:update` payloads are ignored (connection may stay up for other ops).
     */
    acceptInboundClipboardData?: boolean;
    /**
     * Comma/semicolon-separated peer ids that may send clipboard to this client. Empty = any sender (unless restricted elsewhere).
     */
    clipboardInboundAllowIds?: string;
    /**
     * Optional destinations for outbound clipboard from share-target / quick-send flows. When empty, uses
     * {@link clipboardBroadcastTargets} and route defaults.
     */
    clipboardShareDestinationIds?: string;
    /**
     * When true and {@link AppSettings.core.socket.accessToken} is set, inbound clipboard is accepted from any sender
     * (endpoint control token bypasses the inbound allow list on the client).
     */
    accessTokenBypassesClipboardAllowlist?: boolean;
    /** When true, allow contacts-related payloads from native/coordinator bridges (future). */
    acceptContactsBridgeData?: boolean;
    /** When true, allow SMS-related payloads from native/coordinator bridges (future). */
    acceptSmsBridgeData?: boolean;
    /** Start Java CWSP runtime after device boot (maps to `cwsp.autoStartOnBoot`). */
    autoStartOnBoot?: boolean;
    /** Keep foreground service / daemon for clipboard + share (maps to `cwsp.bridgeDaemonEnabled`). */
    bridgeDaemonEnabled?: boolean;
};

export type AppSettings = {
    core?: {
        mode?: CoreMode;
        endpointUrl?: string;
        /**
         * Associated client / device id for cwsp, endpoint, and (optionally) AirPad — env: CWS_ASSOCIATED_ID.
         */
        userId?: string;
        /**
         * Shared ecosystem token (identification + control).
         * WHY: UI exposes one field; mirrored onto {@link userKey} and {@link socket.accessToken} for wire/compat.
         * Env: CWS_ASSOCIATED_TOKEN / CWS_CLIENT_TOKEN.
         */
        ecosystemToken?: string;
        /**
         * Associated client token used to identify this device to the endpoint.
         * COMPAT: kept in sync with {@link ecosystemToken}. Env: CWS_ASSOCIATED_TOKEN.
         */
        userKey?: string;
        encrypt?: boolean;
        preferBackendSync?: boolean;
        ntpEnabled?: boolean;
        /** Instance id for cwsp / offline / multi-device (distinct from Airpad peer clientId). */
        appClientId?: string;
        /**
         * When true and AirPad’s own client-id field is empty, reuse {@link userId}.
         * NOTE: Auth uses {@link ecosystemToken} (mirrored to userKey + accessToken).
         */
        useCoreIdentityForAirPad?: boolean;
        /**
         * Hint for Electron/Capacitor/cwsp: allow self-signed TLS to the endpoint.
         * WebView `fetch` still follows platform certificate rules unless the shell applies this.
         */
        allowInsecureTls?: boolean;
        network?: {
            listenPortHttps?: number;
            listenPortHttp?: number;
            bridgeEnabled?: boolean;
            reconnectMs?: number;
            destinations?: string[];
        };
        socket?: {
            protocol?: CoreSocketProtocol;
            /** Optional default AirPad peer / route id (`L-…`). Empty is valid (hub, receive-only, or policy via allow lists + tokens). */
            routeTarget?: string;
            /** Optional AirPad self/client id override; when empty AirPad reuses `core.userId`. */
            selfId?: string;
            /**
             * Access / control token on the wire.
             * COMPAT: kept in sync with {@link ecosystemToken} (same shared ecosystem key).
             */
            accessToken?: string;
            /**
             * @deprecated Use {@link accessToken}. Still loaded when migrating stored settings.
             */
            airpadAuthToken?: string;
            /**
             * Optional token for future reverse-client / “frontend is server” flows (e.g. WS ACL when this peer accepts inbound control).
             * Distinct from {@link userKey} and {@link accessToken}.
             */
            clientAccessToken?: string;
            /**
             * When true, {@link userKey} is not required for endpoint-mode HTTP/AI calls if {@link accessToken}
             * is set (verified as endpoint control token on the server). WebSocket already omits identity tokens when empty.
             */
            allowAccessTokenWithoutUserKey?: boolean;
            transportMode?: CoreSocketTransportMode;
            transportSecret?: string;
            signingSecret?: string;
            /**
             * WebSocket / Engine.IO handshake `connectionType` (before gateway normalization to `first-order` when applicable).
             * @see runtime/cwsp/endpoint/SPECIFICATION-v2.md
             */
            connectionType?: string;
            /** Handshake `archetype` (e.g. `server-v2`). */
            archetype?: string;
            /**
             * Optional JSON object mirroring endpoint config-v2 `Protocols` (lane → roles). Reserved for future wire hints / tooling.
             */
            protocolLanesJson?: string;
        };
        interop?: {
            ipcProtocol?: "uniform" | "legacy";
            platformInterop?: boolean;
            preferNativeIpc?: boolean;
            preferNativeWebsocket?: boolean;
        };
        /** HTTPS :8434 and HTTP :8080 admin/control entry points for the CWS server. */
        admin?: {
            httpsOrigin?: string;
            httpOrigin?: string;
            path?: string;
        };
        ops?: {
            allowUnencrypted?: boolean;
            /** Direct peer HTTPS origin/host (Capacitor / AirPad routed mode). */
            directUrl?: string;
            httpTargets?: RemoteTarget[];
            wsTargets?: RemoteTarget[];
            syncTargets?: RemoteTarget[];
        };
    };
    shell?: ShellSettings;
    ai?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        customModel?: string;
        defaultReasoningEffort?: ReasoningEffort;
        defaultVerbosity?: ResponseVerbosity;
        maxOutputTokens?: number;
        contextTruncation?: ContextTruncation;
        promptCacheRetention?: PromptCacheRetention;
        maxToolCalls?: number;
        parallelToolCalls?: boolean;
        mcp?: MCPConfig[];
        shareTargetMode?: "analyze" | "recognize";
        /** When true (default), share-target / launch-queue will auto run AI and copy result to clipboard. */
        autoProcessShared?: boolean;
        customInstructions?: CustomInstruction[];
        activeInstructionId?: string;
        // Language and translation settings
        responseLanguage?: ResponseLanguage;
        translateResults?: boolean;
        // Graphics generation settings
        generateSvgGraphics?: boolean;
        // Request timeout settings (in seconds)
        requestTimeout?: {
            low?: number;    // Default: 60
            medium?: number; // Default: 300
            high?: number;   // Default: 900
        };
        maxRetries?: number; // Default: 2
    };
    webdav?: {
        url?: string;
        username?: string;
        password?: string;
        token?: string;
    };
    timeline?: {
        source?: string;
    };
    appearance?: {
        theme?: "light" | "dark" | "auto";
        fontSize?: "small" | "medium" | "large";
        color?: string;
        markdown?: {
            customCss?: string;
            printCss?: string;
            extensions?: MarkdownExtensionRule[];
            preset?: MarkdownStylePreset;
            fontFamily?: MarkdownFontFamilyPreset;
            fontSizePx?: number;
            lineHeight?: number;
            contentMaxWidthPx?: number;
            printScale?: number;
            page?: {
                size?: MarkdownPageSize;
                orientation?: MarkdownPageOrientation;
                marginMm?: number;
            };
            modules?: MarkdownStyleModules;
            plugins?: MarkdownStylePlugins;
        };
    };
    speech?: {
        language?: SpeechRecognitionLanguage;
    };
    grid?: {
        columns?: number;
        rows?: number;
        shape?: GridShape;
    };
};

export const DEFAULT_SETTINGS: AppSettings = {
    core: {
        mode: "native",
        endpointUrl: "http://localhost:6065",
        userId: "",
        ecosystemToken: "",
        userKey: "",
        encrypt: false,
        preferBackendSync: true,
        ntpEnabled: false,
        appClientId: "",
        useCoreIdentityForAirPad: true,
        allowInsecureTls: false,
        network: {
            listenPortHttps: 8434,
            listenPortHttp: 8080,
            bridgeEnabled: true,
            reconnectMs: 3000,
            destinations: []
        },
        socket: {
            protocol: "auto",
            routeTarget: "",
            selfId: "",
            accessToken: "",
            clientAccessToken: "",
            allowAccessTokenWithoutUserKey: false,
            transportMode: "plaintext",
            transportSecret: "",
            signingSecret: "",
            connectionType: "",
            archetype: "",
            protocolLanesJson: ""
        },
        interop: {
            ipcProtocol: "uniform",
            platformInterop: true,
            preferNativeIpc: true,
            preferNativeWebsocket: true
        },
        admin: {
            httpsOrigin: "https://localhost:8434",
            httpOrigin: "http://localhost:8080",
            path: "/"
        },
        ops: {
            allowUnencrypted: false,
            directUrl: "",
            httpTargets: [],
            wsTargets: [],
            syncTargets: []
        }
    },
    shell: {
        preferNativeWebsocket: true,
        maintainHubSocketConnection: false,
        enableRemoteClipboardBridge: true,
        applyRemoteClipboardToDevice: true,
        pushLocalClipboardToLan: false,
        clipboardPushIntervalMs: 2000,
        clipboardBroadcastTargets: "",
        enableNativeSms: true,
        enableNativeContacts: true,
        acceptInboundClipboardData: true,
        clipboardInboundAllowIds: "",
        clipboardShareDestinationIds: "",
        accessTokenBypassesClipboardAllowlist: false,
        acceptContactsBridgeData: false,
        acceptSmsBridgeData: false,
        autoStartOnBoot: true,
        bridgeDaemonEnabled: true
    },
    ai: {
        apiKey: "",
        baseUrl: "",
        model: "gpt-5.2",
        customModel: "",
        defaultReasoningEffort: "medium",
        defaultVerbosity: "medium",
        maxOutputTokens: 400000,
        contextTruncation: "disabled",
        promptCacheRetention: "in-memory",
        maxToolCalls: 8,
        parallelToolCalls: true,
        mcp: [],
        shareTargetMode: "recognize",
        autoProcessShared: true,
        customInstructions: [],
        activeInstructionId: "",
        responseLanguage: "auto",
        translateResults: false,
        generateSvgGraphics: false,
        requestTimeout: {
            low: 60,      // 1 minute
            medium: 300,  // 5 minutes
            high: 900     // 15 minutes
        },
        maxRetries: 2
    },
    webdav: {
        url: "http://localhost:6065",
        username: "",
        password: "",
        token: ""
    },
    timeline: {
        source: ""
    },
    appearance: {
        theme: "auto",
        fontSize: "medium",
        color: "",
        markdown: {
            customCss: "",
            printCss: "",
            extensions: [],
            preset: "default",
            fontFamily: "system",
            fontSizePx: 16,
            lineHeight: 1.7,
            contentMaxWidthPx: 860,
            printScale: 1,
            page: {
                size: "auto",
                orientation: "portrait",
                marginMm: 12
            },
            modules: {
                typography: true,
                lists: true,
                tables: true,
                codeBlocks: true,
                blockquotes: true,
                media: true,
                printBreaks: true
            },
            plugins: {
                smartTypography: false,
                softBreaksAsBr: false,
                externalLinksNewTab: true
            }
        }
    },
    speech: {
        language: defaultSpeechLanguage()
    },
    grid: {
        columns: 4,
        rows: 8,
        shape: "square"
    }
};

/** Resolve the single shared ecosystem token from any legacy field. */
export const resolveEcosystemToken = (settings: AppSettings | null | undefined): string => {
    const core = settings?.core;
    if (!core) return "";
    const eco = String(core.ecosystemToken || "").trim();
    if (eco) return eco;
    const userKey = String(core.userKey || "").trim();
    if (userKey) return userKey;
    return String(core.socket?.accessToken || core.socket?.airpadAuthToken || "").trim();
};

/**
 * Mirror ecosystem token onto userKey + socket.accessToken for wire/compat.
 * INVARIANT: after this, ecosystemToken === userKey === accessToken (when non-empty).
 */
export const normalizeEcosystemToken = (settings: AppSettings): string => {
    if (!settings.core) settings.core = {};
    const token = resolveEcosystemToken(settings);
    settings.core.ecosystemToken = token;
    settings.core.userKey = token;
    settings.core.socket = { ...(settings.core.socket || {}), accessToken: token };
    return token;
};

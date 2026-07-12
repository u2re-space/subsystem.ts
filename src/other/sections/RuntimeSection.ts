import type { SectionConfig } from "com/config/SettingsTypes";

export const RuntimeSection: SectionConfig = {
    key: "runtime",
    title: "Runtime",
    icon: "server",
    description: "Endpoint mode, credentials, and remote ops wiring.",
    groups: [
        {
            key: "runtime-mode",
            label: "Runtime mode",
            description: "Choose whether to run native or use a remote endpoint.",
            fields: [
                {
                    path: "core.mode",
                    label: "Mode",
                    type: "select",
                    options: [
                        { value: "native", label: "Native (standalone)" },
                        { value: "endpoint", label: "Endpoint (remote server)" }
                    ]
                },
                { path: "core.endpointUrl", label: "Endpoint URL", type: "text", placeholder: "https://api.example.com" }
            ]
        },
        {
            key: "share-target",
            label: "Share target action",
            description: "Pick which action runs for incoming share-target posts.",
            fields: [
                {
                    path: "ai.shareTargetMode",
                    label: "Share target action",
                    type: "select",
                    options: [
                        { value: "analyze", label: "Analyze" },
                        { value: "recognize", label: "Recognize" }
                    ]
                }
            ]
        },
        {
            key: "endpoint-access",
            label: "Endpoint access",
            description:
                "Credentials for endpoint mode. AirPad peer / route id is optional; access token and allow lists define who may use the hub directly or indirectly.",
            fields: [
                { path: "core.userId", label: "Associated device / client ID", type: "text", placeholder: "device-123" },
                { path: "core.userKey", label: "Client identifier token", type: "password", placeholder: "generated key" },
                {
                    path: "core.socket.allowAccessTokenWithoutUserKey",
                    label: "Allow access token without associated identity token",
                    type: "select",
                    options: [
                        { value: "false", label: "Require client identifier token (default)" },
                        { value: "true", label: "Optional when access / control token is set (endpoint verifies)" }
                    ]
                },
                {
                    path: "core.socket.routeTarget",
                    label: "AirPad peer / route ID (optional)",
                    type: "text",
                    placeholder: "Empty OK — e.g. L-192.168.0.110"
                },
                { path: "core.socket.accessToken", label: "Access / control token (optional)", type: "password", placeholder: "unified with control/master/hub on wire" },
                { path: "core.socket.clientAccessToken", label: "Client access token (optional, future)", type: "password", placeholder: "reverse-client / inbound WS" },
                {
                    path: "core.socket.connectionType",
                    label: "Wire connection type (optional)",
                    type: "text",
                    placeholder: "Default: exchanger-initiator"
                },
                {
                    path: "core.socket.archetype",
                    label: "Wire archetype (optional)",
                    type: "text",
                    placeholder: "Default: server-v2"
                },
                {
                    path: "core.socket.protocolLanesJson",
                    label: "Protocol lanes JSON (optional)",
                    type: "textarea",
                    placeholder: '{"websocket":["exchanger","initiator"]} — mirrors config-v2 Protocols'
                },
                {
                    path: "core.encrypt",
                    label: "Encrypt stored files",
                    type: "select",
                    options: [
                        { value: "false", label: "Disabled" },
                        { value: "true", label: "Enabled" }
                    ]
                },
                {
                    path: "core.preferBackendSync",
                    label: "Use backend storage for sync",
                    type: "select",
                    options: [
                        { value: "true", label: "Prefer backend" },
                        { value: "false", label: "Use local/WebDAV" }
                    ]
                }
            ]
        },
        {
            key: "clipboard-policy",
            label: "Clipboard & native data",
            description:
                "Inbound allow list (peer ids; optional ID::token stripped for matching), share-target destinations, broadcast targets, and future contacts/SMS bridge toggles.",
            fields: [
                {
                    path: "shell.maintainHubSocketConnection",
                    label: "Maintain hub WebSocket (CWSP)",
                    type: "select",
                    options: [
                        { value: "true", label: "On" },
                        { value: "false", label: "Off" }
                    ]
                },
                {
                    path: "shell.acceptInboundClipboardData",
                    label: "Accept inbound clipboard",
                    type: "select",
                    options: [
                        { value: "true", label: "Enabled" },
                        { value: "false", label: "Disabled" }
                    ]
                },
                {
                    path: "shell.clipboardBroadcastTargets",
                    label: "Clipboard broadcast targets (optional)",
                    type: "text",
                    placeholder: "L-…; L-…::token — empty uses AirPad route"
                },
                {
                    path: "shell.pushLocalClipboardToLan",
                    label: "Push local clipboard to peers",
                    type: "select",
                    options: [
                        { value: "false", label: "Off" },
                        { value: "true", label: "On (poll)" }
                    ]
                },
                {
                    path: "shell.clipboardPushIntervalMs",
                    label: "Clipboard push interval (ms)",
                    type: "text",
                    placeholder: "2000 (800–60000)"
                },
                { path: "shell.clipboardInboundAllowIds", label: "Inbound allow list (peer ids)", type: "text", placeholder: "L-…; L-… (empty = any)" },
                {
                    path: "shell.accessTokenBypassesClipboardAllowlist",
                    label: "Access token bypasses allow list",
                    type: "select",
                    options: [
                        { value: "false", label: "No" },
                        { value: "true", label: "Yes (requires core.socket.accessToken)" }
                    ]
                },
                {
                    path: "shell.clipboardShareDestinationIds",
                    label: "Share / quick-send clipboard destinations",
                    type: "text",
                    placeholder: "Optional override for share-target style outbound"
                },
                {
                    path: "shell.acceptContactsBridgeData",
                    label: "Accept contacts bridge data",
                    type: "select",
                    options: [
                        { value: "false", label: "No" },
                        { value: "true", label: "Yes" }
                    ]
                }
                // WHY: SMS bridge removed from settings — Capacitor never requests device SMS.
            ]
        },
        {
            key: "remote-ops",
            label: "Remote operations",
            description: "Configure HTTP/WS targets for sync/automation.",
            fields: [
                {
                    path: "core.ops.allowUnencrypted",
                    label: "Allow HTTP (unencrypted)",
                    type: "select",
                    options: [
                        { value: "false", label: "Disallow" },
                        { value: "true", label: "Allow HTTP" }
                    ]
                },
                {
                    path: "core.ops.httpTargets",
                    label: "HTTP targets (JSON)",
                    type: "textarea",
                    placeholder: `[{"id":"macro","url":"https://example.com/hook","method":"POST","headers":{"X-Key":"..."},"unencrypted":false}]`
                },
                {
                    path: "core.ops.wsTargets",
                    label: "WebSocket targets (JSON)",
                    type: "textarea",
                    placeholder: `[{"id":"ws-1","url":"wss://example.com/ws"}]`
                },
                {
                    path: "core.ops.syncTargets",
                    label: "Sync targets (JSON)",
                    type: "textarea",
                    placeholder: `[{"id":"sync-1","url":"https://example.com/sync"}]`
                }
            ]
        }
    ]
};

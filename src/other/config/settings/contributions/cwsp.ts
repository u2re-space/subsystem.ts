/*
 * Filename: cwsp.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/cwsp.ts
 * Change date and time: 17.05.00_21.07.2026
 * Reason for changes: Capacitor App update (dev) source picker + check/install actions.
 *   CRX: Control pairing UI (persistent session) on CWSP tab.
 *   2026-07-21: Files transfer section (W5) — destinations, allow-share-to-all,
 *   open-for-share / inbound modes, byte transport hint.
 *   2026-07-21f: Capacitor files landing (app/Downloads/SAF) + staging root
 *   options; Show paths / Choose SAF (app-private dirs are invisible in Files).
 */
import {
    registerSettingsContribution,
    type SettingsContributionContext
} from "../../SettingsContributions";
import {
    normalizeEcosystemToken,
    resolveEcosystemToken,
    type AppSettings
} from "../../SettingsTypes";
import {
    settingsButton,
    settingsButtonRow,
    settingsCheckboxField,
    settingsHint,
    settingsNumberField,
    settingsPanel,
    settingsSecretDisplayField,
    settingsSelectField,
    settingsTextField,
    type SettingsPanelChild
} from "../settings-contribution-ui";

const MULTI_VALUE_HINT = "Separate with comma, semicolon, space, or newline. Short IDs: L-110, L-196, L-200, L-208, L-210.";
const CRX_DESK_CLIENT_ID_DEFAULT = "L-110";

const isCrxWireId = (value: unknown): boolean =>
    /^L-\d{1,3}-crx$/i.test(String(value ?? "").trim());

const pickDeskClientId = (...candidates: unknown[]): string => {
    for (const raw of candidates) {
        const id = String(raw ?? "").trim();
        if (id && !isCrxWireId(id)) return id;
    }
    return CRX_DESK_CLIENT_ID_DEFAULT;
};

const connectionFields = (ctx: SettingsContributionContext): SettingsPanelChild[] => {
    const isCrx = ctx.surface === "crx" || Boolean(ctx.isExtension);
    const fields: SettingsPanelChild[] = [
        settingsHint(
            isCrx
                ? "CWSP tab syncs Neutralino portable (/service/config + clipboard-hub). Chrome wire hub URL is under Extension → Local hub URL — not this Relay field."
                : "Persist to IDB; Neutralino/WebNative also syncs to Node portable.config + clipboard-hub."
        ),
        "Connection",
        settingsTextField(
            "Relay / gateway host",
            "core.endpointUrl",
            "https://192.168.0.200:8434 or https://45.147.121.152:8434"
        ),
        settingsHint(
            isCrx
                ? "Neutralino/Node gateway SoT only. Does not overwrite Extension Local hub URL. External/WAN hosts may require the ecosystem token (and gateway login for Control)."
                : "Coordinator / gateway. Always include :8434 — bare host dials :443 where /ws is not served (404)."
        ),
        settingsTextField("Direct host (optional)", "core.ops.directUrl", "https://192.168.0.110:8434"),
        settingsHint("Optional direct peer (desk). Leave empty when phones only talk via gateway.")
    ];
    if (!isCrx) {
        fields.push(
            settingsTextField("Client id", "core.userId", "L-196 or L-110"),
            settingsHint("Short fleet id (L-196, L-210, …).")
        );
    } else {
        // WHY: CRX wire peer is core.userId (Extension tab = L-110-crx). This field is the
        // Neutralino/Node portable clientId synced via /service/config (+ PNA bridge).
        fields.push(
            settingsTextField("Client id (Neutralino / backend)", "shell.clientId", "L-110"),
            settingsHint(
                "Desk Node identity for portable.config / clipboard-hub / PNA. Chrome wire peer stays under Extension (L-110-crx)."
            )
        );
    }
    fields.push(
        settingsTextField("Ecosystem token", "core.ecosystemToken", "shared ecosystem key", "password"),
        settingsHint(
            isCrx
                ? "Shared ecosystem key for Neutralino + Chrome hub auth. WAN / external Relay or Local hub still needs this token (Control may also require gateway login)."
                : "One shared token for identification + control (replaces separate identifier / access tokens). Leave blank on Save to keep the stored token."
        ),
        settingsTextField("Destination node ids", "core.socket.routeTarget", "L-196;L-210;L-208"),
        settingsHint(MULTI_VALUE_HINT),
        settingsCheckboxField("Allow insecure TLS", "core.allowInsecureTls")
    );
    return fields;
};

const clipboardFields = (): SettingsPanelChild[] => [
    "Clipboard",
    settingsCheckboxField("Accept inbound clipboard", "shell.acceptInboundClipboardData"),
    settingsCheckboxField("Apply remote clipboard to device", "shell.applyRemoteClipboardToDevice"),
    settingsTextField("Inbound clipboard allow ids", "shell.clipboardInboundAllowIds", "* or L-196;L-210"),
    settingsHint(MULTI_VALUE_HINT),
    settingsTextField("Share-intent destination ids", "shell.clipboardShareDestinationIds", "L-196;L-210;L-110"),
    settingsHint(MULTI_VALUE_HINT),
    // WHY: prompt popup surface lives in Neutralino popup window (Windows/Linux)
    // and Android notification actions; hub enforces auto/ask gating. See
    // docs/superpowers/specs/2026-07-14-clipboard-prompt-popup-design.md.
    "Clipboard prompt",
    settingsSelectField("Outbound mode", "shell.clipboardOutboundMode", [
        ["auto", "Auto — share + show popup (Erase optional)"],
        ["ask", "Ask — hold share until confirmed"]
    ]),
    settingsSelectField("Inbound mode", "shell.clipboardInboundMode", [
        ["auto", "Auto — apply + show popup (Undo optional)"],
        ["ask", "Ask — hold apply until confirmed"]
    ]),
    settingsCheckboxField("Show Erase on outbound auto popup", "shell.clipboardOutboundShowErase"),
    settingsCheckboxField("Show Undo on inbound auto popup", "shell.clipboardInboundShowUndo"),
    settingsNumberField(
        "Popup auto-dismiss (ms)",
        "shell.clipboardPromptDismissMs",
        { min: "1000", step: "500", placeholder: "10000" }
    ),
    settingsHint("On Ask mode, dismiss / timeout means no share and no apply. Defaults to 10000ms.")
];

/**
 * Files transfer (Open-with / share-target / files:* hub).
 * WHY: W3 hubs already honor these keys; CWSP tab had no UI until W5.
 * INVARIANT: never overload clipboard prompt fields — separate shell.files*.
 */
const filesTransferFields = (ctx: SettingsContributionContext): SettingsPanelChild[] => {
    const fields: SettingsPanelChild[] = [
        "Files transfer",
        settingsHint(
            "Open-with / share-target and files:offer use these knobs. Empty destinations open a peer picker. Wildcards (`*`) need Allow share to all."
        ),
        settingsCheckboxField("Accept inbound files", "shell.acceptInboundFilesData"),
        settingsTextField(
            "Default destination ids",
            "shell.filesShareDestinationIds",
            "L-196;L-210 (empty = picker)"
        ),
        settingsHint(MULTI_VALUE_HINT),
        settingsCheckboxField("Allow share to all (*)", "shell.filesAllowShareToAll"),
        settingsHint("SECURITY: off by default — blocks accidental fleet-wide files:offer fan-out."),
        settingsSelectField("Open for share", "shell.filesOpenForShareMode", [
            ["auto", "Auto — offer when destinations are set"],
            ["manual", "Manual — always ask for destinations"]
        ]),
        settingsSelectField("Inbound accept", "shell.filesInboundMode", [
            ["ask", "Ask — Accept / Decline prompt"],
            ["auto", "Auto — accept into landing folder"]
        ]),
        settingsCheckboxField(
            "Copy received files to clipboard (for Paste / re-share)",
            "shell.filesCopyOnReceive"
        ),
        settingsHint(
            "Neutralino/Windows: after Accept, place landed files on CF_HDROP (Explorer Paste). On by default."
        ),
        settingsSelectField("Byte transport hint", "shell.filesByteTransport", [
            ["auto", "Auto — receiver chooses"],
            ["http", "HTTP blob GET/PUT"],
            ["ws", "WebSocket chunks"]
        ]),
        settingsHint(
            "Transport hint is advisory. Large batches still need a live blob endpoint (W4); small batches may embed."
        )
    ];

    // WHY: Cap-only storage — app-private dirs are invisible in system Files;
    // user must pick Downloads/SAF or use Show paths / Share README.
    if (ctx.surface === "capacitor" || ctx.surface === "native") {
        const safHint = document.createElement("p");
        safHint.className = "field-hint";
        safHint.setAttribute("data-files-saf-uri", "1");
        safHint.textContent = "SAF folder: (not set)";

        const pathsHint = document.createElement("p");
        pathsHint.className = "field-hint";
        pathsHint.setAttribute("data-files-storage-paths", "1");
        pathsHint.style.whiteSpace = "pre-wrap";
        pathsHint.textContent = "Staging / landing paths: tap Show paths.";

        fields.push(
            "Files storage (Capacitor)",
            settingsSelectField("Save received files to", "shell.filesLandingMode", [
                ["app", "App storage (private — default)"],
                ["downloads", "Downloads (user-visible)"],
                ["saf", "SAF folder (pick below)"]
            ]),
            settingsHint(
                "App storage is NOT under Android/data in File Manager. After install, open Files → sidebar → “CWSP Files” (DocumentsProvider / SAF). Or use Downloads / SAF landing, Show paths, Share README."
            ),
            safHint,
            settingsButtonRow(
                settingsButton("Choose SAF folder", "files-storage-pick-saf", { primary: true }),
                settingsButton("Clear SAF folder", "files-storage-clear-saf")
            ),
            settingsCheckboxField("Ask for folder every time if SAF unset", "shell.filesAskDirEveryTime"),
            settingsSelectField("Temp staging place", "shell.filesStagingRoot", [
                ["app", "App internal (files/) — default"],
                ["cache", "App cache (may be purged)"],
                ["external", "App external (Android/data/… — OEM may hide)"]
            ]),
            settingsHint(
                "Outgoing (Open-with) and incoming unpack stage here first, then export to the Save location above."
            ),
            pathsHint,
            settingsButtonRow(
                settingsButton("Show paths", "files-storage-show-paths"),
                settingsButton("Browse CWSP Files…", "files-storage-open-explorer"),
                settingsButton("Share README…", "files-storage-share-readme")
            ),
            "File access permissions",
            (() => {
                const el = document.createElement("p");
                el.className = "field-hint";
                el.setAttribute("data-files-perm-status", "1");
                el.style.whiteSpace = "pre-wrap";
                el.textContent =
                    "Permissions: tap Refresh status. Media/storage is a runtime dialog; all-files opens system settings.";
                return el;
            })(),
            settingsButtonRow(
                settingsButton("Refresh status", "files-storage-perm-status"),
                settingsButton("Request media access", "files-storage-request-media", { primary: true }),
                settingsButton("Allow manage all files…", "files-storage-request-all-files")
            ),
            settingsHint(
                "All-files access (MANAGE_EXTERNAL_STORAGE) is for shared storage / USB / MediaStore — not other apps’ Android/data. Our tree stays under Files → CWSP Files. Play may review this permission if you publish."
            )
        );
    }

    return fields;
};

const nativeWireFields = (): SettingsPanelChild[] => [
    "Native wire (Capacitor)",
    settingsCheckboxField("Prefer native Java WebSocket", "core.interop.preferNativeWebsocket"),
    settingsCheckboxField("Maintain hub socket in background", "shell.maintainHubSocketConnection")
];

/** Control pairing credentials shown on device (public token + rotating code). */
const controlPairingFields = (): SettingsPanelChild[] => [
    "Control pairing",
    // WHY: Public token first — same order as SPA/CRX pairing modal (copy top→bottom).
    settingsSecretDisplayField("Public token", "control-public-token", {
        mono: true,
        placeholder: "••••••••••••"
    }),
    settingsSecretDisplayField("Device code (20s, +10s grace)", "control-device-code", {
        placeholder: "••••••"
    }),
    settingsButtonRow(
        settingsButton("Refresh code", "control-pairing-refresh"),
        settingsButton("Regenerate public token", "control-public-token-regenerate")
    ),
    settingsHint(
        "Copy order for https://cwsp.u2re.space: Public token, then live Device code. Values are hidden by default — use View / Copy. Session ≤ 1 hour. Regenerating the public token invalidates old pairings."
    )
];

/**
 * CRX Control pairing — compact status + modal trigger (no inline token/code fields).
 * WHY: same UX as https://cwsp.u2re.space modal; secrets never land in portable.config.
 */
const crxControlPairingFields = (): SettingsPanelChild[] => {
    const status = document.createElement("p");
    status.className = "field-hint";
    status.setAttribute("data-crx-control-status", "1");
    status.textContent = "Control: …";

    return [
        "Control pairing",
        status,
        settingsButtonRow(
            settingsButton("Pair Control…", "crx-control-pair", { primary: true }),
            settingsButton("Unpair", "crx-control-unpair")
        ),
        settingsHint(
            "Opens a pairing dialog (public token + 20s device code from Neutralino). Persistent session authorizes Copy & Share / Paste by CWSP and CWSP tab sync."
        )
    ];
};

/**
 * Pairing secrets belong on the device shell (Neutralino / Capacitor), never on the
 * public Control SPA. `resolveSettingsSurface()` maps Neutralino → `"web"`, so we
 * must not key off `"webnative"` alone.
 */
const isPublicCwspControlSpa = (): boolean => {
    try {
        const g = globalThis as {
            NL_OS?: unknown;
            NL_PORT?: unknown;
            Neutralino?: unknown;
            Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
        };
        if (g.NL_OS != null || g.NL_PORT != null || g.Neutralino) return false;
        if (g.Capacitor?.isNativePlatform?.()) return false;
        const plat = String(g.Capacitor?.getPlatform?.() || "").toLowerCase();
        if (plat === "android" || plat === "ios") return false;
        const host = String(location.hostname || "").toLowerCase();
        if (!host || host === "localhost" || host === "127.0.0.1" || host === "[::1]") return false;
        return location.protocol === "https:";
    } catch {
        return false;
    }
};

/** Device toggles folded into CWSP tab on mobile (same `AppSettings.shell` paths). */
const mobileDeviceFields = (): SettingsPanelChild[] => [
    "Device",
    settingsCheckboxField("Start CWSP on boot", "shell.autoStartOnBoot"),
    settingsCheckboxField("Foreground CWSP service", "shell.bridgeDaemonEnabled"),
    // WHY: PNA Control API on :8434 for public /cwsp SPA — off by default.
    settingsCheckboxField("Allow Control API", "shell.allowControlApi"),
    settingsHint(
        "Allow Control API listens on :8434 so public CWSP Control can pair (public token + 20s code + Accept). Ecosystem token stays on-device for the hub — not used as the Control SPA password."
    ),
    ...controlPairingFields(),
    settingsCheckboxField("Enable remote clipboard bridge", "shell.enableRemoteClipboardBridge"),
    settingsCheckboxField("Accept contacts bridge", "shell.acceptContactsBridgeData"),
    // WHY: SMS bridge UI removed — Android never declares/requests READ_SMS (bank malware heuristics).
    settingsHint("Save may request contacts / notifications when those toggles are on. SMS is not used.")
];

/** Capacitor-only: sideload newer APK from gateway without SSH/SFTP File Manager. */
const mobileApkUpdateFields = (): SettingsPanelChild[] => {
    const versionHint = document.createElement("p");
    versionHint.className = "field-hint";
    versionHint.setAttribute("data-apk-local-version", "1");
    versionHint.textContent = "Installed version: … (tap Check to refresh)";

    return [
        "App update (dev)",
        versionHint,
        settingsSelectField("Update source", "shell.apkUpdateSource", [
            ["wan", "WAN — https://45.147.121.152:8434"],
            ["lan", "LAN — https://192.168.0.200:8434"],
            ["relay", "Current Relay (core.endpointUrl)"]
        ]),
        settingsButtonRow(
            settingsButton("Check for update", "apk-update-check"),
            settingsButton("Download & install", "apk-update-install", { primary: true })
        ),
        settingsHint(
            "Uses ecosystem token (X-API-Key) against /releases/android. Install requires the same APK signing certificate as the installed app. Each `npm run build:capacitor` auto-bumps VERSION_CODE and restages the gateway release."
        )
    ];
};

export const registerCwspSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "cwsp",
        label: "CWSP",
        order: 55,
        // WHY: document PWA (md.u2re.space) must not expose Control endpoint/token UI.
        excludeSurfaces: ["markdown"],
        render: (ctx: SettingsContributionContext) => {
            const children: SettingsPanelChild[] = [
                ...connectionFields(ctx),
                ...clipboardFields(),
                ...filesTransferFields(ctx)
            ];
            if (ctx.surface === "capacitor" || ctx.surface === "native") {
                children.push(
                    ...nativeWireFields(),
                    ...mobileDeviceFields(),
                    ...mobileApkUpdateFields()
                );
            } else if (ctx.surface === "crx" || ctx.isExtension) {
                // WHY: maintainHub / protocol / CRX id live under Extension tab;
                // Control pairing for clipboard menus lives here (CWSP tab).
                children.push(...crxControlPairingFields());
            } else if (!isPublicCwspControlSpa()) {
                // Neutralino / local web (surface often reports as "web"): show pairing UI.
                children.push(...nativeWireFields(), ...controlPairingFields());
            }
            // Public https Control SPA: no local pairing display / refresh poll.
            return settingsPanel("cwsp", "CWSP", children);
        },
        load: (settings: AppSettings, panel: HTMLElement) => {
            // WHY: hydrate single UI field from ecosystemToken or legacy userKey/accessToken.
            const input = panel.querySelector('[data-field="core.ecosystemToken"]') as HTMLInputElement | null;
            if (input) input.value = resolveEcosystemToken(settings);
            // INVARIANT (CRX): shell.clientId field only exists on CRX CWSP tab.
            const clientInput = panel.querySelector(
                '[data-field="shell.clientId"]'
            ) as HTMLInputElement | null;
            if (clientInput) {
                const desk = pickDeskClientId(
                    clientInput.value,
                    settings.shell?.clientId,
                    settings.core?.userId
                );
                clientInput.value = desk;
                settings.shell = { ...(settings.shell || {}), clientId: desk };
            }
            const src = panel.querySelector(
                '[data-field="shell.apkUpdateSource"]'
            ) as HTMLSelectElement | null;
            if (src) {
                const v = String((settings.shell as any)?.apkUpdateSource || "wan").trim();
                src.value = v === "lan" || v === "relay" ? v : "wan";
            }
            // WHY: show truncated SAF URI (Cap files storage section).
            const safEl = panel.querySelector("[data-files-saf-uri]") as HTMLElement | null;
            if (safEl) {
                const uri = String(settings.shell?.filesIncomingDir || "").trim();
                safEl.textContent = uri
                    ? `SAF folder: ${uri.length > 72 ? `${uri.slice(0, 36)}…${uri.slice(-28)}` : uri}`
                    : "SAF folder: (not set)";
            }
            // Auto-load Control pairing credentials into the CWSP tab.
            const refreshBtn = panel.querySelector(
                'button[data-action="control-pairing-refresh"]'
            ) as HTMLButtonElement | null;
            if (refreshBtn) {
                queueMicrotask(() => refreshBtn.click());
                const prev = Number((panel as HTMLElement & { __cwspPairTimer?: number }).__cwspPairTimer || 0);
                if (prev) clearInterval(prev);
                (panel as HTMLElement & { __cwspPairTimer?: number }).__cwspPairTimer = window.setInterval(() => {
                    if (!panel.isConnected) return;
                    refreshBtn.click();
                }, 2500);
            }
            // CRX: hydrate persistent Control session status (not device secrets).
            const crxStatus = panel.querySelector(
                "[data-crx-control-status]"
            ) as HTMLElement | null;
            if (crxStatus) {
                void import("com/config/settings/crx-control-session")
                    .then((m) => m.formatCrxControlSessionStatus())
                    .then((text) => {
                        if (crxStatus.isConnected) crxStatus.textContent = text;
                    })
                    .catch(() => {
                        crxStatus.textContent = "Control: status unavailable";
                    });
            }
        },
        save: (settings: AppSettings) => {
            normalizeEcosystemToken(settings);
            // WHY: never POST Chrome wire id into Neutralino portable as desk clientId.
            if (isCrxWireId(settings.shell?.clientId)) {
                settings.shell = {
                    ...(settings.shell || {}),
                    clientId: pickDeskClientId(settings.core?.userId)
                };
            }
        }
    });

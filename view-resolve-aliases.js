/**
 * Shared Vite resolve.alias entries for view packages and the modules/shared dev playground.
 * Keeps paths consistent between defineViewProject() and HTTPS dev harness.
 */
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const viewsRoot = resolve(import.meta.dirname, "..");
/** modules/views/shared */
const sharedRoot = resolve(import.meta.dirname);
const subsystemRoot = resolve(workspaceRoot, "modules/projects/subsystem/src");

const alias = (find, replacement) => ({ find, replacement });

/**
 * @param {Array<{ find: string, replacement: string }>} [prepend]
 *        Typically `[alias("view-entry", entryPath)]` for a single view build.
 */
export function getViewResolveAliases(prepend = []) {
    return [
        ...prepend,
        alias("views/types", resolve(sharedRoot, "types.ts")),
        alias("views/registry", resolve(sharedRoot, "registry.ts")),
        alias("views/apis/channel-actions", resolve(subsystemRoot, "routing/api/channel-actions.ts")),
        alias("views/apis/channel-invokable", resolve(subsystemRoot, "routing/api/channel-invokable.ts")),
        alias("views/demo", resolve(sharedRoot, "demo/main.ts")),
        alias("views/test", resolve(sharedRoot, "test/module-smoke.ts")),
        alias("shells/types", resolve(sharedRoot, "types.ts")),
        alias("shells/boot", resolve(sharedRoot, "runtime/boot.ts")),
        alias("core/storage", resolve(sharedRoot, "runtime/storage.ts")),
        alias("core/store/StateStorage", resolve(sharedRoot, "runtime/state-storage.ts")),
        alias("core/modules/Clipboard", resolve(sharedRoot, "runtime/clipboard.ts")),
        alias("core/document/AIResponseParser", resolve(subsystemRoot, "other/document/AIResponseParser.ts")),
        alias("core/document/DocTools", resolve(sharedRoot, "runtime/doc-tools.ts")),
        alias("core/document/DocxExport", resolve(sharedRoot, "runtime/docx-export.ts")),
        alias("core/pwa/sw-handling", resolve(sharedRoot, "runtime/sw-handling.ts")),
        alias("core/utils/Theme", resolve(sharedRoot, "runtime/theme.ts")),
        alias("com/config/Settings", resolve(sharedRoot, "runtime/settings-config.ts")),
        alias("com/config/SettingsTypes", resolve(sharedRoot, "runtime/app-settings.ts")),
        alias("com/config/Names", resolve(sharedRoot, "runtime/names.ts")),
        alias("com/config/admin-doors", resolve(sharedRoot, "runtime/admin-doors.ts")),
        alias("com/core/UnifiedMessaging", resolve(sharedRoot, "runtime/messaging.ts")),
        alias("com/core/UniformViewTransport", resolve(sharedRoot, "runtime/view-transport.ts")),
        alias("com/core/ShareTargetGateway", resolve(sharedRoot, "runtime/share-target.ts")),
        alias("com/core/LogSanitizer", resolve(sharedRoot, "runtime/log-sanitizer.ts")),
        alias("com/service/misc/ActionHistory", resolve(sharedRoot, "runtime/action-history.ts")),
        alias("com/service/misc/ExecutionCore", resolve(sharedRoot, "runtime/execution-core.ts")),
        alias("com/service/instructions/CustomInstructions", resolve(sharedRoot, "runtime/custom-instructions.ts")),
        alias("com/service/instructions/templates", resolve(sharedRoot, "runtime/instruction-templates.ts")),
        alias("com/service/instructions/utils", resolve(sharedRoot, "runtime/instruction-utils.ts")),
        alias("shared/policies/event-handling-policy", resolve(sharedRoot, "runtime/event-handling-policy.ts")),
        alias("shared/native/clipboard-device", resolve(sharedRoot, "runtime/clipboard-device.ts")),
        alias("shared/transport/websocket", resolve(sharedRoot, "runtime/websocket.ts")),
        alias("shared/transport/hub-socket-boot", resolve(sharedRoot, "runtime/hub-socket-boot.ts")),
        alias("cwsp-shared/wire-target-id", resolve(sharedRoot, "runtime/wire-target-id.ts")),
        alias("cwsp-shared/cws-client-wire-defaults", resolve(sharedRoot, "runtime/cws-client-wire-defaults.ts")),
        alias("veela-lib", resolve(subsystemRoot, "styles/_veela-lib.scss")),
        alias("core/misc/config", resolve(sharedRoot, "styles/core/misc/_config.scss")),
        alias("core/misc/tokens", resolve(sharedRoot, "styles/core/misc/_tokens.scss")),
        alias("core/misc/mixins", resolve(sharedRoot, "styles/core/misc/_mixins.scss")),
        alias("core/misc/functions", resolve(sharedRoot, "styles/core/misc/_functions.scss")),
        alias(
            "../../../../../subsystem/fest/polyfill/showOpenFilePicker.mjs",
            resolve(workspaceRoot, "modules/projects/dom.ts/src/polyfill/showOpenFilePicker.mjs")
        ),
        alias("fest/core", resolve(workspaceRoot, "modules/projects/core.ts/src/index.ts")),
        alias("fest/dom", resolve(workspaceRoot, "modules/projects/dom.ts/src/index.ts")),
        alias("fest/fl-ui", resolve(workspaceRoot, "modules/projects/fl.ui/src/index.ts")),
        alias("fest/icon", resolve(workspaceRoot, "modules/projects/icon.ts/src/index.ts")),
        alias("fest/lure", resolve(workspaceRoot, "modules/projects/lur.e/src/index.ts")),
        alias("fest/object", resolve(workspaceRoot, "modules/projects/object.ts/src/index.ts")),
        alias("fest/subsystem", resolve(subsystemRoot, "index.ts")),
        alias("fest/uniform", resolve(workspaceRoot, "modules/projects/uniform.ts/src/index.ts")),
        alias("fl-ui", resolve(workspaceRoot, "modules/projects/fl.ui/src/ui"))
    ];
}

export { workspaceRoot, viewsRoot, sharedRoot, subsystemRoot };

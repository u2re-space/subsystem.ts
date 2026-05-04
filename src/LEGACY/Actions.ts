/**
 * Action catalog and execution helpers used by shortcut tiles and entity views.
 *
 * This module connects UI-level action ids with concrete browser, storage,
 * clipboard, recognition, and navigation behaviors.
 */
import type { EntityDescriptor } from "core/utils/Types";
import { generateNewPlan } from "core/workers/AskToPlan";
import { triggerDebugTaskGeneration } from "core/utils/DebugTaskGenerator";
import type { EntityInterface } from "com/template/EntityInterface";
import { currentWebDav, loadSettings, saveSettings } from "com/config/Settings";
import { downloadByPath, getDirectoryHandle, mountAsRoot, navigate, openPickerAndAnalyze, openPickerAndWrite, pasteAndAnalyze, pasteIntoClipboardWithRecognize, writeFileSmart } from "fest/lure";
import { NAVIGATION_SHORTCUTS, snapshotSpeedDialItem } from "core/store/StateStorage";
import { JSOX } from "jsox";
import { stringRef } from "fest/object";
import { writeText, readText } from "core/modules/Clipboard";
import { canParseURL } from "core/utils/Runtime";
import { showError, showSuccess } from "fest/fl-ui";

//
const SERVICE_UUID = '12345678-1234-5678-1234-5678abcdef01';
const CHAR_UUID    = '12345678-1234-5678-1234-5678abcdef02';

let characteristic;

//
async function connect() {
    const device = await (navigator as any)?.bluetooth?.requestDevice?.({
        filters: [{ services: [SERVICE_UUID] }]
    })?.catch?.(console.warn.bind(console));
    const server = await device?.gatt?.connect?.()?.catch?.(console.warn.bind(console));
    const service = await server?.getPrimaryService?.(SERVICE_UUID)?.catch?.(console.warn.bind(console));
    characteristic = await service?.getCharacteristic?.(CHAR_UUID)?.catch?.(console.warn.bind(console));
    return characteristic;
}

//
async function startListening() {
    /*const device = await (navigator as any)?.bluetooth?.requestDevice?.({
        filters: [{ services: [SERVICE_UUID] }]
    })?.catch?.(console.warn.bind(console));
    const server = await device?.gatt?.connect?.()?.catch?.(console.warn.bind(console));
    const service = await server?.getPrimaryService?.(SERVICE_UUID)?.catch?.(console.warn.bind(console));
    await service?.getCharacteristic?.(CHAR_UUID)?.catch?.(console.warn.bind(console));
*/

    characteristic ??= (await connect()?.catch?.(console.warn.bind(console))) ?? characteristic;
    characteristic?.addEventListener?.('characteristicvaluechanged', async (event) => {
        const value = event?.target?.value;
        const decoder = new TextDecoder();
        const text = decoder.decode(value.buffer);

        const result = await writeText(text);
        if (!result.ok) {
            console.error('Clipboard write failed:', result.error);
        }
    });
    await characteristic?.startNotifications?.();
    return true;
}

// needs to connect with special button...
export const whenPasteInto = async () => {
    if (!characteristic) {
        await connect();
    }
    const result = await readText();
    if (result.ok && result.data) {
        const encoder = new TextEncoder();
        const data = encoder.encode(String(result.data));
        await characteristic?.writeValue?.(data);
    }
}

//
/*
try {
    startListening?.()?.catch?.(console.warn.bind(console));
} catch (e) {
    console.warn(e);
}
*/

//
/** Visual icon mapping for action ids rendered by shortcut and entity UIs. */
export const iconsPerAction = new Map<string, string>([
    ["bluetooth-enable-acceptance", "bluetooth"],
    ["bluetooth-share-clipboard", "bluetooth"],
    ["share-clipboard", "share"],
    ["add", "file-plus"],
    ["upload", "cube-focus"],
    ["generate", "magic-wand"],
    ["record-speech-recognition", "microphone"],
    ["debug-gen", "bug"],
    ["paste-and-recognize", "asterisk"],
    ["paste-and-analyze", "clipboard"],
    ["snip-and-recognize", "crop"],
    ["file-refresh", "arrows-clockwise"],
    ["file-mount", "screwdriver"],
    ["file-download", "download"],
    ["file-upload", "upload"],

    ["apply-settings", "gear-six"],
    ["import-settings", "upload-simple"],
    ["export-settings", "download-simple"],
    ["open-link", "arrow-square-out"],
    ["copy-link", "link"],
    ["copy-state-desc", "file-code"],
    ["open-view", "compass"]
]);

//
/** Color accents for actions whose intent should be distinguishable at a glance. */
export const actionColors = new Map<string, string>([
    ["share-clipboard", "red"],
    ["bluetooth-enable-acceptance", "blue"],
    ["bluetooth-share-clipboard", "blue"],
    ["add", "green"],
    ["upload", "blue"],
    ["generate", "purple"],
    ["record-speech-recognition", "microphone"],
    ["debug-gen", "red"],
    ["paste-and-analyze", "orange"],
    ["paste-and-recognize", "orange"],
    ["snip-and-recognize", "yellow"],
    ["apply-settings", "green"],
    ["import-settings", "blue"],
    ["export-settings", "purple"],
    ["open-link", "orange"],
    ["copy-link", "yellow"],
    ["copy-state-desc", "purple"],
    ["open-view", "green"]
]);

//
/** Human-facing labels derived from action ids and optional entity metadata. */
export const labelsPerAction = new Map<string, (entityDesc: EntityDescriptor) => string>([
    ["bluetooth-enable-acceptance", () => "Enable Bluetooth acceptance"],
    ["bluetooth-share-clipboard", () => "Paste data into Bluetooth"],
    ["share-clipboard", () => "Share clipboard"],
    ["file-upload", (entityDesc: EntityDescriptor) => `Upload file`],
    ["file-download", (entityDesc: EntityDescriptor) => `Download file`],
    ["file-mount", (entityDesc: EntityDescriptor) => `Mount directory`],
    ["file-refresh", (entityDesc: EntityDescriptor) => `Refresh`],
    ["add", (entityDesc: EntityDescriptor) => `Add ${entityDesc.label}`],
    ["upload", (entityDesc: EntityDescriptor) => `Upload and recognize`], //${entityDesc.label}
    ["generate", (entityDesc: EntityDescriptor) => `Generate ${entityDesc.label}`],
    ["record-speech-recognition", (entityDesc: EntityDescriptor) => `Record speech recognition`],
    ["debug-gen", (entityDesc: EntityDescriptor) => `Generate debug tasks for ${entityDesc.label}`],
    ["paste-and-analyze", (entityDesc: EntityDescriptor) => "Paste and analyze"],
    ["paste-and-recognize", (entityDesc: EntityDescriptor) => "Recognize from/to clipboard"],
    ["snip-and-recognize", (entityDesc: EntityDescriptor) => "Snip and recognize"],
    ["apply-settings", (entityDesc: EntityDescriptor)=>"Save settings"],
    ["import-settings", () => "Import settings"],
    ["export-settings", () => "Export settings"],
    ["open-link", (entityDesc: EntityDescriptor | any) => entityDesc?.label ? `Open ${entityDesc.label}` : "Open link"],
    ["copy-link", () => "Copy link"],
    ["copy-state-desc", () => "Copy shortcut JSON"],
    ["open-view", (entityDesc: EntityDescriptor | any) => `Open ${entityDesc?.label || "view"}`]
]);

/** Unified clipboard copy helper with API/fallback handling. */
const copyTextToClipboard = async (text: string) => {
    if (!text?.length) throw new Error("empty");
    const result = await writeText(text);
    if (!result.ok) throw new Error(result.error || "clipboard write failed");
    return true;
};

//
const ensureHashNavigation = (view: string, viewMaker?: any, props?: any) => {
    if (!view || typeof window === "undefined") return;

    //
    if (viewMaker) {
        viewMaker?.(view, props);
    } else {
        const hash = `#${view?.replace?.(/^#/, "") ?? view}`;
        if (location.hash !== hash) {
            navigate(hash);
        }
    }
};

/** Use the Web Share API when the current browser/runtime supports the supplied payload. */
export const clientShare = async (data: any) => {
    if (navigator?.canShare) {
        return navigator?.canShare?.(data) ? navigator?.share?.(data) : false;
    }
    return false;
}

//
Promise.try(async () => {
    // @ts-ignore
    const recognition = typeof SpeechRecognition != "undefined" ? new SpeechRecognition() : null;
    if (!recognition) { showError("Speech recognition is not supported by this browser"); return null; }

    //
    let diagnostic = ""; // @ts-ignore
    SpeechRecognition?.available?.({ langs: [navigator.language] })?.then?.((result: any) => {
        if (result === "unavailable") {
            diagnostic = `${navigator.language} not available to download at this time. Sorry!`;
        } else if (result === "available") {
            console.log("Ready to receive a color command.");
        } else {
            diagnostic = `${navigator.language} language pack downloading`;

            // @ts-ignore
            SpeechRecognition?.install?.({ langs: [navigator.language] })?.then?.((result) => {
                if (result) {
                    diagnostic = `${navigator.language} language pack downloaded. Try again.`;
                } else {
                    diagnostic = `${navigator.language} language pack failed to download. Try again later.`;
                }
                console.log(diagnostic);
            })?.catch?.(console.warn.bind(console));
        }
        console.log(diagnostic);
    });
});



/** Start speech recognition and return the final recognized text when available. */
export const recordSpeechRecognition = async (userInputHoldUntilStop: boolean = true) => {
    // @ts-ignore
    const recognition = typeof SpeechRecognition != "undefined" ? new SpeechRecognition() : null;
    if (!recognition) {
        showError("Speech recognition is not supported by this browser");
        return null;
    }

    //
    const settings = await loadSettings();
    recognition.lang = settings?.speech?.language || navigator?.language || "ru-RU";

    //
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.alterations = 0.8;
    recognition.maxAlternatives = 1;

    //
    const promised = Promise.withResolvers<string>();
    const writingRef = stringRef("");
    let prepare: string[] = [];
    recognition.onresult = (event) => {
        prepare.push(event.results[0][0].transcript as string);
    }
    recognition.onend = () => {
        // should be at least 2 words to be valid speech prompt
        const result = prepare?.join?.(" ")?.trim?.();
        writingRef.value = result?.split?.(/\s+/)?.length >= 2 ? result : "";
        console.log("writingRef.value", writingRef.value);
        console.log("prepare", prepare);
        promised.resolve(writingRef.value);
    }
    recognition.onerror = (event) => {
        promised.reject(event.error);
    }

    //
    // Bubble phase: stop recognition without killing other listeners (no stop* / preventDefault).
    const endOnPointerEnd = () => {
        if (!userInputHoldUntilStop) return;
        recognition.stop()?.catch?.(console.warn.bind(console));
    };
    document.addEventListener("pointerup", endOnPointerEnd, { once: true, capture: false });
    document.addEventListener("pointercancel", endOnPointerEnd, { once: true, capture: false });

    //
    recognition.start()?.catch?.(console.warn.bind(console));
    return { stop() { recognition.stop(); }, writing: writingRef.value, recognized: promised.promise, promise: promised.promise };
}

//
let lastSpeechRecogTime = 0;

//
function isSameOrigin(url: string) {
    return new URL(url, globalThis?.location?.href).origin === globalThis?.location?.origin;
}

//
const throttleToRun = (cb: (...args: any[]) => Promise<any>, timeout: number = 1000) => {
    let lastTime = 0;
    return async (...args: any[]) => {
        const now = Date.now();
        if (now - lastTime > timeout) { lastTime = now; return await cb(...args); }
        return null;
    }
}

//
export const actionRegistry = new Map<string, (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => any>([
    ["bluetooth-enable-acceptance", async () => {
        try {
            await startListening()?.catch?.(console.warn.bind(console));
        } catch (e) {
            console.warn(e);
            showError("Failed to enable Bluetooth acceptance");
        }
    }],

    //
    ["bluetooth-share-clipboard", async () => {
        try {
            await whenPasteInto()?.catch?.(console.warn.bind(console));
            showSuccess("Pasted data into Bluetooth");
        } catch (e) {
            console.warn(e);
            showError("Failed to paste from Bluetooth");
        }
    }],

    //
    ["paste-and-recognize", async (): Promise<boolean> => {
        try {
            const success = await pasteIntoClipboardWithRecognize()?.catch?.(console.warn.bind(console));
            if (!success) { showError("Failed to paste for recognition"); return false; }
            showSuccess("Pasted data for recognition"); return true;
        } catch (e) { console.warn(e); showError("Failed to paste for recognition"); return false; }
    }],

    //
    ["share-clipboard", async () => {
        const items = await navigator?.clipboard?.read?.()?.catch?.(console.warn.bind(console));
        let fileToShare: string | File | Blob | null = null;

        //
        if (!items?.length) {
            fileToShare = await navigator?.clipboard?.readText?.()?.catch?.(console.warn.bind(console)) as string | null;
            if (!fileToShare) { showError("Clipboard is empty."); return false; }
        }

        //
        let multipleFiles: (File | Blob)[] = [];
        for (const item of items || []) {
            if (fileToShare) break;
            for (const type of (item?.types || [])) {
                if (type === 'image/png' || type === 'image/jpeg') {
                    const file = await item?.getType?.(type)?.catch?.(console.warn.bind(console)) as File | Blob | null;
                    if (file && (file instanceof File || file instanceof Blob))
                        { multipleFiles.push(file instanceof File ? file : new File([file], `clipboard-image-${Date.now()}.${type.split('/')[1]}`, { type: file.type })); }
                    break;
                }
            }
        }

        //
        if (!multipleFiles?.length && !fileToShare) {
            fileToShare = await navigator?.clipboard?.readText?.()?.catch?.(console.warn.bind(console)) as string | null;
            if (!fileToShare) { showError("Clipboard is empty."); return false; }
        }

        //
        if (!navigator?.canShare) { showError("This browser cannot share files via Web Share API."); return false; }

        // try smart share by type
        if (multipleFiles?.length && navigator?.canShare?.({ files: multipleFiles as any })) {
            return clientShare({ title: 'Shared by CW from clipboard...', files: multipleFiles as any })?.catch?.(console.warn.bind(console));
        } else
        if (fileToShare) {
            if ((fileToShare as any) instanceof URL || canParseURL(fileToShare?.trim?.() || "")) {
                return clientShare({ url: (fileToShare as any)?.href ?? fileToShare as string | URL })?.catch?.(console.warn.bind(console));
            } else {
                return clientShare({ text: fileToShare as string })?.catch?.(console.warn.bind(console));
            }
        }
    }],


    ["apply-settings", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        const forms = viewPage.forms;
        const tabsState = viewPage.tabsState;
        if (forms) {
            const activeForm = forms.get(tabsState.value);
            activeForm?.requestSubmit?.();
        }
    }],

    //
    ["export-settings", async () => {
        try {
            const settings = await loadSettings();
            const blob = new Blob([JSOX.stringify(settings as any) as string], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `crossword-settings-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showSuccess("Settings exported");
        } catch (e) {
            console.warn(e);
            showError("Failed to export settings");
        }
    }],

    //
    ["import-settings", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const json = JSOX.parse(text) as any;
                if (typeof json !== 'object') throw new Error("Invalid JSON");

                await saveSettings(json);
                if (viewPage && viewPage.reloadSettings) {
                    await viewPage.reloadSettings(json);
                } else {
                    showSuccess("Settings imported (reload required)");
                }
            } catch (e) {
                console.warn(e);
                showError("Failed to import settings");
            }
        };
        input.click();
    }],

    //
    ["open-link", throttleToRun(async (context: any, entityDesc: EntityDescriptor) => {
        const item = context?.items?.find?.((item) => item?.id === context?.id) || null;
        const meta = item?.meta || context?.meta?.get?.(item?.id || context?.id) || null;
        const href = meta?.href || item?.href || context?.shortcut?.href || context?.href;

        //
        if (!href) { showError("Link is missing"); return; }

        // TODO(actions/open-link): refine same-origin detection for routes that
        // should reuse the current tab instead of always opening a new context.
        const target = isSameOrigin(href) ? "_self" : "_blank";
        try {
            window?.open?.(href, target, "noopener,noreferrer");
        } catch (error) {
            console.warn(error);
            showError("Unable to open link");
        }
    }, 100)],

    //
    ["copy-link", async (context: any, entityDesc: EntityDescriptor) => {
        const item = context?.items?.find?.((item) => item?.id === context?.id) || null;
        const meta = item?.meta || context?.meta?.get?.(item?.id || context?.id) || null;
        const href = meta?.href || item?.href || context?.shortcut?.href || context?.href;
        if (!href) { showError("Nothing to copy"); return; }

        //
        try {
            await copyTextToClipboard(href);
            showSuccess("Link copied");
        } catch (error) {
            console.warn(error);
            showError("Failed to copy link");
        }
    }],

    //
    ["copy-state-desc", async (context: any)=>{
        const item = context?.items?.find?.((item) => item?.id === context?.id) || null;
        const snapshot = snapshotSpeedDialItem(item);
        if (!snapshot) {
            showError("Nothing to copy");
            return;
        }
        if (snapshot.desc && snapshot.desc.meta && snapshot.desc.action && !snapshot.desc.meta.action) {
            snapshot.desc.meta.action = snapshot.desc.action;
        }
        try {
            await copyTextToClipboard(JSOX.stringify(snapshot as any) as string);
            showSuccess("Shortcut saved to clipboard");
        } catch (error) {
            console.warn(error);
            showError("Failed to copy shortcut");
        }
    }],

    //
    ["open-view", async (context: any, entityDesc: EntityDescriptor) => {
        const item = context?.items?.find?.((item) => item?.id === context?.id) || null;
        const meta = item?.meta || context?.meta?.get?.(item?.id || context?.id) || null;
        const targetView = meta?.view || (entityDesc as any)?.view || entityDesc?.type;
        if (!targetView) {
            showError("No view target");
            return;
        }
        ensureHashNavigation(targetView, context?.viewMaker, context?.meta);
    }],

    //
    ["file-upload", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any)=>{
        viewPage = await viewPage;
        const viewer = viewPage?.querySelector("ui-file-manager");
        openPickerAndWrite(viewer?.path, 'text/markdown,text/plain,.md', true)?.then?.(() => {
            showSuccess("Uploaded");
            currentWebDav?.sync?.upload?.();
        }).catch((e) => {
            showError("Upload failed");
            console.warn(e);
        });
    }],

    //
    ["file-mount", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        const viewer = viewPage?.querySelector("ui-file-manager");
        getDirectoryHandle(null, viewer?.path, { create: true })?.then?.(async () => {
            await mountAsRoot("user", true)?.catch?.(console.warn.bind(console));
            showSuccess("Mounted");
        }).catch((e) => {
            showError("Mount failed");
            console.warn(e);
        });
    }],

    ["file-download", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        const viewer = viewPage?.querySelector("ui-file-manager");
        downloadByPath(viewer?.path)?.then?.(() => {
            showSuccess("Downloaded");
        }).catch((e) => {
            showError("Download failed");
            console.warn(e);
        });
    }],

    ["file-refresh", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        const viewer = viewPage?.querySelector("ui-file-manager");
        currentWebDav?.sync?.download?.(viewer?.path)?.then?.(() => {
            viewer?.loadPath?.(viewer?.path);
            showSuccess("Refreshed");
        }).catch((e) => {
            showError("Refresh failed");
            console.warn(e);
        });
    }],

    ["debug-gen", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        try {
            // Use debug task generation for immediate testing
            const results = await triggerDebugTaskGeneration(3); // Generate 3 debug tasks
            //viewPage?.$refresh?.();
            if (results && results.length > 0) {
                showSuccess(`Generated ${results.length} debug tasks for testing`);
            } else {
                showError(`Failed to generate debug tasks`);
            }
        } catch (error) {
            console.warn("Debug task generation failed:", error);
            showError(`Failed to generate debug tasks`);
        }
    }],

    //
    ["record-speech-recognition", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        if ((Date.now() - lastSpeechRecogTime) < 1000) {
            console.warn("Speech recognition throttled");
            return;
        }; lastSpeechRecogTime = Date.now();

        //
        viewPage = await viewPage;
        const recognition = await recordSpeechRecognition();
        if (!recognition) {
            showError("Failed to record speech recognition");
            return;
        }

        //
        const content = (await (recognition.promise as Promise<string>)?.catch?.(console.warn.bind(console)))?.trim?.() || null;
        try { recognition?.stop?.(); } catch (e) { console.warn(e); }
        if (content) {
            const response = await generateNewPlan(content);
            if (!response) { showError(`Failed to generate ${entityDesc.label}`); return; }
            showSuccess(`Plan generated...`);
        } else {
            showError("No content to generate");
        }
    }],

    //
    ["generate", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        setTimeout(async () => {
            if ((Date.now() - lastSpeechRecogTime) < 1000) {
                console.warn("Timeline generation throttled");
                return;
            }; lastSpeechRecogTime = Date.now();

            //
            viewPage = await viewPage;
            const response = await generateNewPlan();
            //viewPage?.$refresh?.();
            if (!response) {
                showError(`Failed to generate ${entityDesc.label}`);
                return;
            };
            showSuccess(`Plan generated...`);
        }, 100);
    }],

    //
    ["add", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        try {
            const result = await makeEntityEdit(entityItem, entityDesc, {
                allowLinks: true,
                entityType: entityDesc.type,
                description: `Describe the ${entityDesc.label} and link related entities (actions, bonuses, etc.).`
            });
            if (!result) return;

            //
            const fileName = (`${entityDesc.type}-${crypto.randomUUID()}`).replace(/\s+/g, "-").toLowerCase();
            const fname = (fileName || entityDesc.type || "unknown")?.toString?.()?.toLowerCase?.()?.replace?.(/\s+/g, '-')?.replace?.(/[^a-z0-9_\-+#&]/g, '-')?.trim?.()?.replace?.(/\/\/+/g, "/")?.replace?.(/\/$/, "");
            const path = `${(entityDesc.DIR || "/")}${fname}.json`.trim()?.replace?.(/\/\/+/g, "/")?.replace?.(/\/$/, ""); (result as any).__path = path;
            const file = new File([JSOX.stringify(result as any) as string], `${fname}.json`.trim()?.replace?.(/\/\/+/g, "/")?.replace?.(/\/$/, ""), { type: "application/json" });
            await writeFileSmart(null, path, file, { ensureJson: true, sanitize: true });
            showSuccess(`${entityDesc.label} saved`);
        } catch (e) {
            console.warn(e);
            showError(`Failed to save ${entityDesc.label}`);
        }
    }],

    //
    ["upload", async (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor, viewPage?: any) => {
        viewPage = await viewPage;
        try {
            await openPickerAndAnalyze(entityDesc.DIR || "/", 'text/markdown,text/plain,.json,image/*', true);
            showSuccess(`${entityDesc.label} uploaded`);
        } catch (e) {
            console.warn(e);
            showError(`Failed to upload ${entityDesc.label}`);
        }
    }],

    //
    ["paste-and-analyze", async () => {
        try {
            const success = await pasteAndAnalyze()?.catch?.(console.warn.bind(console));
            if (!success) { showError("Failed to paste and recognize"); return false; }
            showSuccess("Pasted data for analyze"); return true;
        } catch (e) { console.warn(e); showError("Failed to paste and recognize"); }
    }],

    //
    ["snip-and-recognize", async () => {
        // TODO(actions/snip-and-recognize): connect this shortcut to the CRX
        // rectangle/snipping flow instead of leaving the placeholder error.
        showError("Snip and analyze is not implemented yet");
        return false;
    }]
]);

//
const registerNavigationActions = ()=>{
    NAVIGATION_SHORTCUTS.forEach((shortcut)=>{
        const actionId = `open-view-${shortcut.view}`;
        if (!iconsPerAction.has(actionId)) {
            iconsPerAction.set(actionId, shortcut.icon);
        }
        if (!labelsPerAction.has(actionId)) {
            labelsPerAction.set(actionId, ()=>`Open ${shortcut.label}`);
        }
        if (!actionRegistry.has(actionId)) {
            actionRegistry.set(actionId, async (context: any)=>{
                const nextContext = context || {};
                nextContext.meta = { ...(nextContext.meta || {}), view: shortcut.view };
                return actionRegistry.get("open-view")?.(nextContext, {
                    label: shortcut.label,
                    type: shortcut.view,
                    DIR: "/"
                } as any);
            });
        }
    });
};

registerNavigationActions();

import { parseJsonSafely, writeFileSmart } from "fest/lure";
import { getClipboardRw, handleDataTransferFiles, normalizePayload, writeMarkDown, type IntakeOptions, type shareTargetFormData } from "../store/FileSystem";

// one of handler
export const postCommitAnalyze = async (payload: shareTargetFormData, API_ENDPOINT = '/commit-analyze') => {
    const fd = new FormData();
    if (payload.text) fd.append('text', payload.text);
    if (payload.url) fd.append('url', payload.url);
    if (payload.file) fd.append('files', payload.file as any, (payload.file as any)?.name || 'pasted');

    //
    const resp = await fetch(API_ENDPOINT, { method: 'POST', priority: 'auto', keepalive: true, body: fd })?.catch?.(console.warn.bind(console)); if (!resp) return [];
    const json = parseJsonSafely(await resp?.text?.()?.catch?.(console.warn.bind(console)) || "{}"); if (!json) return [];
    return json?.results?.map?.((res) => res?.data)?.filter?.((data) => (!!data?.trim?.()));
};

//
export const postCommitRecognize = (targetDir: string = "/docs/preferences/") => {
    return async (payload: shareTargetFormData, API_ENDPOINT = '/commit-recognize') => {
        const fd = new FormData();
        if (payload.text) fd.append('text', payload.text);
        if (payload.url) fd.append('url', payload.url);
        if (payload.file) fd.append('files', payload.file as any, (payload.file as any)?.name || 'pasted');
        fd.append('targetDir', targetDir);

        //
        const resp = await fetch(API_ENDPOINT, { method: 'POST', priority: 'auto', keepalive: true, body: fd })?.catch?.(console.warn.bind(console));
        if (!resp) return [];
        const json = parseJsonSafely(await resp?.text?.()?.catch?.(console.warn.bind(console)) || "{}");
        if (!json) return [];
        return json?.results?.filter?.((data) => (!!data?.data?.trim?.()))?.map?.((res) => res?.data);
    }
}




//
const writeTextDependsByPossibleType = async (payload: string | null | undefined, entityType: string) => {
    if (!payload) return;
    if (canParseURL(payload || "")) payload = (await fetch(payload).then(res => res.text())?.catch?.(console.warn.bind(console))) || "";
    if (!payload) return;

    //
    let json = {} as any;
    json = parseJsonSafely(payload || "{}");
    if (!json) return;

    //
    try {
        if (!entityType) entityType = detectEntityTypeByJSON(json);
        return writeJSON(json, (entityType == 'task' || entityType == 'timeline') ? '/timeline/' : `data/${entityType}/`);
    } catch (e) {
        return writeMarkDown(payload, `docs/${entityType}/`);
    }
}

/** Persist JSON-like entities using the repo's entity-id and directory conventions. */
export const writeJSON = async (data: any | any[], dir: any | null = null) => {
    if (!data) return;
    const writeOne = async (obj: any, index = 0) => {
        if (!obj) return;
        obj = parseJsonSafely(obj);
        if (!obj) return;

        // if entity type is not registered, trying to detect it
        const entityType = obj?.type ?? detectEntityTypeByJSON(obj) ?? "unknown";

        // if directory is not provided, using default directory
        if (!dir) dir = suitableDirsByEntityTypes([entityType])?.[0]; dir = dir?.trim?.();
        let fileName = (fixEntityId(obj) || obj?.name || `${Date.now()}`)?.toString?.()?.toLowerCase?.()?.replace?.(/\s+/g, '-')?.replace?.(/[^a-z0-9_\-+#&]/g, '-');
        fileName = fileName?.trim?.(); fileName = fileName?.endsWith?.(".json") ? fileName : (fileName + ".json");
        return writeFileSmart(null, `${dir}${fileName}`, new File([JSOX.stringify(obj as any) as string], fileName, { type: 'application/json' }))?.catch?.(console.warn.bind(console));
    };

    //
    let results: any = await (Array.isArray(data) ? Promise.all(data.map((item, index) => writeOne(item, index))) : writeOne(data, 0))?.catch?.(console.warn.bind(console));
    if (typeof document !== "undefined")
        document?.dispatchEvent?.(new CustomEvent("rs-fs-changed", { detail: results, bubbles: true, composed: true, cancelable: true, }));
    return results;
}


//
export const controlChannel = new BroadcastChannel('rs-sw');
controlChannel.addEventListener('message', (event: MessageEvent) => {
    const payload = event?.data as any;
    if (!payload || (payload?.type !== 'commit-result' && payload?.type !== 'commit-to-clipboard')) return;
    if (payload?.type === 'commit-result') {
        flushQueueIntoOPFS?.()?.then?.(() => {
            void notifyFsToast("success", "Data has been saved to the filesystem.");
        })?.catch?.((e) => {
            console.warn("Failed to save data to filesystem.", e, payload);
            void notifyFsToast("error", "Failed to save data to filesystem.");
        });
    } else
        if (payload?.type === 'commit-to-clipboard') {
            const data = payload?.results
                ?.map?.((result: any) => extractRecognizedData(result?.data?.recognized_data || result?.data))
                ?.filter?.((result: any) => (result && typeof result === "string"))?.join?.("\n") || "";
            if (data?.trim?.()) {
                navigator?.clipboard?.writeText?.(data)?.then?.(() => {
                    void notifyFsToast("success", "Data has been copied to clipboard.");
                })?.catch?.((e) => {
                    console.warn("Failed to copy data to clipboard.", e, data);
                    void notifyFsToast("error", "Failed to copy data to clipboard. Data is not copied.");
                });
            } else
                { void notifyFsToast("error", "Failed to copy data to clipboard. Data is empty."); }
        }
});

const warnUnlessAbort = (e: unknown) => {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
    if (name === "AbortError") return;
    console.warn(e);
};

//
export async function flushQueueIntoOPFS() {
    const results = await dumpAndClear();
    return Promise.all(results.map((result) => {
        const { data, name, dataType, directory } = result as any;
        if (dataType === "json") {
            let jsonData = parseJsonSafely(data);
            if (!jsonData) return;
            return writeJSON(jsonData, directory?.trim?.());
        } else {
            return writeMarkDown(data, directory?.trim?.() + name?.trim?.());
        }
    }));
}

//
// Entity-id migration touches OPFS on import; skip in dev to speed boot and avoid AbortError spam when SW/HMR reloads.
if (isViteProd) {
    try {
        opfsModifyJson({
            dirPath: "/data/",
            transform: (data) => {
                if (data && typeof data === "object") {
                    fixEntityId(data, { mutate: true });
                }
                return data;
            },
        })?.catch?.(warnUnlessAbort);
    } catch (e) {
        warnUnlessAbort(e);
    }

    try {
        opfsModifyJson({
            dirPath: "/timeline/",
            transform: (data) => {
                if (data && typeof data === "object") {
                    fixEntityId(data, { mutate: true });
                }
                return data;
            },
        })?.catch?.(warnUnlessAbort);
    } catch (e) {
        warnUnlessAbort(e);
    }
}



//
export const writeTimelineTask = async (task: any) => {
    const name = task?.id || task?.name || task?.desc?.name || `${Date.now()}`;

    //
    let fileName = name || "timeline.json"
    fileName = fileName?.endsWith?.(".json") ? fileName : (fileName + ".json");

    //
    const filePath = `${TIMELINE_DIR}${fileName}`;
    const file = new File([JSOX.stringify(task as any) as string], fileName, { type: 'application/json' });
    return writeFileSmart(null, filePath, file)?.catch?.(console.error.bind(console));
}

//
export const writeTimelineTasks = async (tasks: any[]) => {
    return Promise.all(tasks?.map?.(async (task) => writeTimelineTask(task)) || []);
}

//
export const loadAllTimelines = async (DIR: string = TIMELINE_DIR) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = await getDirectoryHandle(null, DIR)?.catch?.(console.warn.bind(console));
    const timelines = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return (await Promise.all(timelines?.map?.(async ([name, fileHandle]: any) => {
        if (name?.endsWith?.(".crswap")) return;
        if (!name?.trim?.()?.endsWith?.(".json")) return;

        //
        const file = await fileHandle.getFile();
        let item = null
        item = parseJsonSafely(await file?.text?.() || "{}");
        if (!item) return;
        (item as any).__name = name;
        (item as any).__path = `${DIR}${name}`;
        return item;
    })))?.filter?.((e) => e);
}


/** Open a picker and route the selected files into the recognition pipeline. */
export const openPickerAndRecognize = async (dir: string, accept = "*/*", multiple = true) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    (input as any).multiple = multiple;
    const result = await new Promise<void>((resolve) => {
        input.onchange = async () => {
            dir = dir?.trim?.();
            dir = dir?.endsWith?.('/') ? dir : (dir + '/');
            try { resolve(await handleDataTransferFiles(input.files || ([] as any), postCommitRecognize(dir))); }
            catch { resolve(); }
        };
        input.click();
    });
    return result;
}


// Try recover from previous session (prod: avoids dev OPFS churn + AbortError noise during HMR/SW reloads)
if (
    isViteProd &&
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage.getDirectory === "function"
) {
    if (typeof requestIdleCallback === "function") {
        requestIdleCallback?.(() => {
            flushQueueIntoOPFS();
        });
    } else {
        setTimeout(() => {
            flushQueueIntoOPFS();
        }, 1000);
    }
}

//
export const sendToEntityPipeline = async (payload: shareTargetFormData, options: IntakeOptions = {}) => {
    const entityType = options.entityType || DEFAULT_ENTITY_TYPE;
    const normalized = await normalizePayload(payload);
    const next = options.beforeSend ? await options.beforeSend(normalized) : normalized;
    if (!next.file && (next.text || next.url)) return writeTextDependsByPossibleType(next.text || next.url, entityType);
    return handleDataTransferFiles(next.file ? [next.file] : [], postCommitAnalyze);
};

//
export const pasteAndAnalyze = async () => {
    try {
        const { readText } = await getClipboardRw();
        // clipboard first (read raw items)
        if (typeof navigator !== "undefined" && (navigator.clipboard as any)?.read) {
            const items = await (navigator.clipboard as any).read();
            for (const item of items) {
                for (const type of item.types) {
                    const blob = await item.getType(type);
                    if (blob) {
                        const data = await postCommitAnalyze({file: blob as any})?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
                        if (data) { return true; }
                    }
                }
            }
        }

        // text fallback
        const readResult = await readText();
        const text = readResult.ok ? String(readResult.data || "").trim() : "";
        if (text) {
            const data = await postCommitAnalyze({text})?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
            if (data) { return true; }
        }
    } catch (e) { console.warn(e); return false; }
    return false;
}

/** Open a picker and route the selected files into the analyze pipeline. */
export const openPickerAndAnalyze = async (dir: string, accept = "*/*", multiple = true) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    (input as any).multiple = multiple;
    const result = await new Promise<void>((resolve) => {
        input.onchange = async () => {
            dir = dir?.trim?.();
            dir = dir?.endsWith?.('/') ? dir : (dir + '/');
            try { resolve(await handleDataTransferFiles(input.files || ([] as any), postCommitAnalyze)); }
            catch { resolve(); }
        };
        input.click();
    });
    return result;
}

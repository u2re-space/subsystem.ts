/**
 * High-level app filesystem helpers for OPFS/user-scope content workflows.
 *
 * This module sits above the lower-level write helpers and exposes the
 * convenience operations used by share-target flows, recognition/analyze
 * pipelines, markdown/json persistence, and timeline/entity storage.
 */
import { canParseURL } from "core/utils";
import { BASE64_PREFIX, convertImageToJPEG, MAX_BASE64_SIZE } from "core/workers/ImageProcess";
import { getJSONFromFile, getMarkDownFromFile, writeFileSmart } from "fest/lure";

const viteEnv = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
const isViteProd = Boolean(viteEnv?.PROD);

/** Dynamic-only: static `fest/lure` pulls `com-app` into the MV3 service worker graph. */
type LureFs = Pick<
    typeof import("fest/lure"),
    "getDirectoryHandle" | "getFileHandle" | "decodeBase64ToBytes" | "stringToFile" | "parseDataUrl"
>;
let lureFsPromise: Promise<LureFs> | null = null;
const getLureFs = (): Promise<LureFs> => {
    if (!lureFsPromise) {
        lureFsPromise = import("fest/lure").then((m) => ({
            getDirectoryHandle: m.getDirectoryHandle,
            getFileHandle: m.getFileHandle,
            decodeBase64ToBytes: m.decodeBase64ToBytes,
            stringToFile: m.stringToFile,
            parseDataUrl: m.parseDataUrl,
        }));
    }
    return lureFsPromise;
};

//
/*
// Always writes by full sanitized path. Accepts a directory or a full path.
export const writeFileSmart = async (
    root: any | null,
    dirOrPath: string,
    file: File | Blob,
    options: WriteSmartOptions = {}
) => {
    const { forceExt, ensureJson, toLower = true, sanitize = true } = options;

    // Determine desired base name and directory
    let raw = String(dirOrPath || "").trim();
    const isDirHint = raw.endsWith('/');
    const hasFileToken = !isDirHint && splitPath(raw).length > 0 && raw.includes('.');

    let dirPath = isDirHint ? raw : (hasFileToken ? raw.split('/').slice(0, -1).join('/') : raw);
    let desiredName = hasFileToken ? raw.split('/').pop() || '' : (file as any)?.name || '';

    // Fallbacks
    dirPath = dirPath || '/';
    desiredName = desiredName || (Date.now() + '');

    // Extract name/ext
    const lastDot = desiredName.lastIndexOf('.');
    let base = lastDot > 0 ? desiredName.slice(0, lastDot) : desiredName;
    let ext = (forceExt || (ensureJson ? 'json' : (lastDot > 0 ? desiredName.slice(lastDot + 1) : inferExtFromMime((file as any)?.type || '')))) || '';

    if (sanitize) {
        dirPath = sanitizePathSegments(dirPath);
        base = toSlug(base, toLower);
    }

    const finalName = ext ? `${base}.${ext}` : base;
    const fullPath = ensureDir(dirPath) + finalName;

    // Ensure File object with correct name
    let toWrite: File;
    if (file instanceof File) {
        // If name matches and type present, keep; else recreate with corrected name
        if (file.name === finalName) {
            toWrite = file;
        } else {
            const type = (file as any).type || (ext ? `application/${ext}` : 'application/octet-stream');
            const buf = await file.arrayBuffer();
            toWrite = new File([buf], finalName, { type });
        }
    } else {
        const type = (file as any).type || (ext ? `application/${ext}` : 'application/octet-stream');
        const blob = file as Blob;
        toWrite = new File([await blob.arrayBuffer()], finalName, { type });
    }

    //
    const promised = writeFile(root, fullPath, toWrite);
    if (typeof document !== "undefined")
        document?.dispatchEvent?.(new CustomEvent("rs-fs-changed", { detail: await promised?.catch?.(console.warn.bind(console)), bubbles: true, composed: true, cancelable: true, }));
    return promised;
};*/



let clipboardRw: Pick<typeof import("core/modules/Clipboard"), "readText" | "writeText"> | null = null;
export const getClipboardRw = async () => {
    if (!clipboardRw) {
        const m = await import("core/modules/Clipboard");
        clipboardRw = { readText: m.readText, writeText: m.writeText };
    }
    return clipboardRw;
};

type AnalyzeRecognizeUnified = typeof import("core/service/service/RecognizeData").analyzeRecognizeUnified;
let analyzeRecognizeUnifiedRef: AnalyzeRecognizeUnified | null = null;
export const getAnalyzeRecognizeUnified = async (): Promise<AnalyzeRecognizeUnified> => {
    if (!analyzeRecognizeUnifiedRef) {
        const m = await import("core/service/service/RecognizeData");
        analyzeRecognizeUnifiedRef = m.analyzeRecognizeUnified;
    }
    return analyzeRecognizeUnifiedRef;
};

/** Try recognition first for non-markdown inputs, then persist the recognized result into the target directory. */
export const writeWithTryRecognize = async (dir: string, file: File) => {
    if (file?.name?.endsWith?.(".md") || file?.type?.includes?.("markdown")) {
        return writeFileSmart(null, dir, file, { sanitize: true });
    }

    //
    const analyzeRecognizeUnified = await getAnalyzeRecognizeUnified();
    const recognized = (await analyzeRecognizeUnified(file)?.catch?.(console.warn.bind(console)))?.data;
    if (recognized) {
        return writeFileSmart(null, dir, new File([recognized], file.name));
    }
}

/** Recognize clipboard content and write the recognized text back to the clipboard. */
export const pasteIntoClipboardWithRecognize = async () => {
    try {
        const analyzeRecognizeUnified = await getAnalyzeRecognizeUnified();
        const { readText, writeText } = await getClipboardRw();
        // clipboard first (read raw items)
        if (typeof navigator !== "undefined" && (navigator.clipboard as any)?.read) {
            const items = await (navigator.clipboard as any).read();
            for (const item of items) {
                for (const type of item.types) {
                    const blob = await item.getType(type);
                    if (blob) {
                        const data = await analyzeRecognizeUnified(blob)?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
                        if (data) {
                            const result = await writeText(data);
                            return result.ok;
                        }
                    }
                }
            }
        }

        // text fallback
        const readResult = await readText();
        const text = readResult.ok ? String(readResult.data || "").trim() : "";
        if (text) {
            const data = await analyzeRecognizeUnified(text)?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
            if (data) {
                const result = await writeText(data);
                return result.ok;
            }
        }
    } catch (e) { console.warn(e); return false; }
}



//
export const hasCriteriaInText = async (text: string, criteria: string[]) => {
    return criteria?.some?.(async (criterion) => text?.includes?.(criterion));
}

/** Read every JSON file from a directory-like handle or path. */
export const readJSONs = async (dir: any | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const factors = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(factors?.map?.((factor) => getJSONFromFile(factor)));
};

//
export const readJSONsFiltered = async (dir: any | null, filterFiles?: string[] | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const factors = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(factors?.map?.((factor) => getJSONFromFile(factor)));
};

//
export const readMarkDownsFiltered = async (dir: any | null, filterFiles?: string[] | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const preferences = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(preferences?.map?.(async (preferences) => (await getMarkDownFromFile(preferences)))
        ?.filter?.(async (fileData) => (!filterFiles || await hasCriteriaInText(await fileData, filterFiles))));
}

//
export const readMarkDowns = async (dir: any | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const preferences = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(preferences?.map?.((preference) => getMarkDownFromFile(preference?.[1])));
}

//
export const readOneMarkDown = async (path: string) => {
    const { getFileHandle } = await getLureFs();
    const markdown = await getFileHandle(null, path);
    if (!markdown) return "";
    if (markdown?.type?.startsWith?.("image/")) return "";
    return await markdown?.text?.();
}

//
export const suitableDirsByEntityTypes = (entityTypes: string[]) => {
    return entityTypes?.map?.((entityType) => {
        return (entityType == "timeline" || entityType == "task") ? "/timeline/" : `/data/${entityType}/`;
    });
}

/** Persist markdown content into the requested path or a default docs/preferences location. */
export const writeMarkDown = async (data: any, path: any | null = null) => {
    if (!data) return; path = path?.trim?.();
    let filename = (`${Date.now()}`?.toString?.()?.toLowerCase?.()?.replace?.(/\s+/g, '-')?.replace?.(/[^a-z0-9_\-+#&]/g, '-')?.trim?.() || `${Date.now()}`) + ".md";

    //
    if (!path) { path = "/docs/preferences/"; } else { filename = path?.split?.('/')?.pop?.() || filename; }
    filename = filename?.endsWith?.(".md") ? filename : (filename + ".md");

    //
    let results: any = await writeFileSmart(null, path, data instanceof File ? data : new File([data], filename, { type: 'text/markdown' }))?.catch?.(console.warn.bind(console));
    if (typeof document !== "undefined")
        document?.dispatchEvent?.(new CustomEvent("rs-fs-changed", { detail: results, bubbles: true, composed: true, cancelable: true, }));
    return results;
}

//
export interface shareTargetFormData {
    text?: string;
    url?: string;
    file?: File | Blob;
}



/**
 * Normalize an incoming shared item into the handler contract used by commit,
 * analyze, and recognition pipelines.
 */
export const handleDataByType = async (item: File | string | Blob, handler: (payload: shareTargetFormData) => Promise<void>) => {
    if (typeof item === 'string') {
        if (item?.startsWith?.("data:image/") && item?.includes?.(";base64,")) {
            const { parseDataUrl, stringToFile } = await getLureFs();
            const parts = parseDataUrl(item);
            const mimeType = parts?.mimeType || "image/png";
            const file = await stringToFile(item, "clipboard-image", { mimeType, uriComponent: true });
            return handler({ url: item, file } as any);
        } else
            if (canParseURL(item)) { return handler({ url: item } as any); }
    } else
        if (item instanceof File || item instanceof Blob) {
            return handler({ file: item } as any);
        }
}

//
export const handleDataTransferFiles = async (files: (File | Blob)[] | FileList, handler: (payload: shareTargetFormData) => Promise<void>) => {
    // @ts-ignore
    for (const file of files) {
        handleDataByType(file, handler);
    }
}

//
export const handleDataTransferItemList = async (items: DataTransferItemList, handler: (payload: shareTargetFormData) => Promise<void>) => {
    // @ts-ignore
    for (const item of items) {
        handleDataByType(item as any, handler);
    }
}

//
export const handleClipboardItems = async (items: ClipboardItem[], handler: (payload: shareTargetFormData) => Promise<void>) => {
    for (const item of items) {
        for (const type of item?.types ?? []) {
            if (type.startsWith('text/')) {
                const text = await (await item?.getType?.(type))?.text?.();
                return handleDataByType(text, handler);
            }
            if (type.startsWith('image/')) {
                const blob = await item?.getType?.(type);
                return handleDataByType(blob, handler);
            }
        }
    }
}

//
export const handleDataTransferInputEvent = (dataTransfer: DataTransfer | null, handler: (payload: shareTargetFormData) => Promise<void>) => {
    const items = dataTransfer?.items;
    const files = dataTransfer?.files ?? [];

    if (items) {
        handleDataTransferItemList(items, handler);
    }

    if (files && (files?.length > 0)) {
        handleDataTransferFiles(files, handler);
    }
}

//
export type IntakeOptions = {
    entityType?: string;
    beforeSend?: (payload: shareTargetFormData) => Promise<shareTargetFormData> | shareTargetFormData;
};

//
export const normalizePayload = async (payload: shareTargetFormData): Promise<shareTargetFormData> => {
    if (payload.file instanceof File || payload.file instanceof Blob) {
        if (payload.file instanceof File && payload.file.size > MAX_BASE64_SIZE && payload.file.type.startsWith("image/")) {
            return { ...payload, file: await convertImageToJPEG(payload.file) };
        }
        return payload;
    }

    const text = payload.text || payload.url;
    if (typeof text === "string") {
        const match = text.match(BASE64_PREFIX);
        if (match && match.groups) {
            const { mime, data } = match.groups;
            const byteLen = Math.ceil((data.length * 3) / 4);
            if (byteLen > MAX_BASE64_SIZE) {
                const { decodeBase64ToBytes } = await getLureFs();
                const bytes = decodeBase64ToBytes(data, { alphabet: "base64", lastChunkHandling: "loose" });
                const blob = new Blob([bytes as unknown as ArrayBuffer], { type: mime });
                const converted = await convertImageToJPEG(blob);
                return { file: converted };
            }
        }
    }

    return payload;
};

//
export const loadTimelineSources = async (dir: string = "/docs/preferences") => {
    try {
        const { getDirectoryHandle } = await getLureFs();
        const root = await getDirectoryHandle(null, dir)?.catch(() => null);
        if (!root) return [] as string[];
        const entries = await Array.fromAsync(root.entries?.() ?? []);
        return entries
            .map((entry: any) => entry?.[0])
            .filter((name: string) => typeof name === "string" && name.trim().length)
            .map((name: string) => name.replace(/\.md$/i, ""));
    } catch (e) {
        console.warn(e);
        return [];
    }
};


//
export const extractRecognizedData = (unknownData: any) => {
    // potentially JSON string
    try { unknownData = typeof unknownData == "string" ? JSON.parse(unknownData?.trim?.() || "[]") : unknownData; } catch (e) {}
    if (unknownData?.recognized_data) { return extractRecognizedData(unknownData?.recognized_data); };

    //
    if (typeof unknownData == "string" && unknownData?.trim?.()) {
        return unknownData?.trim?.();
    } else
    if (Array.isArray(unknownData) && unknownData?.length) {
        return unknownData?.map?.((item: any) => extractRecognizedData(item))?.filter?.((item: any) => (item && typeof item === "string"))?.join?.("\n") || "";
    }
    return "";
}









import { ImageRun } from "docx";

type ParsedDataUrl = { mimeType: string; isBase64: boolean; data: string };
type BinaryAsset = { bytes: Uint8Array; mimeType: string };

function tryDecodeUriComponent(input: string): string {
    try {
        return decodeURIComponent(input);
    } catch {
        return input;
    }
}

function parseDataUrlLocal(input: string): ParsedDataUrl | null {
    const s = (input || "").trim();
    if (!s.toLowerCase().startsWith("data:")) return null;
    const m = s.match(/^data:(?<mime>[^;,]+)?(?<params>(?:;[^,]*)*?),(?<data>[\s\S]*)$/i);
    if (!m?.groups) return null;
    const mimeType = (m.groups.mime || "application/octet-stream").trim() || "application/octet-stream";
    const params = (m.groups.params || "").toLowerCase();
    const isBase64 = params.includes(";base64");
    const data = m.groups.data ?? "";
    return { mimeType, isBase64, data };
}

function decodeBase64ToBytesLocal(base64: string): Uint8Array {
    const s = (base64 || "").trim().replace(/[\r\n\s]/g, "");
    const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLen);
    const bin = typeof atob === "function" ? atob(padded) : "";
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function isBase64LikeLocal(input: string): boolean {
    const t = (input || "").trim().replace(/[\r\n\s]/g, "");
    if (!t || t.length < 8) return false;
    const normalized = t.replace(/-/g, "+").replace(/_/g, "/");
    return /^[A-Za-z0-9+/]*={0,2}$/.test(normalized);
}

function looksLikeSvgText(value: string): boolean {
    return /^\s*(<\?xml[\s\S]*?)?<svg[\s\S]*?>/i.test(value || "");
}

function mimeHintFromEncodedSource(src: string): string | undefined {
    const raw = (src || "").trim();
    if (!raw) return undefined;

    const parsed = parseDataUrlLocal(raw);
    if (parsed?.mimeType) return parsed.mimeType;

    const decoded = raw.includes("%") ? tryDecodeUriComponent(raw) : raw;
    const decodedDataUrl = parseDataUrlLocal(decoded);
    if (decodedDataUrl?.mimeType) return decodedDataUrl.mimeType;

    if (looksLikeSvgText(decoded)) return "image/svg+xml";

    // Common base64 signatures (with or without URI encoding).
    const compact = decoded.replace(/[\r\n\s]/g, "");
    if (/^iVBORw0KGgo/i.test(compact)) return "image/png";
    if (/^\/9j\//.test(compact)) return "image/jpeg";
    if (/^R0lGOD/.test(compact)) return "image/gif";
    if (/^Qk/.test(compact)) return "image/bmp";
    if (/^UklGR/i.test(compact)) return "image/webp";
    if (/^(PHN2Zy|PD94bWwg)/i.test(compact)) return "image/svg+xml";

    return undefined;
}

function sniffImageMimeFromBytes(bytes: Uint8Array): string | undefined {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x39 || bytes[4] === 0x37) &&
        bytes[5] === 0x61
    ) {
        return "image/gif";
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return "image/webp";
    }

    const head = new TextDecoder("utf-8").decode(bytes.slice(0, Math.min(bytes.length, 512))).trimStart();
    if (looksLikeSvgText(head)) return "image/svg+xml";
    return undefined;
}

function imageTypeFromMime(mime: string): "png" | "jpg" | "gif" | "bmp" | undefined {
    const m = (mime || "").toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("jpeg")) return "jpg";
    if (m.includes("jpg")) return "jpg";
    if (m.includes("gif")) return "gif";
    if (m.includes("bmp")) return "bmp";
    return undefined;
}

async function normalizeImageBinaryFromSource(src: string): Promise<BinaryAsset | null> {
    const raw = (src || "").trim();
    if (!raw) return null;

    const decoded = raw.includes("%") ? tryDecodeUriComponent(raw) : raw;
    const dataUrl = parseDataUrlLocal(raw) || parseDataUrlLocal(decoded);
    const hasEncodedPayload =
        !!dataUrl || isBase64LikeLocal(raw) || isBase64LikeLocal(decoded) || looksLikeSvgText(decoded);
    const mimeHint = mimeHintFromEncodedSource(raw);

    if (hasEncodedPayload) {
        try {
            let bytes: Uint8Array;
            let mimeType = mimeHint || "application/octet-stream";

            if (dataUrl) {
                mimeType = dataUrl.mimeType || mimeType;
                const payload = dataUrl.data || "";
                if (dataUrl.isBase64) {
                    bytes = decodeBase64ToBytesLocal(payload);
                } else {
                    const text = payload.includes("%") ? tryDecodeUriComponent(payload) : payload;
                    bytes = new TextEncoder().encode(text);
                }
            } else if (isBase64LikeLocal(raw) || isBase64LikeLocal(decoded)) {
                bytes = decodeBase64ToBytesLocal(isBase64LikeLocal(raw) ? raw : decoded);
            } else {
                bytes = new TextEncoder().encode(decoded);
            }

            mimeType = mimeType || sniffImageMimeFromBytes(bytes) || "application/octet-stream";
            if (mimeType === "application/octet-stream") {
                mimeType = sniffImageMimeFromBytes(bytes) || mimeType;
            }
            return { bytes, mimeType };
        } catch {
            // continue to fetch fallback
        }
    }

    try {
        const res = await fetch(raw);
        if (!res.ok) return null;
        const blob = await res.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType =
            blob.type || mimeHint || sniffImageMimeFromBytes(bytes) || "application/octet-stream";
        return { bytes, mimeType };
    } catch {
        return null;
    }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buf: ArrayBufferLike = bytes.buffer;
    if (buf instanceof ArrayBuffer) return buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    return ab;
}

async function rasterizeToPng(
    bytes: Uint8Array,
    mimeType: string
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
    try {
        if (typeof document === "undefined") return null;
        const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.decoding = "async";
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error("Failed to decode image"));
                image.src = url;
            });

            const width = Math.max(1, Math.round(img.naturalWidth || img.width || 600));
            const height = Math.max(1, Math.round(img.naturalHeight || img.height || 400));

            if (typeof OffscreenCanvas !== "undefined") {
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext("2d");
                if (!ctx) return null;
                ctx.drawImage(img, 0, 0, width, height);
                const pngBlob = await canvas.convertToBlob({ type: "image/png" });
                return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), width, height };
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, width, height);
            const pngBlob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, "image/png")
            );
            if (!pngBlob) return null;
            return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), width, height };
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch {
        return null;
    }
}

async function getImageSize(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }> {
    try {
        if (typeof createImageBitmap !== "function") return { width: 600, height: 400 };
        const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
        const bmp: any = await createImageBitmap(blob);
        const width = Number(bmp?.width || 600);
        const height = Number(bmp?.height || 400);
        try {
            bmp?.close?.();
        } catch {
            /* ignore */
        }
        return { width, height };
    } catch {
        return { width: 600, height: 400 };
    }
}

export function fitImageToWidth(
    width: number,
    height: number,
    maxWidth: number
): { width: number; height: number } {
    const w = Math.max(1, width || 1);
    const h = Math.max(1, height || 1);
    if (w <= maxWidth) return { width: w, height: h };
    const ratio = maxWidth / w;
    return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

export async function imageRunFromSrc(src: string, alt: string): Promise<ImageRun | null> {
    const data = await normalizeImageBinaryFromSource(src);
    if (!data) return null;

    let bytes = data.bytes;
    let mimeType = (data.mimeType || "").toLowerCase();
    let type = imageTypeFromMime(mimeType);

    // DOCX supports a subset of formats. Convert unsupported image payloads
    // (e.g. SVG/WebP/URI-encoded sources) to PNG for reliable embedding.
    if (!type) {
        const rasterized = await rasterizeToPng(bytes, mimeType || "application/octet-stream");
        if (!rasterized) return null;
        bytes = rasterized.bytes;
        mimeType = "image/png";
        type = "png";
    }

    const { width, height } = await getImageSize(bytes, mimeType);
    return new ImageRun({
        type,
        data: bytes,
        transformation: fitImageToWidth(width, height, 600),
        altText: alt ? { title: alt, description: alt, name: alt } : undefined,
    });
}

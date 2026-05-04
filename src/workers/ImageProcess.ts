// for optimize images before sending to GPT
import { decode as decodePNG } from '@jsquash/png';
import { encode as encodeJPEG } from '@jsquash/jpeg';

//
export type CropArea = { x: number, y: number, width: number, height: number }

// for optimize images before sending to GPT
export const jpegConfig = { quality: 90, progressive: false, color_space: 2, optimize_coding: true, auto_subsample: true, baseline: true };

/**
 * Convert image to JPEG with service worker compatibility
 * Only supports PNG compression in service workers due to Canvas API limitations
 */
export const convertImageToJPEG = async (image: Blob | File | any): Promise<Blob> => {
    const mimeType = image.type?.toLowerCase() || '';

    // Check if we're in a service worker (no DOM APIs available)
    const isServiceWorker = typeof globalThis === 'undefined' || !globalThis?.document;

    // For PNG files, we can use the optimized @jsquash/png decoder (works in service workers)
    if (mimeType === 'image/png') {
        try {
            const decoded = await decodePNG(await image.arrayBuffer());
            const encoded = await encodeJPEG(decoded, jpegConfig);
            return new Blob([encoded], { type: 'image/jpeg' });
        } catch (pngError) {
            console.warn('[ImageProcess] PNG decoding failed:', pngError);
            // In service worker, we can't fall back to Canvas API
            if (isServiceWorker) {
                throw new Error(`PNG conversion failed and Canvas API unavailable in service worker: ${pngError}`);
            }
        }
    }

    // For non-PNG images in service workers, we can't use Canvas API
    if (isServiceWorker) {
        console.warn('[ImageProcess] Non-PNG image compression not supported in service worker, skipping compression');
        // Return original image unchanged - size validation will happen elsewhere
        return image instanceof Blob ? image : new Blob([image], { type: mimeType });
    }

    // In main thread, use Canvas API for all other formats (JPEG, WebP, GIF, etc.)
    try {
        const bitmap = await createImageBitmap(image);

        // Create canvas with image dimensions
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }

        // Draw image to canvas
        ctx.drawImage(bitmap, 0, 0);

        // Convert to JPEG blob
        const jpegBlob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: 0.9 // 90% quality
        });

        bitmap.close();
        return jpegBlob;
    } catch (canvasError) {
        console.error('[ImageProcess] Canvas-based conversion failed:', canvasError);
        throw new Error(`Image conversion failed: ${canvasError}`);
    }
}

//
export const removeAnyDataPrefix = (b64url: string) => {
    return b64url?.replace?.('data:image/png;base64,', "")?.replace?.(/data:image\/jpeg;base64,/, "");
}

// alias for compatibility
export const removeAnyPrefix = removeAnyDataPrefix;

//
export const getMimeFromDataURL = (data_url: string) => {
    return data_url?.match?.(/data:image\/(.*);base64,/)?.[1] || "image/png";
}

//
export const ableToShowImage = async (data_url: string) => { // @ts-ignore
    const bitmap: any = await createImageBitmap(new Blob([Uint8Array.fromBase64(removeAnyDataPrefix(data_url), { alphabet: "base64" })], { type: getMimeFromDataURL(data_url) }))?.catch?.(e => { console.warn(e); return null; });
    return bitmap?.width > 0 && bitmap?.height > 0;
}

//
export const DEFAULT_ENTITY_TYPE = "bonus";
export const BASE64_PREFIX = /^data:(?<mime>[^;]+);base64,(?<data>.+)$/;
export const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10 MB

//
export const deAlphaChannel = async (src: string) => {
    //if (URL.canParse(src)) return src;

    //
    const img = new Image();
    {
        img.crossOrigin = "Anonymous";
        img.decoding = "async";
        img.src = src;
        await img.decode();
    }

    //
    const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const ctx = canvas.getContext("2d");
    ctx!.fillStyle = "white";
    ctx?.fillRect(0, 0, canvas.width, canvas.height);
    ctx?.drawImage(img, 0, 0);
    const imgData = ctx?.getImageData(0, 0, canvas.width, canvas.height);
    const arrayBuffer = await encodeWithJSquash(imgData);

    // @ts-ignore
    return arrayBuffer ? `data:image/jpeg;base64,${new Uint8Array(arrayBuffer)?.toBase64?.({ alphabet: "base64" })}` : null;
}

//
export const encodeWithJSquash = async (frameData?: VideoFrame | ImageBitmap | ImageData | null, rect?: CropArea) => {
    if (!frameData) return null;

    //
    const imageDataOptions: ImageDataSettings = {
        colorSpace: "srgb",
    }

    // @ts-ignore
    rect ??= { x: 0, y: 0, width: frameData?.width || frameData?.codedWidth || 0, height: frameData?.height || frameData?.codedHeight || 0 };

    //
    if (frameData instanceof ImageData) {
        return encodeJPEG(frameData, jpegConfig);
    } else
        if (frameData instanceof ImageBitmap) {
            const cnv = new OffscreenCanvas(rect.width, rect.height);
            const ctx = cnv.getContext("2d");
            ctx?.drawImage?.(frameData, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            const idata = ctx?.getImageData?.(0, 0, rect.width, rect.height, imageDataOptions);
            if (idata) return encodeJPEG(idata, jpegConfig);
        } else { // @ts-ignore
            const idata = new ImageData(rect.codedWidth, rect.codedHeight, imageDataOptions);
            try { frameData?.copyTo?.(idata.data, { format: "RGBA", rect }); } catch (e) { console.warn(e); }
            return encodeJPEG(idata, jpegConfig);
        }
}

import { normalizeDataAsset } from "fest/lure";
import { createProtocolEnvelope, sendProtocolMessage } from "com/core/UnifiedMessaging";

export type ViewAttachmentInput =
    | File
    | Blob
    | string
    | {
        name?: string;
        type?: string;
        mimeType?: string;
        source?: string;
        data?: File | Blob | string;
    };

export interface ViewAttachmentEnvelope {
    hash: string;
    name: string;
    mimeType: string;
    size: number;
    source: string;
    data: File;
}

const asNamePrefix = (source: string): string => {
    const normalized = String(source || "attachment")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "attachment";
};

export const normalizeIpcAttachments = async (
    inputs: ViewAttachmentInput[],
    source = "view-ipc"
): Promise<ViewAttachmentEnvelope[]> => {
    const out: ViewAttachmentEnvelope[] = [];

    for (const raw of inputs) {
        const candidate = (raw && typeof raw === "object" && "data" in raw)
            ? (raw as { data?: File | Blob | string; source?: string }).data
            : raw;
        if (!candidate) continue;

        try {
            const inferredSource = (raw && typeof raw === "object" && "source" in raw)
                ? String((raw as { source?: string }).source || source)
                : source;
            const asset = await normalizeDataAsset(candidate, {
                namePrefix: asNamePrefix(inferredSource),
                uriComponent: true
            });
            out.push({
                hash: String(asset.hash || ""),
                name: String(asset.name || asset.file?.name || "attachment"),
                mimeType: String(asset.mimeType || asset.type || asset.file?.type || "application/octet-stream"),
                size: Number(asset.size || asset.file?.size || 0),
                source: inferredSource,
                data: asset.file
            });
        } catch (error) {
            console.warn("[UniformViewTransport] Attachment normalization failed:", error);
        }
    }

    return out;
};

export const sendViewProtocolMessage = async (input: {
    type: string;
    source: string;
    destination: string;
    contentType?: string;
    data?: Record<string, unknown>;
    attachments?: ViewAttachmentInput[];
    purpose?: ("invoke" | "mail" | "attach" | "deliver" | "defer")[];
    op?: string;
    metadata?: Record<string, unknown>;
}): Promise<boolean> => {
    const attachments = await normalizeIpcAttachments(input.attachments || [], input.source);
    const data = {
        ...(input.data || {}),
        ...(attachments.length > 0 ? {
            attachments,
            file: attachments[0]?.data,
            files: attachments.map((entry) => entry.data)
        } : {})
    };

    const envelope = createProtocolEnvelope({
        type: input.type,
        source: input.source,
        destination: input.destination,
        contentType: input.contentType,
        data,
        purpose: input.purpose || (attachments.length > 0 ? ["attach", "deliver"] : ["deliver", "mail"]),
        protocol: "window",
        op: input.op || (attachments.length > 0 ? "attach" : "deliver"),
        srcChannel: input.source,
        dstChannel: input.destination,
        metadata: {
            ...(input.metadata || {}),
            attachmentCount: attachments.length
        }
    });

    return sendProtocolMessage(envelope);
};

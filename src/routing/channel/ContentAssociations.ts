import { CONTENT_TYPES } from "com/config/Names";
import {
    UNIFIED_PROCESSING_RULES,
    type AssociationOverrideFactor
} from "./UnifiedAIConfig";

export type AssociationDestination =
    | "viewer"
    | "workcenter"
    | "explorer"
    | "unknown";

export type AssociationIntent = {
    contentType: string;
    context?: string;
    processingSource?: string;
    overrideFactors?: string[];
};

export type AssociationResolution = {
    destination: AssociationDestination;
    normalizedContentType: string;
    overrideFactors: AssociationOverrideFactor[];
};

export type AssociationPipelineResolution = AssociationResolution & {
    pipeline: AssociationDestination[];
};

const normalizeContentType = (t: string): string => {
    const v = String(t || "").toLowerCase().trim();
    if (!v) return CONTENT_TYPES.OTHER;

    // Accept both unified types and free-form values.
    if (v === "md") return CONTENT_TYPES.MARKDOWN;
    if (v === "markdown") return CONTENT_TYPES.MARKDOWN;
    if (v === "txt") return CONTENT_TYPES.TEXT;
    if (v === "text") return CONTENT_TYPES.TEXT;
    if (v === "url") return CONTENT_TYPES.URL;
    if (v === "image") return CONTENT_TYPES.IMAGE;
    if (v === "file" || v === "blob") return CONTENT_TYPES.FILE;
    if (v === "pdf") return CONTENT_TYPES.PDF;
    if (v === "html") return CONTENT_TYPES.HTML;
    if (v === "json") return CONTENT_TYPES.JSON;
    if (v === "base64") return CONTENT_TYPES.FILE;

    // If it already matches one of our constants, keep it.
    const known = new Set(Object.values(CONTENT_TYPES));
    if (known.has(v as any)) return v;
    return CONTENT_TYPES.OTHER;
};

const coerceOverrideFactors = (factors: string[] | undefined): AssociationOverrideFactor[] => {
    const out: AssociationOverrideFactor[] = [];
    const list = Array.isArray(factors) ? factors : [];
    for (const f of list) {
        const v = String(f || "").trim() as AssociationOverrideFactor;
        if (!v) continue;
        out.push(v);
    }
    return out;
};

const pickExplicitDestination = (factors: AssociationOverrideFactor[]): AssociationDestination | null => {
    // Explicit routing overrides everything else (compat behavior).
    if (factors.includes("explicit-explorer")) return "explorer";
    if (factors.includes("explicit-workcenter")) return "workcenter";
    if (factors.includes("explicit-viewer")) return "viewer";
    return null;
};

const defaultDestinationForType = (normalizedContentType: string): AssociationDestination => {
    // Defaults are aligned with docs/architecture.md "Data associations".
    switch (normalizedContentType) {
        case CONTENT_TYPES.TEXT:
        case CONTENT_TYPES.MARKDOWN:
        case CONTENT_TYPES.HTML:
        case CONTENT_TYPES.JSON:
            return "viewer";
        case CONTENT_TYPES.URL:
            // URLs are often processed/recognized; prefer workcenter.
            return "workcenter";
        case CONTENT_TYPES.IMAGE:
        case CONTENT_TYPES.PDF:
        case CONTENT_TYPES.FILE:
        case CONTENT_TYPES.OTHER:
        default:
            return "workcenter";
    }
};

const mergeRuleOverrideFactors = (intent: AssociationIntent, normalizedContentType: string): AssociationOverrideFactor[] => {
    const base = coerceOverrideFactors(intent.overrideFactors);
    const src = String(intent.processingSource || "").trim();
    if (!src) return base;

    const rule = UNIFIED_PROCESSING_RULES[src];
    if (!rule) return base;

    const merged: AssociationOverrideFactor[] = [];
    merged.push(...(rule.defaultOverrideFactors || []));
    const perType = rule.associationOverrides?.[normalizedContentType] || rule.associationOverrides?.[String(intent.contentType || "")] || [];
    merged.push(...perType);
    merged.push(...base);
    return merged;
};

export function resolveAssociation(intent: AssociationIntent): AssociationResolution {
    const normalizedContentType = normalizeContentType(intent.contentType);
    const mergedFactors = mergeRuleOverrideFactors(intent, normalizedContentType);

    const explicit = pickExplicitDestination(mergedFactors);
    if (explicit) {
        return { destination: explicit, normalizedContentType, overrideFactors: mergedFactors };
    }

    return {
        destination: defaultDestinationForType(normalizedContentType),
        normalizedContentType,
        overrideFactors: mergedFactors
    };
}

export function resolveAssociationPipeline(intent: AssociationIntent): AssociationPipelineResolution {
    const primary = resolveAssociation(intent);

    const factors = primary.overrideFactors;
    const pipeline: AssociationDestination[] = [];

    // Allow explicit multi-targeting (composite behavior).
    if (factors.includes("explicit-explorer")) pipeline.push("explorer");
    if (factors.includes("explicit-workcenter")) pipeline.push("workcenter");
    if (factors.includes("explicit-viewer")) pipeline.push("viewer");

    // If no explicit fan-out, default to primary only.
    if (pipeline.length === 0) {
        pipeline.push(primary.destination);
    }

    // Force attachment/processing can add workcenter as a secondary sink even when viewing.
    if ((factors.includes("force-attachment") || factors.includes("force-processing")) && !pipeline.includes("workcenter")) {
        pipeline.push("workcenter");
    }

    // De-duplicate while preserving order.
    const unique: AssociationDestination[] = [];
    for (const d of pipeline) {
        if (!unique.includes(d)) unique.push(d);
    }

    return { ...primary, pipeline: unique };
}


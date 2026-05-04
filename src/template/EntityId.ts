// NOTE: backend-friendly minimal time parsing helpers.
// We intentionally keep this file free of heavy/browser-only dependencies (e.g. `fest/*`).
type TimeType = { timestamp?: number; iso_date?: string; date?: string };

export function parseDateCorrectly(str?: Date | TimeType | string | number | null | undefined): Date | null {
    if (str == null) return null;
    if (str instanceof Date) return Number.isFinite(str.getTime()) ? str : null;
    if (typeof str === "number") {
        const d = new Date(str);
        return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof str === "object") {
        const anyObj: any = str as any;
        if (anyObj.timestamp != null) return parseDateCorrectly(anyObj.timestamp);
        if (anyObj.iso_date != null) return parseDateCorrectly(anyObj.iso_date);
        if (anyObj.date != null) return parseDateCorrectly(anyObj.date);
    }
    if (typeof str === "string") {
        const trimmed = str.trim();
        if (!trimmed) return null;
        // Try numeric timestamp in string form
        if (/^\d+$/.test(trimmed)) {
            const num = Number(trimmed);
            const d = new Date(num);
            if (Number.isFinite(d.getTime())) return d;
        }
        const d = new Date(trimmed);
        return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
}

export function parseAndGetCorrectTime(str?: Date | TimeType | string | number | null | undefined): number {
    return parseDateCorrectly(str)?.getTime?.() ?? Date.now();
}

export type EntityLike = {
    id?: string | null;
    type?: string | null;
    kind?: string | null;
    name?: string | null;
    title?: string | null;
    properties?: Record<string, any> | null;
};

export type GenerateEntityIdOptions = {
    existingIds?: Set<string> | string[];
    fallback?: string;
    maxLength?: number;
    prefer?: Array<string | null | undefined>;
    mutateExistingIds?: boolean;
};

export type FixEntityIdOptions = GenerateEntityIdOptions & {
    mutate?: boolean;
    rebuild?: boolean; // <- добавляем
};

const DEFAULT_MAX_LENGTH = 96;
const CODE_SUFFIX_PREFIX = "CODE";

const BASIC_ALLOWED_PATTERN = /^[a-z0-9\-_&#\+]+$/;
const CODE_ALLOWED_PATTERN = /^[a-z0-9\-_&#\+]+(?:_CODE[0-9A-Z]*)?$/;

const removeDiacritics = (value: string): string => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

const toStringOrNull = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" || typeof value === "bigint") return String(value);
    return null;
};

const slugifySegment = (segment: string | null | undefined): string => {
    if (!segment) return "";
    const withoutDiacritics = removeDiacritics(segment);
    const lowercase = withoutDiacritics.toLowerCase();
    const collapsedWhitespace = lowercase.replace(/[\s]+/g, "-");
    const sanitized = collapsedWhitespace.replace(/[^a-z0-9\-_&#\+]+/g, "-");
    const condensedHyphen = sanitized.replace(/-{2,}/g, "-").replace(/_{2,}/g, "_");
    const trimmed = condensedHyphen.replace(/^-+|-+$/g, "").replace(/^_+|_+$/g, "");
    return trimmed;
};

const sanitizeCodeSuffix = (rawCode: unknown): string => {
    const asString = toStringOrNull(rawCode);
    if (!asString) return "";
    const normalized = removeDiacritics(asString).replace(/\s+/g, "");
    const sanitized = normalized.replace(/[^A-Za-z0-9\-_&#\+]+/g, "");
    if (!sanitized) return "";
    const upper = sanitized.toUpperCase();
    return upper.startsWith(CODE_SUFFIX_PREFIX) ? upper : `${CODE_SUFFIX_PREFIX}${upper}`;
};

const isCodeSuffixAllowed = (entity: EntityLike): boolean => {
    if (!entity) return false;
    if (entity.type === "bonus") return true;
    const code = entity?.properties && (entity.properties as any)?.code;
    return typeof code === "string" && code.trim().length > 0;
};

const extractLocationName = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
        const address = (value as any).address;
        if (typeof address === "string") return address;
        if (address && typeof address === "object") {
            const parts: Array<string> = [];
            ["street", "house", "flat", "room"].forEach((key) => {
                const part = toStringOrNull((address as any)[key]);
                if (part) parts.push(part);
            });
            if (parts.length > 0) return parts.join("-");
        }
        const coordinate = (value as any).coordinate;
        if (coordinate && typeof coordinate === "object") {
            const lat = toStringOrNull((coordinate as any).latitude);
            const lon = toStringOrNull((coordinate as any).longitude);
            if (lat && lon) return `${lat}-${lon}`;
        }
        const name = toStringOrNull((value as any).name);
        if (name) return name;
        const title = toStringOrNull((value as any).title);
        if (title) return title;
    }
    return null;
};

const pushSegment = (collector: Set<string>, value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
        value.forEach((item) => pushSegment(collector, item));
        return;
    }
    const stringValue = typeof value === "object" ? extractLocationName(value) : toStringOrNull(value);
    const slug = slugifySegment(stringValue);
    if (slug) collector.add(slug);
};

const prepareExistingSet = (existing?: Set<string> | string[]): Set<string> | undefined => {
    if (!existing) return undefined;
    if (existing instanceof Set) return existing;
    return new Set(existing);
};

const composeId = (base: string, codeSuffix?: string, numericSuffix?: number): string => {
    const suffixPart = numericSuffix != null ? `-${numericSuffix}` : "";
    if (codeSuffix) {
        if (base) return `${base}_${codeSuffix}${suffixPart}`;
        return `${codeSuffix}${suffixPart}`;
    }
    return `${base}${suffixPart}`;
};

const clampBaseLength = (base: string, maxLength: number, reservedLength: number): string => {
    if (!base) return base;
    if (base.length + reservedLength <= maxLength) return base;
    const available = Math.max(0, maxLength - reservedLength);
    if (available === 0) return "";
    const truncated = base.slice(0, available);
    return truncated.replace(/[-_]+$/g, "");
};

const ensureUniqueId = (
    base: string,
    codeSuffix: string,
    existing: Set<string> | undefined,
    maxLength: number
): string => {
    const initial = composeId(base, codeSuffix);
    if (!existing || !existing.has(initial)) return initial;

    let attempt = 2;
    while (attempt < 10_000) {
        const candidate = composeId(base, codeSuffix, attempt);
        if (!existing.has(candidate)) return candidate;
        attempt += 1;
    }
    return initial;
};

const sanitizeExistingIdValue = (value: string, allowCodeSuffix: boolean, maxLength: number): string => {
    if (!value) return "";
    let working = removeDiacritics(value);
    working = working.replace(/[\s]+/g, "-");

    let codeSuffix = "";
    if (allowCodeSuffix) {
        const match = working.match(/(_CODE[0-9A-Za-z]*)$/i);
        if (match) {
            codeSuffix = sanitizeCodeSuffix(match[0].slice(1));
            working = working.slice(0, match.index ?? 0);
        }
    }

    const base = slugifySegment(working);
    const sanitizedBase = base ? base : "";

    if (!sanitizedBase && !codeSuffix) return "";

    const reservedLength = codeSuffix ? codeSuffix.length + (sanitizedBase ? 1 : 0) : 0;
    const clampedBase = clampBaseLength(sanitizedBase, maxLength, reservedLength);

    const candidate = composeId(clampedBase, codeSuffix || undefined);
    return candidate;
};

export const isValidEntityId = (value: string | null | undefined, allowCodeSuffix = false): boolean => {
    if (!value) return false;
    return allowCodeSuffix ? CODE_ALLOWED_PATTERN.test(value) : BASIC_ALLOWED_PATTERN.test(value);
};

const collectBaseSegments = (entity: EntityLike, options?: GenerateEntityIdOptions): string[] => {
    const segments = new Set<string>();
    if (!entity) return [];

    options?.prefer?.forEach((candidate) => pushSegment(segments, candidate));

    if (entity.type === "person") {
        const biography = (entity.properties as any)?.biography ?? {};
        const nameParts = [
            toStringOrNull(biography?.firstName),
            toStringOrNull(biography?.middleName),
            toStringOrNull(biography?.lastName)
        ].filter(Boolean);
        if (nameParts.length > 0) {
            pushSegment(segments, nameParts.join("-"));
        }
        pushSegment(segments, biography?.nickName);
        const jobs = (entity.properties as any)?.jobs;
        if (jobs) pushSegment(segments, Array.isArray(jobs) ? jobs[0] : jobs);
    }

    if (entity.type === "bonus") {
        const usableFor = (entity.properties as any)?.usableFor;
        const usableIn = (entity.properties as any)?.usableIn;
        if (usableFor) pushSegment(segments, Array.isArray(usableFor) ? usableFor[0] : usableFor);
        if (usableIn) pushSegment(segments, Array.isArray(usableIn) ? usableIn[0] : usableIn);
    }

    pushSegment(segments, entity.name);
    pushSegment(segments, entity.title);
    pushSegment(segments, entity.kind);
    pushSegment(segments, entity.type);

    if (segments.size === 0) {
        pushSegment(segments, options?.fallback ?? entity.type ?? "entity");
    }

    pushSegment(segments, entity.properties?.begin_time ? (parseDateCorrectly?.(entity.properties?.begin_time)?.toLocaleString?.("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    })?.trim()?.toLowerCase?.()
        ?.replace?.(/\s+/g, '_')
        ?.replace?.(/[\,\-\_\:\.\\\/]/g, '-')
        ?.replace?.(/[\"\'\(\)\[\]]/g, '')
        ?.replace?.(/\-\-/g, '_')) : null);

    //
    return Array.from(segments).filter((segment) => segment.length > 0);
};

export const generateEntityId = (entity: EntityLike, options: GenerateEntityIdOptions = {}): string => {
    const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
    const allowCodeSuffix = isCodeSuffixAllowed(entity);
    const codeSuffix = allowCodeSuffix ? sanitizeCodeSuffix((entity.properties as any)?.code) : "";

    const segments = collectBaseSegments(entity, options);
    const base = segments.join("_");

    const reservedLength = codeSuffix ? codeSuffix.length + (base ? 1 : 0) : 0;
    const clampedBase = clampBaseLength(base, maxLength, reservedLength);

    const existingSet = prepareExistingSet(options.existingIds);
    const candidate = ensureUniqueId(clampedBase, codeSuffix, existingSet, maxLength);

    if (options.mutateExistingIds && existingSet) {
        existingSet.add(candidate);
    }

    return candidate;
};

export const fixEntityId = <T extends EntityLike>(
    entity: T,
    options: FixEntityIdOptions = { mutate: true, rebuild: true }
): string => {
    const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
    const allowCodeSuffix = isCodeSuffixAllowed(entity);
    const existingSet = prepareExistingSet(options.existingIds);

    const forceRebuild = options.rebuild === true;

    let currentId = toStringOrNull(entity?.id) ?? "";
    let sanitizedId = sanitizeExistingIdValue(currentId, allowCodeSuffix, maxLength);

    // Если просили пересобрать или текущий id пуст/невалидный — генерим заново
    if (forceRebuild || !sanitizedId || !isValidEntityId(sanitizedId, allowCodeSuffix)) {
        sanitizedId = generateEntityId(entity, { ...options, existingIds: existingSet });
    }

    // Гарантируем уникальность
    if (existingSet && existingSet.has(sanitizedId)) {
        const baseWithoutNumeric = sanitizedId.replace(/(?:-[0-9]+)?$/, "");
        const baseWithoutCode = allowCodeSuffix ? baseWithoutNumeric.replace(/_CODE[0-9A-Z]*$/i, "") : baseWithoutNumeric;
        sanitizedId = ensureUniqueId(
            baseWithoutCode,
            allowCodeSuffix ? sanitizeCodeSuffix((entity.properties as any)?.code) : "",
            existingSet,
            maxLength
        );
    }

    if (options.mutateExistingIds && existingSet) existingSet.add(sanitizedId);
    if (options.mutate !== false && entity) (entity as any).id = sanitizedId;

    return sanitizedId;
};
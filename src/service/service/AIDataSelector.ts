import { decode, encode } from "@toon-format/toon";
import { type DataFilter } from "../model/GPT-Config";
import { parseAIResponseSafe } from "core/document/AIResponseParser";
import { getGPTInstance } from "../shared/gpt-utils";
import type { AIConfig } from "../shared/types";

export type { AIConfig };

export type SearchMode = "exact" | "fuzzy" | "semantic" | "ai";
export type SortDirection = "asc" | "desc";

export type SearchQuery = {
	terms: string[];
	mode?: SearchMode;
	fields?: string[];
	boost?: Record<string, number>;
	minScore?: number;
};

export type FilterGroup = {
	logic: "and" | "or";
	filters: (DataFilter | FilterGroup)[];
};

export type SortCriteria = {
	field: string;
	direction: SortDirection;
	nullsFirst?: boolean;
};

export type SelectionOptions = {
	filters?: DataFilter[];
	filterGroups?: FilterGroup[];
	search?: SearchQuery;
	sort?: SortCriteria[];
	limit?: number;
	offset?: number;
	distinct?: boolean;
	fields?: string[];
};

export type SelectionResult<T = any> = {
	ok: boolean;
	items: T[];
	total: number;
	stats: SelectionStats;
	suggestions?: string[];
	error?: string;
};

export type SelectionStats = {
	totalScanned: number;
	matchedByFilter: number;
	matchedBySearch: number;
	filtered: number;
	executionTimeMs: number;
};

export type SimilarityResult<T = any> = {
	item: T;
	score: number;
	matchedFields: string[];
	explanation?: string;
};

export type GroupedResult<T = any> = {
	key: any;
	items: T[];
	count: number;
	aggregates?: Record<string, any>;
};

//
const applyLocalFilter = (item: any, filter: DataFilter): boolean => {
    const getNestedValue = (obj: any, path: string): any => {
        return path.split(".").reduce((current, key) =>
            current?.[key], obj
        );
    };

    const value = getNestedValue(item, filter.field);
    const targetValue = filter.value;
    const caseSensitive = filter.caseSensitive ?? false;

    const normalize = (v: any) =>
        caseSensitive || typeof v !== "string" ? v : v.toLowerCase();

    switch (filter.operator) {
        case "eq":
            return normalize(value) === normalize(targetValue);
        case "neq":
            return normalize(value) !== normalize(targetValue);
        case "contains":
            return String(normalize(value)).includes(String(normalize(targetValue)));
        case "startsWith":
            return String(normalize(value)).startsWith(String(normalize(targetValue)));
        case "endsWith":
            return String(normalize(value)).endsWith(String(normalize(targetValue)));
        case "gt":
            return value > targetValue;
        case "lt":
            return value < targetValue;
        case "gte":
            return value >= targetValue;
        case "lte":
            return value <= targetValue;
        case "in":
            return Array.isArray(targetValue) && targetValue.some(t => normalize(value) === normalize(t));
        case "nin":
            return Array.isArray(targetValue) && !targetValue.some(t => normalize(value) === normalize(t));
        case "exists":
            return targetValue ? value !== undefined && value !== null : value === undefined || value === null;
        case "regex":
            try {
                const flags = caseSensitive ? "" : "i";
                return new RegExp(targetValue, flags).test(String(value));
            } catch { return false; }
        default:
            return true;
    }
}

//
const applyFilterGroup = (item: any, group: FilterGroup): boolean => {
    const results = group.filters.map(f => {
        if ("logic" in f) {
            return applyFilterGroup(item, f);
        }
        return applyLocalFilter(item, f);
    });

    return group.logic === "and"
        ? results.every(Boolean)
        : results.some(Boolean);
}

//
const calculateSimpleScore = (item: any, query: SearchQuery): number => {
    if (!query.terms?.length) return 1;

    const searchFields = query.fields || ["name", "title", "description", "id"];
    let totalScore = 0;
    let matchCount = 0;

    for (const term of query.terms) {
        const lowerTerm = term.toLowerCase();

        for (const field of searchFields) {
            const value = String(item?.[field] || "").toLowerCase();
            const boost = query.boost?.[field] || 1;

            if (value === lowerTerm) {
                totalScore += 1 * boost;
                matchCount++;
            } else if (value.includes(lowerTerm)) {
                totalScore += 0.5 * boost;
                matchCount++;
            } else if (value.startsWith(lowerTerm)) {
                totalScore += 0.7 * boost;
                matchCount++;
            }
        }
    }

    return matchCount > 0 ? totalScore / query.terms.length : 0;
}

//
export const selectData = async <T = any>(
    data: T[],
    options: SelectionOptions = {}
): Promise<SelectionResult<T>> => {
    const startTime = performance.now();

    const result: SelectionResult<T> = {
        ok: true,
        items: [],
        total: 0,
        stats: {
            totalScanned: data.length,
            matchedByFilter: 0,
            matchedBySearch: 0,
            filtered: 0,
            executionTimeMs: 0
        }
    };

    try {
        let filtered = [...data];

        // Apply filters
        if (options.filters?.length) {
            filtered = filtered.filter(item =>
                options.filters!.every(f => applyLocalFilter(item, f))
            );
            result.stats.matchedByFilter = filtered.length;
        }

        // Apply filter groups
        if (options.filterGroups?.length) {
            filtered = filtered.filter(item =>
                options.filterGroups!.every(g => applyFilterGroup(item, g))
            );
        }

        // Apply search
        if (options.search?.terms?.length) {
            const mode = options.search.mode || "fuzzy";
            const minScore = options.search.minScore || 0.1;

            if (mode === "ai" || mode === "semantic") {
                // Use AI for semantic search
                const aiResult = await aiSemanticSearch(filtered, options.search);
                if (aiResult.ok) {
                    filtered = aiResult.items;
                    result.stats.matchedBySearch = filtered.length;
                }
            } else {
                // Local search scoring
                const scored = filtered.map(item => ({
                    item,
                    score: calculateSimpleScore(item, options.search!)
                })).filter(s => s.score >= minScore);

                scored.sort((a, b) => b.score - a.score);
                filtered = scored.map(s => s.item);
                result.stats.matchedBySearch = filtered.length;
            }
        }

        // Apply distinct
        if (options.distinct) {
            const seen = new Set();
            filtered = filtered.filter(item => {
                const key = encode(item, { indent: 2 });
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        // Apply sorting
        if (options.sort?.length) {
            filtered.sort((a, b) => {
                for (const sort of options.sort!) {
                    const aVal = a?.[sort.field as keyof T];
                    const bVal = b?.[sort.field as keyof T];

                    // Handle nulls
                    if (aVal == null && bVal == null) continue;
                    if (aVal == null) return sort.nullsFirst ? -1 : 1;
                    if (bVal == null) return sort.nullsFirst ? 1 : -1;

                    // Compare
                    let cmp = 0;
                    if (typeof aVal === "string" && typeof bVal === "string") {
                        cmp = aVal.localeCompare(bVal);
                    } else {
                        cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                    }

                    if (cmp !== 0) {
                        return sort.direction === "desc" ? -cmp : cmp;
                    }
                }
                return 0;
            });
        }

        result.total = filtered.length;
        result.stats.filtered = filtered.length;

        // Apply pagination
        const offset = options.offset || 0;
        const limit = options.limit || filtered.length;
        filtered = filtered.slice(offset, offset + limit);

        // Select fields
        if (options.fields?.length) {
            filtered = filtered.map(item => {
                const selected: any = {};
                for (const field of options.fields!) {
                    const value = field.split(".").reduce(
                        (obj, key) => obj?.[key],
                        item as any
                    );
                    selected[field] = value;
                }
                return selected as T;
            });
        }

        result.items = filtered;

    } catch (e) {
        console.error("Error in selectData:", e);
        result.ok = false;
        result.error = String(e);
    }

    result.stats.executionTimeMs = performance.now() - startTime;
    return result;
}

//
export const aiSemanticSearch = async <T = any>(
    data: T[],
    query: SearchQuery,
    config?: AIConfig
): Promise<SelectionResult<T>> => {
    const result: SelectionResult<T> = {
        ok: false,
        items: [],
        total: 0,
        stats: {
            totalScanned: data.length,
            matchedByFilter: 0,
            matchedBySearch: 0,
            filtered: 0,
            executionTimeMs: 0
        }
    };

    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            result.error = "No GPT instance available";
            return result;
        }

        await gpt.giveForRequest(`
Data set to search (${data.length} items):
\`\`\`toon
${encode(data.slice(0, 100), { indent: 2 })}
\`\`\`
${data.length > 100 ? `\n... and ${data.length - 100} more items` : ""}
        `);

        await gpt.askToDoAction(`
Semantic search query:
Terms: ${query.terms.join(", ")}
${query.fields?.length ? `Focus fields: ${query.fields.join(", ")}` : ""}
${query.minScore ? `Minimum relevance score: ${query.minScore}` : ""}

Find items that semantically match the search terms.
Consider:
- Synonyms and related concepts
- Contextual meaning
- Partial matches
- Field importance${query.boost ? ` (boosted: ${Object.keys(query.boost).join(", ")})` : ""}

Return:
\`\`\`json
{
    "matched_indices": [0, 2, 5, ...],
    "scores": [0.95, 0.82, 0.71, ...],
    "explanations": ["...", "...", ...]
}
\`\`\`
        `);

        const raw = await gpt.sendRequest("medium", "low", null, {
            responseFormat: "json",
            temperature: 0.3
        });

        if (!raw) {
            result.error = "No AI response";
            return result;
        }

        const parsed = parseAIResponseSafe<any>(raw);
        if (!parsed?.ok) {
            result.error = parsed?.error || "Failed to parse AI response";
            return result;
        }
        const indices = parsed?.data?.matched_indices || [];
        const scores = parsed?.data?.scores || [];
        if (!indices?.length || !scores?.length) {
            result.error = "No matched indices or scores";
            return result;
        }

        const items = indices
            .map((idx: number, i: number) => ({
                item: data[idx],
                score: scores[i] || 0
            }))
            .filter((entry: any) => entry.item && entry.score >= (query.minScore || 0))
            .sort((a: any, b: any) => b.score - a.score)
            .map((entry: any) => entry.item);

        result.ok = true;
        result.items = items;
        result.total = items.length;
        result.stats.matchedBySearch = items.length;
        result.suggestions = parsed?.data?.suggestions || [];

    } catch (e) {
        console.error("Error in aiSemanticSearch:", e);
        result.error = String(e);
    }

    return result;
}

//
export const findSimilar = async <T = any>(
    reference: T,
    candidates: T[],
    threshold: number = 0.5,
    topK: number = 10,
    config?: AIConfig
): Promise<SimilarityResult<T>[]> => {
    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            console.warn("No GPT instance for similarity search");
            return [];
        }

        const response = await gpt.searchSimilar(reference, candidates, threshold);

        if (!response.ok || !response.data) {
            return [];
        }

        return response.data.slice(0, topK).map((result: any) => ({
            item: result.item,
            score: result.similarity || result.score || 0,
            matchedFields: result.match_reasons || [],
            explanation: result.explanation
        }));

    } catch (e) {
        console.error("Error in findSimilar:", e);
        return [];
    }
}

//
export const groupBy = <T = any>(
    data: T[],
    groupField: string,
    aggregates?: { field: string; operation: "count" | "sum" | "avg" | "min" | "max" }[]
): GroupedResult<T>[] => {
    const groups = new Map<any, T[]>();

    for (const item of data) {
        const key = groupField.split(".").reduce(
            (obj, k) => obj?.[k as keyof typeof obj],
            item as any
        );

        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(item);
    }

    return Array.from(groups.entries()).map(([key, items]) => {
        const result: GroupedResult<T> = {
            key,
            items,
            count: items.length
        };

        if (aggregates?.length) {
            result.aggregates = {};
            for (const agg of aggregates) {
                const values = items
                    .map(item => agg.field.split(".").reduce(
                        (obj, k) => obj?.[k as keyof typeof obj],
                        item as any
                    ))
                    .filter(v => typeof v === "number");

                switch (agg.operation) {
                    case "count":
                        result.aggregates[`${agg.field}_count`] = values.length;
                        break;
                    case "sum":
                        result.aggregates[`${agg.field}_sum`] = values.reduce((a, b) => a + b, 0);
                        break;
                    case "avg":
                        result.aggregates[`${agg.field}_avg`] = values.length
                            ? values.reduce((a, b) => a + b, 0) / values.length
                            : 0;
                        break;
                    case "min":
                        result.aggregates[`${agg.field}_min`] = Math.min(...values);
                        break;
                    case "max":
                        result.aggregates[`${agg.field}_max`] = Math.max(...values);
                        break;
                }
            }
        }

        return result;
    });
}

//
export const findDuplicates = async <T = any>(
    data: T[],
    fields: string[] = ["name", "title"],
    similarityThreshold: number = 0.8,
    config?: AIConfig
): Promise<{ groups: T[][]; duplicateCount: number }> => {
    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            return { groups: [], duplicateCount: 0 };
        }

        await gpt.giveForRequest(`
Data set to check for duplicates:
\`\`\`toon
${encode(data, { indent: 2 })}
\`\`\`
        `);

        await gpt.askToDoAction(`
Find potential duplicates in the data set.
Compare these fields: ${fields.join(", ")}
Similarity threshold: ${similarityThreshold}

Consider:
- Exact matches
- Similar names/titles (typos, abbreviations)
- Same entity with different representations

Return:
\`\`\`json
{
    "duplicate_groups": [
        { "indices": [0, 3, 7], "reason": "Same name with different formatting" },
        ...
    ]
}
\`\`\`
        `);

        const raw = await gpt.sendRequest("medium", "low", null, {
            responseFormat: "json",
            temperature: 0.2
        });

        if (!raw) {
            return { groups: [], duplicateCount: 0 };
        }

        const parsed = parseAIResponseSafe<any>(raw);
        if (!parsed?.ok) {
            return { groups: [], duplicateCount: 0 };
        }

        const groups = (parsed?.data?.duplicate_groups || []).map((g: any) =>
            g.indices.map((i: number) => data[i]).filter(Boolean)
        ).filter((g: T[]) => g.length > 1);
        const duplicateCount = groups.reduce((sum: number, g: T[]) => sum + g.length - 1, 0);

        return { groups, duplicateCount };

    } catch (e) {
        console.error("Error in findDuplicates:", e);
        return { groups: [], duplicateCount: 0 };
    }
}

//
export const suggestFilters = async <T = any>(
    data: T[],
    goal: string,
    config?: AIConfig
): Promise<DataFilter[]> => {
    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            return [];
        }

        // Sample data to understand structure
        const sample = data.slice(0, 5);

        await gpt.giveForRequest(`
Sample data structure:
\`\`\`toon
${encode(sample, { indent: 2 })}
\`\`\`

Total items: ${data.length}
        `);

        await gpt.askToDoAction(`
User goal: ${goal}

Suggest filters that would help achieve this goal.
Available operators: eq, neq, contains, startsWith, endsWith, gt, lt, gte, lte, in, nin, exists, regex

Return:
\`\`\`json
{
    "suggested_filters": [
        { "field": "...", "operator": "...", "value": "...", "explanation": "..." }
    ]
}
\`\`\`
        `);

        const raw = await gpt.sendRequest("medium", "medium", null, {
            responseFormat: "json",
            temperature: 0.4
        });

        if (!raw) return [];

        const parsed = parseAIResponseSafe<any>(raw);
        if (!parsed?.ok) {
            return [];
        }
        return (parsed?.data?.suggested_filters || []).map((f: any) => ({
            field: f.field,
            operator: f.operator,
            value: f.value,
            caseSensitive: f.caseSensitive || false
        }));

    } catch (e) {
        console.error("Error in suggestFilters:", e);
        return [];
    }
}

//
export const collectFromMultipleSources = async <T = any>(
    sources: { name: string; data: T[] }[],
    mergeStrategy: "union" | "intersection" | "unique" = "union"
): Promise<{ items: T[]; sourceBreakdown: Record<string, number> }> => {
    const sourceBreakdown: Record<string, number> = {};
    let result: T[] = [];

    if (mergeStrategy === "union") {
        const seen = new Set<string>();
        for (const source of sources) {
            sourceBreakdown[source.name] = 0;
            for (const item of source.data) {
                const key = encode(item, { indent: 2 });
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push(item);
                    sourceBreakdown[source.name]++;
                }
            }
        }
    } else if (mergeStrategy === "intersection") {
        if (sources.length === 0) return { items: [], sourceBreakdown };

        const itemCounts = new Map<string, number>();
        for (const source of sources) {
            const seen = new Set<string>();
            sourceBreakdown[source.name] = source.data.length;
            for (const item of source.data) {
                const key = encode(item, { indent: 2 });
                if (!seen.has(key)) {
                    seen.add(key);
                    itemCounts.set(key, (itemCounts.get(key) || 0) + 1);
                }
            }
        }

        const targetCount = sources.length;
        for (const [key, count] of itemCounts) {
            if (count === targetCount) {
                result.push(decode(key) as T);
            }
        }
    } else if (mergeStrategy === "unique") {
        const itemSources = new Map<string, string[]>();
        for (const source of sources) {
            sourceBreakdown[source.name] = 0;
            for (const item of source.data) {
                const key = encode(item, { indent: 2 });
                if (!itemSources.has(key)) {
                    itemSources.set(key, []);
                }
                itemSources.get(key)!.push(source.name);
            }
        }

        for (const [key, sources] of itemSources) {
            if (sources.length === 1) {
                result.push(decode(key) as T);
                sourceBreakdown[sources[0]]++;
            }
        }
    }

    return { items: result, sourceBreakdown };
}

//
export const quickFilter = <T = any>(
    data: T[],
    field: string,
    value: any,
    operator: DataFilter["operator"] = "eq"
): T[] => {
    return data.filter(item => applyLocalFilter(item, { field, operator, value }));
}

//
export const quickSearch = <T = any>(
    data: T[],
    term: string,
    fields?: string[]
): T[] => {
    const lowerTerm = term.toLowerCase();
    const searchFields = fields || ["name", "title", "description", "id"];

    return data.filter(item =>
        searchFields.some(field => {
            const value = String(
                field.split(".").reduce((obj, k) => obj?.[k as keyof typeof obj], item as any) || ""
            ).toLowerCase();
            return value.includes(lowerTerm);
        })
    );
}


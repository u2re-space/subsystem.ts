import { encode } from "@toon-format/toon";
import { type ModificationInstruction, buildModificationPrompt } from "../model/GPT-Config";
import { fixEntityId } from "../template/EntityId";
import { parseAIResponseSafe } from "core/document/AIResponseParser";
import { getGPTInstance } from "../shared/gpt-utils";
import type { AIConfig } from "../shared/types";

export type { AIConfig };

export type ModifyEntityOptions = {
	preserveId?: boolean;
	preserveType?: boolean;
	validateSchema?: boolean;
	mergeArrays?: boolean;
	deepMerge?: boolean;
};

export type ModificationResult<T = any> = {
	ok: boolean;
	original: T;
	modified: T | null;
	changes: ChangeRecord[];
	errors: string[];
	warnings: string[];
};

export type ChangeRecord = {
	field: string;
	oldValue: any;
	newValue: any;
	action: "update" | "delete" | "add" | "merge";
};

export type BatchModificationResult = {
	ok: boolean;
	results: ModificationResult[];
	totalModified: number;
	totalFailed: number;
	errors: string[];
};

//
const diffObjects = (original: any, modified: any, path: string = ""): ChangeRecord[] => {
    const changes: ChangeRecord[] = [];

    if (typeof original !== "object" || typeof modified !== "object" ||
        original === null || modified === null) {
        if (original !== modified) {
            changes.push({
                field: path || "root",
                oldValue: original,
                newValue: modified,
                action: modified === undefined ? "delete" : original === undefined ? "add" : "update"
            });
        }
        return changes;
    }

    // Check all keys in original
    for (const key of Object.keys(original)) {
        const newPath = path ? `${path}.${key}` : key;
        if (!(key in modified)) {
            changes.push({
                field: newPath,
                oldValue: original[key],
                newValue: undefined,
                action: "delete"
            });
        } else {
            changes.push(...diffObjects(original[key], modified[key], newPath));
        }
    }

    // Check for new keys in modified
    for (const key of Object.keys(modified)) {
        const newPath = path ? `${path}.${key}` : key;
        if (!(key in original)) {
            changes.push({
                field: newPath,
                oldValue: undefined,
                newValue: modified[key],
                action: "add"
            });
        }
    }

    return changes;
}

//
export const modifyEntityByPrompt = async (
    entity: any,
    prompt: string,
    options: ModifyEntityOptions = {},
    config?: AIConfig
): Promise<ModificationResult> => {
    const result: ModificationResult = {
        ok: false,
        original: entity,
        modified: null,
        changes: [],
        errors: [],
        warnings: []
    };

    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            result.errors.push("Failed to initialize GPT instance");
            return result;
        }

        // Set up context
        gpt.setContext({
            operation: "modify",
            existingData: entity,
            entityType: entity?.type
        });

        // Provide entity schema context
        await gpt.giveForRequest(`
Entity to modify:
\`\`\`toon
${encode(entity, { indent: 2 })}
\`\`\`

Modification rules:
${options.preserveId ? "- MUST preserve the 'id' field unchanged" : ""}
${options.preserveType ? "- MUST preserve the 'type' field unchanged" : ""}
${options.mergeArrays ? "- When modifying arrays, merge new items with existing (no duplicates)" : ""}
${options.deepMerge ? "- Apply deep merging for nested objects" : ""}
- Return the COMPLETE modified entity, not just changes
- Maintain the same structure/schema
        `);

        await gpt.askToDoAction(`
User request: ${prompt}

Apply the requested modifications and return:
\`\`\`json
{
    "modified_entity": { /* complete modified entity */ },
    "changes_made": [ { "field": "...", "old": "...", "new": "..." } ],
    "validation_passed": boolean,
    "warnings": []
}
\`\`\`
        `);

        let raw;
        try {
            raw = await gpt.sendRequest("high", "medium", null, {
                responseFormat: "json",
                temperature: 0.2
            });
        } catch (e) {
            result.errors.push(String(e));
            return result;
        }

        if (!raw) {
            result.errors.push("No response from AI");
            return result;
        }

        //
        const parsed = parseAIResponseSafe<any>(raw);
        if (!parsed?.ok) {
            result.errors.push(parsed?.error || "Failed to parse AI response");
            return result;
        }

        //
        let modified = parsed?.data?.modified_entity || parsed?.data;

        // Ensure ID is preserved if required
        if (options.preserveId && entity?.id && modified?.id !== entity.id) {
            modified.id = entity.id;
            result.warnings.push("ID was forcefully preserved");
        }

        // Ensure type is preserved if required
        if (options.preserveType && entity?.type && modified?.type !== entity.type) {
            modified.type = entity.type;
            result.warnings.push("Type was forcefully preserved");
        }

        // Fix entity ID format
        fixEntityId(modified);

        // Calculate changes
        result.changes = diffObjects(entity, modified);
        result.modified = modified;
        result.ok = true;
        result.warnings.push(...(parsed?.data?.warnings || []));
        result.errors.push(...(parsed?.data?.errors || []));

    } catch (e) {
        console.error("Error in modifyEntityByPrompt:", e);
        result.errors.push(String(e));
    }

    return result;
}

//
export const modifyEntityByInstructions = async (
    entity: any,
    instructions: ModificationInstruction[],
    options: ModifyEntityOptions = {},
    config?: AIConfig
): Promise<ModificationResult> => {
    const result: ModificationResult = {
        ok: false,
        original: entity,
        modified: null,
        changes: [],
        errors: [],
        warnings: []
    };

    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            result.errors.push("Failed to initialize GPT instance");
            return result;
        }

        gpt.setContext({
            operation: "modify",
            existingData: entity
        });

        await gpt.giveForRequest(`
Entity to modify:
\`\`\`toon
${encode(entity, { indent: 2 })}
\`\`\`

Modification instructions:
${buildModificationPrompt(instructions)}
        `);

        await gpt.askToDoAction(`
Apply the modification instructions in order.
Return the complete modified entity.

Output format:
\`\`\`json
{
    "modified_entity": { /* complete modified entity */ },
    "applied_instructions": [ /* which instructions were applied */ ],
    "skipped_instructions": [ /* which were skipped and why */ ]
}
\`\`\`
        `);

        //
        let raw;
        try {
            raw = await gpt.sendRequest("medium", "low", null, {
                responseFormat: "json",
                temperature: 0.1
            });
        } catch (e) {
            result.errors.push(String(e));
            return result;
        }

        //
        if (!raw) {
            result.errors.push("No response from AI");
            return result;
        }

        //
        const parsed = parseAIResponseSafe<any>(raw);
        if (!parsed?.ok) {
            result.errors.push(parsed?.error || "Failed to parse AI response");
            return result;
        }

        //
        let modified = parsed?.data?.modified_entity || parsed;

        // Apply preservation rules
        if (options.preserveId && entity?.id) {
            modified.id = entity.id;
        }
        if (options.preserveType && entity?.type) {
            modified.type = entity.type;
        }

        fixEntityId(modified);
        result.changes = diffObjects(entity, modified);
        result.modified = modified;
        result.ok = true;

        // Track skipped instructions as warnings
        if (parsed?.data?.skipped_instructions?.length) {
            result.warnings.push(
                ...parsed?.data?.skipped_instructions.map((s: any) =>
                    `Skipped: ${s.instruction} - ${s.reason}`
                )
            );
        }

    } catch (e) {
        console.error("Error in modifyEntityByInstructions:", e);
        result.errors.push(String(e));
    }

    return result;
}

//
export const batchModifyEntities = async (
    entities: any[],
    prompt: string,
    options: ModifyEntityOptions = {},
    batchSize: number = 5,
    config?: AIConfig
): Promise<BatchModificationResult> => {
    const result: BatchModificationResult = {
        ok: true,
        results: [],
        totalModified: 0,
        totalFailed: 0,
        errors: []
    };

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < entities.length; i += batchSize) {
        const batch = entities.slice(i, i + batchSize);

        const batchPromises = batch.map(entity =>
            modifyEntityByPrompt(entity, prompt, options, config)
        );

        const batchResults = await Promise.all(batchPromises);

        for (const r of batchResults) {
            result.results.push(r);
            if (r.ok) {
                result.totalModified++;
            } else {
                result.totalFailed++;
                result.errors.push(...r.errors);
            }
        }
    }

    result.ok = result.totalFailed === 0;
    return result;
}

//
export const smartMergeEntities = async (
    primary: any,
    secondary: any,
    conflictResolution: "prefer_primary" | "prefer_secondary" | "prefer_newer" | "ask_ai" = "ask_ai",
    config?: AIConfig
): Promise<ModificationResult> => {
    const result: ModificationResult = {
        ok: false,
        original: primary,
        modified: null,
        changes: [],
        errors: [],
        warnings: []
    };

    try {
        const gpt = await getGPTInstance(config);
        if (!gpt) {
            result.errors.push("Failed to initialize GPT instance");
            return result;
        }

        const response = await gpt.mergeEntities(primary, secondary, conflictResolution as any);

        if (!response.ok) {
            result.errors.push(response.error || "Merge failed");
            return result;
        }

        result.modified = response.data;
        result.changes = diffObjects(primary, response.data);
        result.ok = true;

    } catch (e) {
        console.error("Error in smartMergeEntities:", e);
        result.errors.push(String(e));
    }

    return result;
}

export const undoModification = (
	entity: any,
	changes: ChangeRecord[],
): any => {
	const reverted = JSON.parse(JSON.stringify(entity));

	for (const change of changes.slice().reverse()) {
        const path = change.field.split(".");
        let current = reverted;

        // Navigate to parent
        for (let i = 0; i < path.length - 1; i++) {
            if (current[path[i]] === undefined) {
                current[path[i]] = {};
            }
            current = current[path[i]];
        }

        const lastKey = path[path.length - 1];

        switch (change.action) {
            case "update":
            case "add":
                if (change.oldValue === undefined) {
                    delete current[lastKey];
                } else {
                    current[lastKey] = change.oldValue;
                }
                break;
            case "delete":
                current[lastKey] = change.oldValue;
                break;
            case "merge":
                current[lastKey] = change.oldValue;
                break;
        }
    }

    return reverted;
}

//
export const validateModification = async (
    original: any,
    modified: any,
    entityType?: string
): Promise<{ valid: boolean; errors: string[]; suggestions: string[] }> => {
    try {
        const gpt = await getGPTInstance();
        if (!gpt) {
            return { valid: false, errors: ["No GPT instance"], suggestions: [] };
        }

        await gpt.giveForRequest(`
Original entity:
\`\`\`toon
${encode(original, { indent: 2 })}
\`\`\`

Modified entity:
\`\`\`toon
${encode(modified, { indent: 2 })}
\`\`\`

${entityType ? `Expected entity type: ${entityType}` : ""}
        `);

        await gpt.askToDoAction(`
Validate the modification:
1. Check if the modified entity maintains proper structure
2. Verify no required fields are missing
3. Check for type consistency
4. Identify any semantic issues

Return:
\`\`\`json
{
    "valid": boolean,
    "errors": ["..."],
    "suggestions": ["..."]
}
\`\`\`
        `);

        const raw = await gpt.sendRequest("medium", "low", null, {
            responseFormat: "json",
            temperature: 0.1
        });

        if (!raw) {
            return { valid: false, errors: ["No validation response"], suggestions: [] };
        }

        const parsed = parseAIResponseSafe<{ valid: boolean; errors: string[] | string; suggestions: string[]; }>(raw)?.data;
        if (!parsed?.valid) {
            return {
                valid: false,
                errors: Array.isArray(parsed?.errors) ? parsed.errors : [parsed?.errors || "Unknown error"],
                suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
            };
        }
        return { valid: true, errors: [], suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [] };
    } catch (e) {
        console.error("Error in validateModification:", e);
        return { valid: false, errors: [String(e)], suggestions: [] };
    }
}

//
export const createModificationPreview = async (
    entity: any,
    prompt: string
): Promise<{ preview: any; changes: ChangeRecord[]; confidence: number }> => {
    const result = await modifyEntityByPrompt(entity, prompt, {
        preserveId: true,
        preserveType: true
    });

    return {
        preview: result.modified,
        changes: result.changes,
        confidence: result.ok ? 0.85 : 0
    };
}


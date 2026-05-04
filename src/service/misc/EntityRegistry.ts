import type { EntityInterface } from "com/template/EntityInterface";
import { observe } from "./cache-reactivity";

//
export const EntityRegistry = observe(new Map<string, EntityInterface<any, any>>());

//
export const registerEntity = (entity: EntityInterface<any, any>) => {
    if (entity.id) {
        EntityRegistry?.set(entity.id, entity);
    }
};

//
export const unregisterEntity = (entity: EntityInterface<any, any>) => {
    if (entity.id) {
        EntityRegistry?.delete(entity.id);
    }
};

//
export const findEntities = (pattern: string): EntityInterface<any, any>[] => {
    if (!pattern) return [];

    // Optimization: direct lookup
    if (EntityRegistry?.has?.(pattern)) {
        const e = EntityRegistry?.get?.(pattern);
        if (e) return [e];
    }

    const results: EntityInterface<any, any>[] = [];
    let regex: RegExp;

    try {
        // Support simple wildcard '*' -> '.*'
        if (pattern.includes('*')) {
            // Escape other special regex characters except '*'
            const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
            regex = new RegExp(regexStr, 'i'); // Case insensitive?
        } else {
            // If no wildcard, maybe treated as "contains" or just exact (which failed above)
            // But user said "id_part", so maybe "contains" is better?
            // Let's assume if it's not exact, it might be a partial ID match if user intended.
            // But for safety, let's stick to wildcard logic or exact.
            // If user wants prefix, they should use "prefix*"
            return [];
        }

        for (const [id, entity] of EntityRegistry?.entries?.() || []) {
            if (regex?.test?.(id)) {
                results.push(entity);
            }
        }
    } catch (e) {
        console.warn("Invalid pattern in findEntities", pattern, e);
    }

    return results;
};

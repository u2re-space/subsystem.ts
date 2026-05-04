/*
 * Available on Service Workers.
 * Stage 3: Resolve entity items, by following schemes (according of entity types).
 * Also may be used MCP servers and WebSearch for more detailed information.
 */

//
import type { GPTResponses } from "../model/GPT-Responses";

//
import { loadEntitiesSchemaMarkdown } from "com/template/EntitiesSchema";
import { fixEntityId } from "com/template/EntityId";
import { parseAIResponseSafe } from "core/document/AIResponseParser";

//
export const resolveEntity = async (gptResponses: GPTResponses | null = null, entity: any = null) => {
    const askResolveStep = () => {
        return [
            "# Request: resolve best to match entities by their types and IDs (merge if possible).", "",
            "Search potential duplicates and merge them if possible (choice is best to match for entities).",
            "Also, search potentially related items (IDs), for discounts, promo-codes, etc. if exists.",
            "Resolve entity items, by following schemes, given above.",
            "IMPORTANT: Output in JSON format, according to given schema. No any additional text or comments."
        ]?.map?.((instruction) => instruction?.trim?.());
    }

    //
    const schema = await loadEntitiesSchemaMarkdown();
    if (schema) await gptResponses?.giveForRequest?.(schema);
    await gptResponses?.askToDoAction?.(askResolveStep()?.join?.("\n"));
    const parsed = parseAIResponseSafe<{ entities: any[] }>(await gptResponses?.sendRequest?.("low", "low") || "{}");
    if (!parsed?.ok) {
        return { ok: false, entities: [], error: parsed?.error || "Failed to parse AI response" };
    }
    const entities = (parsed?.data as { entities: any[] })?.entities?.map?.((entity: any) => fixEntityId(entity)) || [];
    return { ok: true, entities: entities, error: undefined };
}

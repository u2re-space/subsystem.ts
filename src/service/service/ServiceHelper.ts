import { fixEntityId } from "com/template/EntityId";
import { dataCategories } from "com/service/misc/Cache";
import { pushMany } from "com/store/IDBQueue";

//
export const queueEntityForWriting = (entity, entityType, dataType: string | null = "json"): any => {
    const resolvedType = (entityType || 'unknown')?.trim?.();

    //
    let subId = `${Date.now()}`;
    let name = (fixEntityId(entity) || subId)
        ?.trim?.()
        ?.toString?.()
        ?.toLowerCase?.()
        ?.replace?.(/\s+/g, '-')
        ?.replace?.(/[^a-z0-9_\-+#&]/g, '-')
        || subId;

    // prepare to writing into database (for phase 4 - consolidate)
    const directory = (resolvedType == "timeline" || resolvedType == "task") ? "/timeline/" : `/data/${resolvedType}/`?.trim?.();

    // get preview versions of resolved entity to show in UI
    (dataCategories as any)?.find?.((category) => category?.id === resolvedType)?.items?.push?.(name);
    return { status: 'queued', entityType, data: entity, name, directory, subId, dataType };
}

//
export const pushToIDBQueue = (results: any[]) => {
    return pushMany(results)?.catch?.(console.warn.bind(console));
}

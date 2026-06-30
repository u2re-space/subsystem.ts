/**
 * `core/storage` alias target (`core/*` → `src/shared/*`).
 * LocalStorage/session helpers live in lur.e OPFS utils; keep this barrel thin so explorer/settings/history
 * do not import the whole `shared/index.ts` surface.
 */
export {
    StorageKeys,
    type StorageKey,
    getItem,
    setItem,
    removeItem,
    getString,
    setString,
    isLocalStorageAvailable,
    getSessionItem,
    setSessionItem,
    removeSessionItem,
    getIDBItem,
    setIDBItem,
    removeIDBItem,
    IDBStorage,
    workCenterStorage,
    historyStorage,
    settingsStorage
} from "../../../../modules/projects/lur.e/src/utils/opfs";

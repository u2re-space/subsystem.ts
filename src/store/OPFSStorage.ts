/*
 * Filename: OPFSStorage.ts
 * FullPath: modules/projects/subsystem/src/store/OPFSStorage.ts
 * FIND:idb-fs
 * TAG:opfs
 *
 * Thin facade over lure virtual FS. Bytes live in OPFS or IdbFs; hosts may
 * also register `/sdcard/` `/saf/` via `registerProvideBackend`.
 */

import { getIdbRoot, isOpfsBackendActive, provide } from "@fest-lib/lure";

export class OPFSStorage {
    provide(path: string, rw = false) {
        return provide(path, rw);
    }

    root() {
        if (isOpfsBackendActive()) return navigator.storage?.getDirectory?.();
        return getIdbRoot();
    }
}

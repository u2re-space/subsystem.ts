//
export interface DayDescriptor {
    begin_time?: Date | string | null;
    end_time?: Date | string | null;
    status?: string | null;

    // less usual fields
    id?: string | null;
    title?: string | null;
    separatorTitle?: string | null;
    weekNumber?: number | null;
}

//
export type ChapterDescriptor = DayDescriptor | string | null;

//
export interface EntityDescriptor {
    type?: string;
    label?: string;
    DIR?: string;
}



//
export type DocParserMeta = {
    collection: DocCollection;
    directory: string;
    fileHandle: FileSystemFileHandle;
    file: File;
    filePath: string;
};

export type DocEntry = {
    id: string;
    title: string;
    subtitle?: string;
    summary?: string;
    description?: string;
    path: string;
    fileName: string;
    collectionId: string;
    modifiedAt: number;
    wordCount?: number;
    searchText: string;
    renderPreview: (container: HTMLElement, ctx: DocWorkspaceController) => void | Promise<void>;
    dispose?: () => void;
    raw?: unknown;
};

export type DocParser = (meta: DocParserMeta) => Promise<DocEntry | null>;

export type DocCollection = {
    id: string;
    label: string;
    dir?: string;
    dirs?: string[];
    icon?: string;
    description?: string;
    parser?: DocParser;
    emptyState?: string;
};

export type WorkspaceAction = {
    id: string;
    label: string;
    icon?: string;
    primary?: boolean;
    onClick: (ctx: DocWorkspaceController) => void | Promise<void>;
    disabled?: (ctx: DocWorkspaceController) => boolean;
    tooltip?: string;
};

export type EntryActionFactory = (entry: DocEntry, ctx: DocWorkspaceController) => HTMLElement | null;

export type DocWorkspaceOptions = {
    title?: string;
    subtitle?: string;
    collections: DocCollection[];
    defaultCollectionId?: string;
    actions?: WorkspaceAction[];
    secondaryActions?: WorkspaceAction[];
    entryActions?: EntryActionFactory[];
    searchPlaceholder?: string;
    emptyState?: string;
    enableDrop?: boolean;
    enablePaste?: boolean;
    onDrop?: (event: DragEvent, ctx: DocWorkspaceController) => Promise<void> | void;
    onPaste?: (event: ClipboardEvent, ctx: DocWorkspaceController) => Promise<void> | void;
};

export type DocWorkspaceController = {
    element: HTMLElement;
    options: DocWorkspaceOptions;
    getCollections: () => DocCollection[];
    getCollection: (id?: string) => DocCollection | undefined;
    getCurrentCollection: () => DocCollection | undefined;
    getCollectionDirs: (id?: string) => string[];
    getCurrentEntry: () => DocEntry | null;
    getEntries: (collectionId?: string) => DocEntry[];
    selectCollection: (id: string) => void;
    selectEntry: (entryId: string) => void;
    reload: (collectionId?: string) => Promise<void>;
    reloadCurrent: () => Promise<void>;
    ensureDir: (dir: string) => Promise<FileSystemDirectoryHandle | null>;
    setActions: (actions: WorkspaceAction[]) => void;
    setSecondaryActions: (actions: WorkspaceAction[]) => void;
    setEntryActions: (actions: EntryActionFactory[]) => void;
    deleteEntry: (entry: DocEntry | string) => Promise<boolean>;
};


export type DeleteEntryActionOptions = {
    icon?: string;
    tooltip?: string;
    label?: string;
    className?: string;
    confirm?: (entry: DocEntry, ctx: DocWorkspaceController) => boolean | Promise<boolean>;
    confirmMessage?: string | ((entry: DocEntry, ctx: DocWorkspaceController) => string);
    onSuccess?: (entry: DocEntry, ctx: DocWorkspaceController) => void;
    onError?: (entry: DocEntry, ctx: DocWorkspaceController, error?: unknown) => void;
};

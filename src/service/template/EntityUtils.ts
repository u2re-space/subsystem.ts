/*
 *
 * Needs for direct uploading JSON files to IndexedDB and Cache.
 * Not always AI may be needed for sorting into database, so we need to detect type of data.
 * Detects by fields, such as 'kind', some 'properties', structure, keywords, etc.
 */

import { JSOX } from "jsox";

//
export type SectionKey = "main" | "schedule" | "properties" | "contacts" | "relations" | "meta";
export type EntityFieldRule = {
    name: string;
    label: string;
    path: string;
    section?: SectionKey | string;
    helper?: string;
    placeholder?: string;
    textarea?: boolean;
    multi?: boolean;
    numeric?: boolean;
    json?: boolean;
    type?: string;
    options?: string[];
    datalist?: string[];
    required?: boolean;
};

//
export type EntitySchema = {
    kind?: string[];
    fields: EntityFieldRule[];
};



const optionize = (values: string[] | undefined): string[] => (values ?? []).map((value) => value);

const locationField = (name: string, path: string, section: SectionKey = "relations", label = "Location", helper?: string): EntityFieldRule => ({
    name,
    label,
    path,
    section,
    textarea: true,
    helper: helper ?? "String or JSON representation of the location"
});

const contactFields = (basePath: string): EntityFieldRule[] => [
    {
        name: "contacts.email",
        label: "Emails",
        path: `${basePath}.email`,
        section: "contacts",
        textarea: true,
        helper: "One email per line",
        multi: true
    },
    {
        name: "contacts.phone",
        label: "Phones",
        path: `${basePath}.phone`,
        section: "contacts",
        textarea: true,
        helper: "One phone per line",
        multi: true
    },
    {
        name: "contacts.links",
        label: "Links",
        path: `${basePath}.links`,
        section: "contacts",
        textarea: true,
        helper: "One link per line",
        multi: true
    }
];

export const selectField = (name: string, label: string, path: string, options: string[], section: SectionKey = "properties", helper?: string): EntityFieldRule => ({
    name,
    label,
    path,
    section,
    helper,
    options: optionize(options)
});

//
export const COLOR_OPTIONS = [
    "red",
    "green",
    "blue",
    "yellow",
    "orange",
    "purple",
    "brown",
    "gray",
    "black",
    "white"
];

export const TASK_STATUS_OPTIONS = [
    "under_consideration",
    "pending",
    "in_progress",
    "completed",
    "failed",
    "delayed",
    "canceled",
    "other"
];

//
export const AFFECT_OPTIONS = ["positive", "negative", "neutral"];
export const GENDER_OPTIONS = ["male", "female", "other"];


const dateStructFields = (
    name: string,
    label: string,
    basePath: string,
    section: SectionKey = "schedule"
): EntityFieldRule[] => [
        {
            name: `${name}.date`,
            label: `${label} (Date)`,
            path: `${basePath}.date`,
            section,
            placeholder: "YYYY-MM-DD"
        },
        {
            name: `${name}.iso_date`,
            label: `${label} (ISO)`,
            path: `${basePath}.iso_date`,
            section,
            placeholder: "YYYY-MM-DDTHH:MM",
            helper: "ISO 8601 date-time"
        },
        {
            name: `${name}.timestamp`,
            label: `${label} (Timestamp)`,
            path: `${basePath}.timestamp`,
            section,
            numeric: true,
            type: "number",
            helper: "Unix milliseconds"
        }
    ];

const arrayField = (
    name: string,
    label: string,
    path: string,
    section: SectionKey = "relations",
    helper?: string
): EntityFieldRule => ({
    name,
    label,
    path,
    section,
    textarea: true,
    multi: true,
    helper
});

const jsonField = (
    name: string,
    label: string,
    path: string,
    section: SectionKey = "properties",
    helper?: string
): EntityFieldRule => ({
    name,
    label,
    path,
    section,
    json: true,
    textarea: true,
    helper
});

const stringField = (
    name: string,
    label: string,
    path: string,
    section: SectionKey = "properties",
    placeholder?: string,
    helper?: string
): EntityFieldRule => ({
    name,
    label,
    path,
    section,
    placeholder,
    helper
});

const numberField = (
    name: string,
    label: string,
    path: string,
    section: SectionKey = "properties",
    helper?: string
): EntityFieldRule => ({
    name,
    label,
    path,
    section,
    numeric: true,
    type: "number",
    helper
});

const biographyFields = (basePath: string): EntityFieldRule[] => [
    {
        name: "biography.firstName",
        label: "First name",
        path: `${basePath}.firstName`,
        section: "main"
    },
    {
        name: "biography.lastName",
        label: "Last name",
        path: `${basePath}.lastName`,
        section: "main"
    },
    {
        name: "biography.middleName",
        label: "Middle name",
        path: `${basePath}.middleName`,
        section: "main"
    },
    {
        name: "biography.nickName",
        label: "Nick name",
        path: `${basePath}.nickName`,
        section: "main"
    },
    {
        name: "biography.birthdate",
        label: "Birth date",
        path: `${basePath}.birthdate`,
        section: "meta",
        placeholder: "YYYY-MM-DD or ISO date"
    },
    selectField("biography.gender", "Gender", `${basePath}.gender`, GENDER_OPTIONS, "meta")
];

export const BASE_ENTITY_FIELD_RULES: EntityFieldRule[] = [
    {
        name: "id",
        label: "Identifier",
        path: "id",
        section: "main",
        placeholder: "unique-id-or-code",
        helper: "Stable unique identifier"
    },
    {
        name: "name",
        label: "Name",
        path: "name",
        section: "main",
        placeholder: "machine-name",
        helper: "Lowercase machine-readable name"
    },
    {
        name: "title",
        label: "Title",
        path: "title",
        section: "main",
        placeholder: "Human readable name",
        helper: "Shown in cards and lists"
    },
    {
        name: "kind",
        label: "Kind",
        path: "kind",
        section: "main",
        helper: "Determines category-specific behaviour"
    },
    {
        name: "description",
        label: "Description",
        path: "description",
        section: "main",
        textarea: true,
        helper: "Markdown supported"
    },
    selectField("variant", "Variant", "variant", COLOR_OPTIONS, "meta", "Visual accent colour"),
    {
        name: "icon",
        label: "Icon",
        path: "icon",
        section: "meta",
        placeholder: "phosphor/name"
    },
    {
        name: "image",
        label: "Image",
        path: "image",
        section: "meta",
        placeholder: "https://example.com/image.jpg"
    },
    {
        name: "tags",
        label: "Tags",
        path: "tags",
        section: "meta",
        textarea: true,
        helper: "One tag per line",
        multi: true
    }
];

//
export const FIELD_ALIASES: Record<string, string> = {
    title: "title",
    kind: "kind",
    name: "name",
    id: "id",
    price: "properties.price",
    quantity: "properties.quantity",
    begin_time: "properties.begin_time",
    end_time: "properties.end_time",
    email: "properties.contacts.email",
    phone: "properties.contacts.phone",
    links: "properties.contacts.links",
    "contacts.email": "properties.contacts.email",
    "contacts.phone": "properties.contacts.phone",
    "contacts.links": "properties.contacts.links"
};

//
export const LEGACY_PROPERTY_RULES: Record<string, EntityFieldRule> = {
    price: numberField("price", "Price", "properties.price", "properties", "Price as number"),
    quantity: numberField("quantity", "Quantity", "properties.quantity"),
    begin_time: stringField("begin_time", "Begin", "properties.begin_time", "schedule", "YYYY-MM-DD or ISO string"),
    end_time: stringField("end_time", "End", "properties.end_time", "schedule", "YYYY-MM-DD or ISO string"),
    location: locationField("location", "properties.location"),
    services: arrayField("services", "Services", "properties.services", "relations", "Service IDs, one per line"),
    members: arrayField("members", "Members", "properties.members", "relations", "Member IDs, one per line"),
    actions: arrayField("actions", "Actions", "properties.actions", "relations", "Action IDs, one per line"),
    bonuses: arrayField("bonuses", "Bonuses", "properties.bonuses", "properties", "Bonus IDs, one per line"),
    rewards: arrayField("rewards", "Rewards", "properties.rewards", "properties", "Reward IDs, one per line"),
    feedbacks: arrayField("feedbacks", "Feedbacks", "properties.feedbacks", "properties", "Feedback IDs, one per line"),
    tasks: arrayField("tasks", "Tasks", "properties.tasks", "relations", "Task IDs, one per line"),
    persons: arrayField("persons", "Persons", "properties.persons", "relations", "Person IDs, one per line"),
    events: arrayField("events", "Events", "properties.events", "relations", "Event IDs, one per line"),
    image: arrayField("image", "Images", "properties.image", "properties", "Image URLs, one per line"),
    availability: stringField("availability", "Availability", "properties.availability", "properties"),
    availabilityTime: arrayField("availabilityTime", "Availability time", "properties.availabilityTime", "properties", "Time ranges, one per line"),
    availabilityDays: arrayField("availabilityDays", "Availability days", "properties.availabilityDays", "properties", "Day names, one per line"),
    permissions: stringField("permissions", "Permissions", "properties.permissions", "properties"),
    purpose: stringField("purpose", "Purpose", "properties.purpose", "properties"),
    home: locationField("home", "properties.home"),
    jobs: arrayField("jobs", "Jobs", "properties.jobs", "relations", "Job IDs, one per line"),
    coordinates: jsonField("coordinates", "Coordinates", "properties.coordinates", "properties", "JSON object with latitude and longitude")
};




export const ENTITY_KIND_MAP: Record<string, string[]> = {
    task: ["job", "action", "other"],
    event: [
        "education",
        "lecture",
        "conference",
        "meeting",
        "seminar",
        "workshop",
        "presentation",
        "celebration",
        "opening",
        "other"
    ],
    action: [
        "thinking",
        "imagination",
        "remembering",
        "speaking",
        "learning",
        "listening",
        "reading",
        "writing",
        "moving",
        "traveling",
        "speech",
        "physically",
        "crafting",
        "following",
        "other"
    ],
    service: ["product", "consultation", "advice", "medical", "mentoring", "training", "item", "thing", "other"],
    item: ["currency", "book", "electronics", "furniture", "medicine", "tools", "software", "consumables", "other"],
    skill: ["skill", "knowledge", "ability", "trait", "experience", "other"],
    vendor: ["vendor", "company", "organization", "institution", "other"],
    place: [
        "placement",
        "place",
        "school",
        "university",
        "service",
        "clinic",
        "pharmacy",
        "hospital",
        "library",
        "market",
        "location",
        "shop",
        "restaurant",
        "cafe",
        "bar",
        "hotel",
        "other"
    ],
    factor: ["weather", "health", "family", "relationships", "job", "traffic", "business", "economy", "politics", "news", "other"],
    person: ["specialist", "consultant", "coach", "mentor", "dear", "helper", "assistant", "friend", "family", "relative", "other"],
    bonus: []
};

export const ENTITY_SCHEMAS: Record<string, EntitySchema> = {
    task: {
        kind: ENTITY_KIND_MAP.task,
        fields: [
            selectField("status", "Status", "properties.status", TASK_STATUS_OPTIONS, "properties", "Task state"),
            ...dateStructFields("begin_time", "Begin", "properties.begin_time"),
            ...dateStructFields("end_time", "End", "properties.end_time"),
            locationField("location", "properties.location"),
            ...contactFields("properties.contacts"),
            arrayField("members", "Members", "properties.members", "relations", "Entity IDs, one per line"),
            arrayField("events", "Events", "properties.events", "relations", "Event IDs, one per line")
        ]
    },
    event: {
        kind: ENTITY_KIND_MAP.event,
        fields: [
            ...dateStructFields("begin_time", "Begin", "properties.begin_time"),
            ...dateStructFields("end_time", "End", "properties.end_time"),
            locationField("location", "properties.location"),
            ...contactFields("properties.contacts")
        ]
    },
    action: {
        kind: ENTITY_KIND_MAP.action,
        fields: [
            stringField("affect", "Affect", "properties.affect", "properties", "Describe impact or affect"),
            arrayField("steps", "Steps", "properties.steps", "properties", "Action steps, one per line"),
            arrayField("related", "Related", "properties.related", "relations", "Related entity IDs, one per line")
        ]
    },
    service: {
        kind: ENTITY_KIND_MAP.service,
        fields: [
            locationField("location", "properties.location"),
            arrayField("persons", "Persons", "properties.persons", "relations", "Person IDs, one per line"),
            arrayField("specialization", "Specializations", "properties.specialization", "properties", "Specializations, one per line"),
            ...contactFields("properties.contacts"),
            jsonField("prices", "Prices", "properties.prices", "properties", "JSON map: service => price")
        ]
    },
    item: {
        kind: ENTITY_KIND_MAP.item,
        fields: [
            numberField("price", "Price", "properties.price", "properties", "Price as number"),
            numberField("quantity", "Quantity", "properties.quantity"),
            arrayField("availability", "Availability", "properties.availability", "properties", "Availability notes, one per line"),
            jsonField("attributes", "Attributes", "properties.attributes", "properties", "Additional item attributes in JSON")
        ]
    },
    skill: {
        kind: ENTITY_KIND_MAP.skill,
        fields: [
            stringField("level", "Level", "properties.level", "properties", "e.g. beginner, intermediate"),
            arrayField("category", "Categories", "properties.category", "properties", "Categories, one per line"),
            arrayField("related", "Related", "properties.related", "relations", "Related skill or entity IDs")
        ]
    },
    vendor: {
        kind: ENTITY_KIND_MAP.vendor,
        fields: [
            locationField("location", "properties.location"),
            ...contactFields("properties.contacts"),
            arrayField("services", "Services", "properties.services", "relations", "Service IDs, one per line")
        ]
    },
    place: {
        kind: ENTITY_KIND_MAP.place,
        fields: [
            locationField("location", "properties.location", "properties"),
            arrayField("services", "Services", "properties.services", "relations", "Related service IDs"),
            ...contactFields("properties.contacts")
        ]
    },
    factor: {
        kind: ENTITY_KIND_MAP.factor,
        fields: [
            selectField("affect", "Affect", "properties.affect", AFFECT_OPTIONS, "properties", "Overall impact"),
            arrayField("actions", "Actions", "properties.actions", "relations", "Action IDs, one per line"),
            locationField("location", "properties.location", "properties")
        ]
    },
    person: {
        kind: ENTITY_KIND_MAP.person,
        fields: [
            locationField("home", "properties.home", "properties", "Home location"),
            arrayField("jobs", "Jobs", "properties.jobs", "properties", "Job locations, one per line"),
            ...biographyFields("properties.biography"),
            arrayField("tasks", "Tasks", "properties.tasks", "relations", "Task IDs, one per line"),
            ...contactFields("properties.contacts"),
            arrayField("services", "Services", "properties.services", "relations", "Service IDs, one per line"),
            jsonField("prices", "Prices", "properties.prices", "properties", "JSON map: service => price")
        ]
    },
    bonus: {
        kind: ENTITY_KIND_MAP.bonus,
        fields: [
            stringField("code", "Code", "properties.code", "properties", "Readable bonus code"),
            arrayField("usableFor", "Usable for", "properties.usableFor", "relations", "Entity IDs, one per line"),
            arrayField("usableIn", "Usable in", "properties.usableIn", "relations", "Location IDs, one per line"),
            numberField("availability.count", "Availability count", "properties.availability.count", "properties"),
            arrayField("availability.time", "Availability time", "properties.availability.time", "properties", "Time ranges, one per line"),
            arrayField("availability.days", "Availability days", "properties.availability.days", "properties", "Day names, one per line"),
            jsonField("requirements", "Requirements", "properties.requirements", "properties", "JSON array of requirements"),
            jsonField("additionalProperties", "Additional properties", "properties.additionalProperties", "properties", "JSON map of extra properties"),
            jsonField("profits", "Profits", "properties.profits", "properties", "JSON map: target => profit value")
        ]
    }
};


//
export const detectEntityTypeByJSON = (unknownJSON: any) => {
    let mostSuitableType = "unknown";

    //
    unknownJSON = typeof unknownJSON == "string" ? JSOX.parse(unknownJSON) as any : unknownJSON;
    if (typeof unknownJSON != "object") { return mostSuitableType; }

    // direct type detection
    if (unknownJSON.type && unknownJSON.properties && unknownJSON.kind) return unknownJSON.type;

    // attempt 1 - detect possible types by 'KIND_MAP' enums
    let types: Set<any> = new Set();
    for (const type in ENTITY_KIND_MAP) {
        if (ENTITY_KIND_MAP[type].includes(unknownJSON.kind)) {
            types.add(type);
        }
    }

    // filter all entities, which has no required kinds
    const allEntities = [...Object.entries(ENTITY_SCHEMAS)]?.filter?.(([key, _]: any) => types.has(key))

    // attempt 2.1 - detect by specific fields and properties (events, time based)
    let timeTypes: Set<any> = new Set();
    if (unknownJSON?.properties?.begin_time != null || unknownJSON?.properties?.end_time != null) {
        allEntities?.forEach(([type, scheme]: any) => {
            if (scheme.properties?.begin_time != null && scheme.properties?.end_time != null) {
                timeTypes.add(type);
            }
        });
    }

    // attempt 2.2 - detect by specific fields and properties (location based)
    let locationTypes: Set<any> = new Set();
    if (unknownJSON?.properties?.location != null) {
        allEntities?.forEach(([type, scheme]: any) => {
            if (scheme.properties?.location != null) {
                locationTypes.add(type);
            }
        });
    }

    // attempt 2.3 - detect by specific fields and properties (prices factors)
    let pricesTypes: Set<any> = new Set();
    if (unknownJSON?.properties?.prices != null) {
        allEntities?.forEach(([type, scheme]: any) => {
            if (scheme.properties?.prices != null) {
                pricesTypes.add(type);
            }
        });
    }

    // attempt 2.4 - detect by specific fields and properties (contacts factors)
    let contactsTypes: Set<any> = new Set();
    if (unknownJSON?.properties?.contacts != null) {
        allEntities?.forEach(([type, scheme]: any) => {
            if (scheme.properties?.contacts != null) {
                contactsTypes.add(type);
            }
        });
    }

    //
    const countMap = new Map<any, number>();
    [...contactsTypes, ...locationTypes, ...pricesTypes, ...timeTypes].forEach((type) => {
        countMap.set(type, (countMap.get(type) || 0) + 1);
    });

    //
    mostSuitableType = countMap.size == 0 ? [...types]?.[0] : [...countMap.entries()].reduce((a, b) => a[1] > b[1] ? a : b)[0];
    return (mostSuitableType || "unknown");
}

// for multiple entities (array)
export const detectEntityTypesByJSONs = (unknownJSONs: any[] | any) => {
    unknownJSONs = typeof unknownJSONs == "string" ? JSOX.parse(unknownJSONs) as any : unknownJSONs;
    return (Array.isArray(unknownJSONs) ? unknownJSONs?.map?.((unknownJSON) => detectEntityTypeByJSON(unknownJSON)) || [] : [detectEntityTypeByJSON(unknownJSONs)]);
}

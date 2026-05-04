export enum ENTITY_TYPE {
    TASK = "task",
    EVENT = "event",
    ACTION = "action",
    SERVICE = "service",
    ITEM = "item",
    SKILL = "skill",
}

//
export enum ENTITY_KIND { };
export enum VENDOR_KIND {
    VENDOR = "vendor",
    COMPANY = "company",
    ORGANIZATION = "organization",
    INSTITUTION = "institution",
}

//
export enum PLACE_KIND {
    PLACEMENT = "placement",
    PLACE = "place",
    SCHOOL = "school",
    UNIVERSITY = "university",
}

//
export enum FACTOR_KIND {
    WEATHER = "weather",
    HEALTH = "health",
    FAMILY = "family",
    RELATIONSHIPS = "relationships",
}

//
export enum PERSON_KIND {
    SPECIALIST = "specialist",
    CONSULTANT = "consultant",
    COACH = "coach",
    MENTOR = "mentor",
    DEAR = "dear",
}

//
export enum SERVICE_KIND {
    PRODUCT = "product",
    CONSULTATION = "consultation",
    ADVICE = "advice",
    MEDICAL = "medical",
}

//
export enum ITEM_KIND {
    CURRENCY = "currency",
    BOOK = "book",
    ELECTRONICS = "electronics",
    FURNITURE = "furniture",
}

//
export enum SKILL_KIND {
    SKILL = "skill",
    KNOWLEDGE = "knowledge",
    ABILITY = "ability",
    TRAIT = "trait",
}



// unknown but base
export interface PropBase {
}

//
export interface EntityInterface<T extends PropBase, K extends (ENTITY_KIND | VENDOR_KIND | PLACE_KIND | FACTOR_KIND | PERSON_KIND | SERVICE_KIND | ITEM_KIND | SKILL_KIND)> {
    id: string;
    type?: T;
    kind?: K;
    name?: string;
    title?: string;
    variant?: string;
    description?: string | string[];
    image?: string;
    icon?: string;
    tags?: string[];
    properties?: T;
    items?: any;
    meta?: any;
    shortcut?: any;
    viewMaker?: any;
}

//
export interface OtherInterface extends PropBase {
    [key: string]: Record<string, any>;
}

//
export interface PersonInterface extends PropBase {
    home: string;
    jobs: string[];
    biography: string;
    contacts: string;
    services: string[];
}


export interface TimeType {
    date?: string;
    iso_date?: string;
    timestamp?: number;
}

//
export interface TaskInterface extends PropBase {
    status: string;
    begin_time: TimeType;
    end_time: TimeType;
    location: string;
    contacts: string;
    members: string[];
    events: string[];
}

//
export interface EventInterface extends PropBase {
    begin_time: TimeType;
    end_time: TimeType;
    location: string;
    contacts: string;
}

//
export interface ActionInterface extends PropBase {
    affect: string;
}

//
export interface ServiceInterface extends PropBase {
    location: string;
    persons: string[];
    specialization: string[];
    contacts: string;
}

//
export interface SkillInterface extends PropBase {
    level: string;
    category: string[];
    related: string[];
}

//
export interface ItemInterface extends PropBase {
    price: number;
    quantity: number;
    availability: string[];
    attributes: Record<string, any>;
}

//
export interface BonusInterface extends PropBase {
    code: string;
    usableFor: string[];
    usableIn: string[];
    availability: {
        count: number;
        time: string[];
        days: string[];
    };
}

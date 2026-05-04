# Entities Spec V2

For understanding and for AI generation.

## Output Format

`{ "entities": ENTITY[], "keywords"?: STRING[], "short_description"?: MARKDOWN }`

---

## Entity Structure

```
ENTITY={
    "type": ENUM:TYPE,
    "id": UNIQUE[ID],
    "kind": ENUM:KIND[OF:TYPE],
    "name"?: STRING,
    "title"?: STRING,
    "icon"?: PHOSPHOR_ICON_ID,
    "properties": PROPERTIES[OF:TYPE]|{},
    "description": MARKDOWN,
    "image": URL,
    "variant": ENUM:COLOR
}
```

---

## Data Types

- `MARKDOWN=STRING|STRING[]`
- `URL=STRING|{"url": STRING, "type": ENUM:URL_TYPE}`
- `DATE={"timestamp"?: NUMBER, "iso_date"?: STRING}`
- `CONTACT={"email"?: STRING[], "phone"?: STRING[], "links"?: STRING[]}`
- `LOCATION=STRING|{ "coordinate"?: COORDINATE, "address"?: ADDRESS }`
- `COORDINATE={ "latitude": NUMBER, "longitude": NUMBER }`
- `ADDRESS={ "street"?: STRING, "house"?: STRING, "flat"?: STRING, "floor"?: NUMBER, "room"?: NUMBER, "square"?: NUMBER, "price"?: NUMBER }`
- `ID=KEY[STRING|NUMBER]`
- `BIOGRAPHY={ "firstName"?: STRING, "lastName"?: STRING, "middleName"?: STRING, "nickName"?: STRING, "birthdate"?: DATE, "gender"?: ENUM:GENDER }`

---

## Enums

- `TYPE="task"|"event"|"action"|"service"|"item"|"skill"|"vendor"|"place"|"factor"|"person"|"bonus"`
- `COLOR="red"|"green"|"blue"|"yellow"|"orange"|"purple"|"brown"|"gray"|"black"|"white"`
- `TASK_STATUS="under_consideration"|"pending"|"in_progress"|"completed"|"failed"|"delayed"|"canceled"|"other"`
- `AFFECT="positive"|"negative"|"neutral"`
- `GENDER="male"|"female"|"other"`
- `URL_TYPE="website"|"email"|"phone"|"social"|"other"`

### Kinds

```
KIND=MAPPED_BY[TYPE][
    ["task", ENUM="job"|"action"|"other"],
    ["event", ENUM="education"|"lecture"|"conference"|"meeting"|"seminar"|"workshop"|"presentation"|"celebration"|"opening"|"other"],
    ["action", ENUM="thinking"|"imagination"|"remembering"|"speaking"|"learning"|"listening"|"reading"|"writing"|"moving"|"traveling"|"speech"|"physically"|"crafting"|"following"|"other"],
    ["service", ENUM="product"|"consultation"|"advice"|"medical"|"mentoring"|"training"|"item"|"thing"|"other"],
    ["item", ENUM="currency"|"book"|"electronics"|"furniture"|"medicine"|"tools"|"software"|"consumables"|"other"],
    ["skill", ENUM="skill"|"knowledge"|"ability"|"trait"|"experience"|"other"],
    ["vendor", ENUM="vendor"|"company"|"organization"|"institution"|"other"],
    ["place", ENUM="placement"|"place"|"school"|"university"|"service"|"clinic"|"pharmacy"|"hospital"|"library"|"market"|"location"|"shop"|"restaurant"|"cafe"|"bar"|"hotel"|"other"],
    ["factor", ENUM="weather"|"health"|"family"|"relationships"|"job"|"traffic"|"business"|"economy"|"politics"|"news"|"other"],
    ["person", ENUM="specialist"|"consultant"|"coach"|"mentor"|"dear"|"helper"|"assistant"|"friend"|"family"|"relative"|"other"]
]
```

---

## Data Maps

```
PROPERTIES=MAPPED_BY[TYPE][
    ["task", TASK_STRUCTURE],
    ["event", EVENT_STRUCTURE],
    ["action", ACTION_STRUCTURE],
    ["service", SERVICE_STRUCTURE],
    ["item", ITEM_STRUCTURE],
    ["skill", SKILL_STRUCTURE],
    ["vendor", VENDOR_STRUCTURE],
    ["place", PLACE_STRUCTURE],
    ["factor", FACTOR_STRUCTURE],
    ["person", PERSON_STRUCTURE]
]
```

---

## Properties Structures

### Task

Important: Task can't be recognized directly from data source, but can be created by preference or user/prompt desire.

```
TASK_STRUCTURE={
    "status": ENUM:TASK_STATUS,
    "begin_time": DATE,
    "end_time": DATE,
    "location"?: LOCATION,
    "contacts"?: CONTACT,
    "members"?: ID[],
    "events"?: ID[],
}
```

### Event

```
EVENT_STRUCTURE={
    "begin_time": DATE,
    "end_time": DATE,
    "location": LOCATION,
    "contacts": CONTACT
}
```

### Person

```
PERSON_STRUCTURE={
    "home": LOCATION,
    "jobs": LOCATION[],
    "biography": BIOGRAPHY,
    "tasks": ID[],
    "contacts": CONTACT,
    "services": ID[],
    "prices": MAP<STRING,NUMBER>
}
```

### Service

```
SERVICE_STRUCTURE={
    "location": LOCATION,
    "persons": ID[],
    "specialization": STRING[],
    "contacts": CONTACT,
    "prices": MAP<STRING,NUMBER>
}
```

### Factor

```
FACTOR_STRUCTURE={
    "affect": ENUM:AFFECT,
    "actions": ID[],
    "location": LOCATION,
}
```

### Bonus

```
BONUS_STRUCTURE={
    "code"?: STRING,
    "usableFor"?: ID[],
    "usableIn"?: ID[],
    "availability"?: {
        "count: NUMBER,
        "time": STRING[],
        "days": STRING[]
    },
    "requirements"?: ANY[],
    "additionalProperties"?: MAP<STRING,UNKNOWN>,
    "profits"?: MAP<STRING,NUMBER>
}
```

### OTHER

TODO: Planned to explain later.

---

## Other types

TODO: Planned to explain later.

---

## Appendix: Name Generation

```
"Give potential IDs for entities in following rules:",

Rules for generating entity IDs ('id' fields, ID type):
- Letters or numbers (only in lowercase)
- Allowed symbols, such as '-', '_', '&', '#', '+'
- Whitespace not allowed
- No emojis or special symbols
- No Cyrillic or Latin letters
- Only promo-codes or codes may has uppercase letters

How generates entity IDs:
- If known person names (biography), use formatted their names, location or job also can be used.
- Prefixed by service, market or vendor (if bonus entity, such as promo, discount, bonus, etc.)
- Name, type or kind (if no name declared) of entity encodes into ID by conversion spaces into '-', etc.
- CODE suffix is used for unique code of entity, such as promo-code, discount-code, etc.

For example:

/*
   - [in bonuses list] zdravia-clinic_therapist_CODE123 - promo-code for therapist of zdravia-clinic
   - [in persons list] alena-victorovna_additional-identifier - person of Alena Viktorovna, for additional identifier may be used service, skill, email or phone number
   - [in items list] book_the-best-book - book of the best book
*/

Such idea used for make simpler search, filtering and sorting of entities.
```

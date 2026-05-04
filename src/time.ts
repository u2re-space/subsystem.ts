/**
 * `core/time` alias target (`core/*` → `src/shared/*`).
 * Mirrors the time exports from `shared/index.ts` without pulling the full core surface.
 */
export {
    getTimeZone,
    isPureHHMM,
    parseDateCorrectly,
    parseAndGetCorrectTime,
    getComparableTimeValue,
    isDate,
    checkInTimeRange,
    checkRemainsTime,
    getISOWeekNumber,
    createDayDescriptor,
    insideOfDay,
    notInPast,
    SplitTimelinesByDays,
    computeTimelineOrderInGeneral,
    computeTimelineOrderInsideOfDay,
    normalizeSchedule,
    formatAsTime,
    formatAsDate,
    formatDateTime
} from "../../../../modules/projects/fl.ui/src/ui/misc/Time";

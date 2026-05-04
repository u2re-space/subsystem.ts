/*
 * This code makes detailed plan by AI for N day or days (aka. Timeline).
 * Used data: preferences, shortlist of data, some entity set (recognized by preferences context), etc.
 * Info detailed by: description, steps, locations, actions, time, etc.
 * Has few steps:
 * - 0. Send existing timeline data to AI for context (is exists and needed)
 * - 1. Send described preferences data to AI for additional context
 *      - Give current time and date for context, and location for context
 *      - Give factors and events for improve details of plan
 *      - Get optionally suitable entities sets (by shortlist of entities, if exists and needed)
 * - 2. Optional, present some details of entities sets to AI for make plan (if needed and exists)
 *      - Used for recommendations and tips, and improve quality of plan
 * - 3. Get new or modified plan from AI
 * - 4. Handle and save new or modified plan to timeline data
 */

//
import { encode } from "@toon-format/toon";

//
import { getGPTInstance } from "com/service/shared/gpt-utils";
import { readJSONs, readOneMarkDown } from "core/storage/FileSystem";

// Dynamic-only: static `misc/Cache` ties `observed`/`fest/object` into `com-app` and recreates com-app ↔ com-service cycles for the MV3 SW graph.
const loadRealtimeStates = async () => {
    const { realtimeStates } = await import("../misc/Cache");
    return realtimeStates as {
        time: Date;
        timestamp: number;
        coords: unknown;
        otherProps: unknown;
        cards: unknown;
    };
};

// @ts-ignore
import AI_OUTPUT_SCHEMA from "com/template/Entities-v2.md?raw";

//
import { checkRemainsTime } from "core/time";
import { fixEntityId } from "com/template/EntityId";
import { loadSettings } from "com/config/Settings";
import { parseAIResponseSafe } from "core/document/AIResponseParser";

import {
    EVENTS_DIR,
    FACTORS_DIR,
    PLANS_DIR,
    PREFERENCES_DIR,
    TIMELINE_DIR,
} from "core/constants/data-paths";
import type { GPTResponses } from "../model/GPT-Responses";

export {
    EVENTS_DIR,
    FACTORS_DIR,
    PLANS_DIR,
    PREFERENCES_DIR,
    TIMELINE_DIR,
};



// get only today and future tasks, and tasks in the past, but not ended (not finished)
export const filterTasks = (timeline: any[], currentTime: Date, maxDays: number = 7) => {
    return timeline?.filter?.((task) => checkRemainsTime(task?.properties?.begin_time, task?.properties?.end_time, currentTime, maxDays));
}

// get only today and future factors, and factors in the past, but not ended (not finished)
export const filterFactors = (factors: any[], currentTime: Date, maxDays: number = 7) => {
    return factors?.filter?.((factor) => checkRemainsTime(factor?.properties?.begin_time, factor?.properties?.end_time, currentTime, maxDays));
}

// get only today and future events, and events in the past, but not ended (not finished)
export const filterEvents = (events: any[], currentTime: Date, maxDays: number = 7) => {
    return events?.filter?.((event) => checkRemainsTime(event?.properties?.begin_time, event?.properties?.end_time, currentTime, maxDays));
}



//
export const createTimelineGenerator = async (sourcePath: string | null = null, speechPrompt: string | null = null) => {
    const settings = await loadSettings();
    if (!settings || !settings?.ai || !settings.ai?.apiKey) return;

    const realtimeStates = await loadRealtimeStates();

    //
    const gptResponses = await getGPTInstance({
        apiKey: settings.ai?.apiKey,
        baseUrl: settings.ai?.baseUrl,
        model: settings.ai?.model,
        mcp: settings.ai?.mcp,
    });
    if (!gptResponses) return;
    console.log(gptResponses);

    // attach some factors (except finished)
    await gptResponses?.giveForRequest?.(`factors: \`${encode(filterFactors(await readJSONs(FACTORS_DIR), (realtimeStates as any)?.time) as any)}\`\n`);

    // attach some events (except finished)
    await gptResponses?.giveForRequest?.(`events: \`${encode(filterEvents(await readJSONs(EVENTS_DIR), (realtimeStates as any)?.time))}\`\n`);

    //
    if (sourcePath) {
        await gptResponses?.giveForRequest?.(`preferences: \`\`\`${encode(await readOneMarkDown(sourcePath))}\`\`\`\n`);
    } else

    // if no both source path and speech prompt, so make generic working plan for next 7 days
    if (!speechPrompt?.trim?.() || !speechPrompt?.trim?.()?.length) {
        await gptResponses?.giveForRequest?.(`preferences: Make generic working plan for next 7 days...\n`);
    }

    // additional speech prompt
    if (speechPrompt?.trim?.() && speechPrompt?.trim?.()?.length) {
        await gptResponses?.giveForRequest?.(`speech_prompt: \`${encode(speechPrompt)}\`\n`);
    }

    //
    await gptResponses?.askToDoAction?.([`primary_request:`,
        "Analyze starting and existing data, and get be ready to make a new timeline (preferences data will be attached later)...",
        "Also, can you provide markdown pre-formatted verbose data about what you have analyzed and what you will do?",
        "Give ready status in JSON format: \`{ ready: boolean, reason: string, verbose_data: string }\`"
    ]?.join?.("\n"));

    // load all of those into context
    const readyStatus = parseAIResponseSafe<{ ready: boolean; reason: string; verbose_data: string }>(await gptResponses?.sendRequest?.("high", "high") || "{ ready: false, reason: \"No attached data\", verbose_data: \"\" }");
    if (!readyStatus?.ok) {
        console.error("timeline", readyStatus?.error || "Failed to parse AI response");
        return { timeline: [], keywords: [] };
    }
    return readyStatus?.data;
}



//
export const requestNewTimeline = async (gptResponses: GPTResponses, existsTimeline: any | null = null) => {
    if (!gptResponses) return { timeline: [], keywords: [] };

    const realtimeStates = await loadRealtimeStates();

    // attach exists timeline
    if (existsTimeline) {
        await gptResponses?.giveForRequest?.(`current_timeline: \`${encode(existsTimeline)}\`\n`);
    }

    //
    const userTimeZone = Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || "UTC";
    const timezoneOffset = new Date()?.getTimezoneOffset?.() || 0;
    const encodedRealtimeState = encode({
        time: (realtimeStates as any).time?.toISOString?.(),
        timestamp: (realtimeStates as any).timestamp,
        coords: (realtimeStates as any).coords?.toJSON?.(),
        otherProps: (realtimeStates as any).otherProps,
        cards: (realtimeStates as any).cards,
        language: navigator?.language || "ru-RU",
        timezone: userTimeZone,
        timezoneOffset: timezoneOffset
    });

    // use real-time state (oriented on current time and location)
    await gptResponses?.giveForRequest?.(`current_states: \`${encodedRealtimeState}\`\n`);
    await gptResponses?.giveForRequest?.(AI_OUTPUT_SCHEMA);
    await gptResponses?.askToDoAction?.([
        "Make timeline plan in JSON format, according to given schema. Follow by our preferences is was presented...",
        "Write in JSON format, \`[ array of entity of \"task\" type ]\`, according to given schema."
    ].join?.("\n"));

    //
    const existsResponseId = gptResponses?.getResponseId?.();
    const raw = await gptResponses?.sendRequest?.()?.catch?.(console.warn.bind(console));
    const timelines = raw ? parseAIResponseSafe<any>(raw) as any : "{ ready: false, reason: \"No attached data\", keywords: [] }";
    gptResponses?.beginFromResponseId?.(existsResponseId as string | null);

    //
    timelines?.forEach?.((entity: any) => fixEntityId(entity));

    // log timeline
    console.log("timeline", timelines);

    // return timeline (writing is handled by the router via ServiceHelper queue)
    return timelines;
}

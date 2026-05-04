/*
 * Enhanced AI Operations Orchestrator.
 * Coordinates between recognition, modification, selection, and entity resolution.
 * Provides a unified interface for all AI-powered data operations.
 */

import { encode } from "@toon-format/toon";

// Service imports
import type { MCPConfig } from "com/config/SettingsTypes";
import { GPTResponses, type AIResponse } from "../model/GPT-Responses";
import { type DataContext, type DataFilter, type ModificationInstruction } from "../model/GPT-Config";
import { fixEntityId } from "com/template/EntityId";
import { detectEntityTypeByJSON } from "com/template/EntityUtils";
import { getGPTInstance } from "../shared/gpt-utils";

import {
    modifyEntityByPrompt,
    modifyEntityByInstructions,
    batchModifyEntities,
    smartMergeEntities,
    type ModificationResult,
    type BatchModificationResult
} from "./AIDataModifier";

import {
    selectData,
    aiSemanticSearch,
    findSimilar,
    findDuplicates,
    suggestFilters,
    groupBy,
    collectFromMultipleSources,
    type SelectionOptions,
    type SelectionResult,
    type SimilarityResult
} from "./AIDataSelector";

import { resolveEntity } from "./EntityItemResolve";
import { batchRecognize, extractEntities, recognizeWithContext, smartRecognize, type BatchRecognitionResult, type RecognitionResult, type RecognizeByInstructionsOptions } from "./ProcessingData";

//
export type OrchestratorConfig = {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
	mcp?: MCPConfig[];
    defaultEffort?: "none" | "low" | "medium" | "high";
    defaultVerbosity?: "low" | "medium" | "high";
    cacheEnabled?: boolean;
    maxRetries?: number;
}

export type PipelineStep = {
    type: "recognize" | "modify" | "select" | "merge" | "validate" | "transform" | "extract";
    params: any;
    continueOnError?: boolean;
}

export type PipelineResult = {
    ok: boolean;
    steps: { step: string; result: any; error?: string }[];
    finalOutput: any;
    totalTimeMs: number;
}

export type AIWorkflowState = {
    data: any;
    context: DataContext;
    history: { action: string; timestamp: number; result: any }[];
    errors: string[];
}

//
export class AIOrchestrator {
    private config: OrchestratorConfig;
    private gptInstance: GPTResponses | null = null;
    private cache: Map<string, { result: any; timestamp: number }> = new Map();
    private cacheMaxAge: number = 5 * 60 * 1000; // 5 minutes

    constructor(config: OrchestratorConfig = {}) {
        this.config = {
            defaultEffort: "low",
            defaultVerbosity: "low",
            cacheEnabled: true,
            maxRetries: 2,
            ...config
        };
    }

    //
    async initialize(): Promise<boolean> {
        try {
            const gptInstance = await getGPTInstance({
                apiKey: this.config.apiKey,
                baseUrl: this.config.baseUrl,
                model: this.config.model,
                mcp: this.config.mcp,
            });
            if (!gptInstance) {
                console.warn("No API key available for AIOrchestrator");
                return false;
            }

            this.gptInstance = gptInstance;

            return true;
        } catch (e) {
            console.error("Failed to initialize AIOrchestrator:", e);
            return false;
        }
    }

    //
    private getCacheKey(operation: string, params: any): string {
        return `${operation}:${encode(params, { indent: 2 })}`;
    }

    //
    private getFromCache<T>(key: string): T | null {
        if (!this.config.cacheEnabled) return null;

        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
            return cached.result as T;
        }

        return null;
    }

    //
    private setCache(key: string, result: any): void {
        if (!this.config.cacheEnabled) return;

        this.cache.set(key, { result, timestamp: Date.now() });

        // Cleanup old entries
        if (this.cache.size > 100) {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.timestamp > this.cacheMaxAge) {
                    this.cache.delete(k);
                }
            }
        }
    }

    // === RECOGNITION OPERATIONS ===

    //
    async recognize(
        data: File | Blob | string,
        options?: { context?: DataContext; cache?: boolean }
    ): Promise<RecognitionResult> {
        const cacheKey = this.getCacheKey("recognize", { data: typeof data === "string" ? data.substring(0, 100) : "blob" });

        if (options?.cache !== false) {
            const cached = this.getFromCache<RecognitionResult>(cacheKey);
            if (cached) return cached;
        }

        const result = await recognizeWithContext(data, options?.context || {}, "auto", this.config);

        if (result.ok) {
            this.setCache(cacheKey, result);
        }

        return result;
    }

    //
    async recognizeBatch(
        items: (File | Blob | string)[],
        context?: DataContext
    ): Promise<BatchRecognitionResult> {
        return batchRecognize(items, context, 3, this.config);
    }

    //
    async extractEntitiesFromData(
        data: File | Blob | string,
        instructionOptions?: RecognizeByInstructionsOptions
    ): Promise<AIResponse<any[]>> {
        const configWithOptions = instructionOptions ? { ...this.config, ...instructionOptions } : this.config;
        return extractEntities(data, configWithOptions as any);
    }

    //
    async smartRecognize(
        data: File | Blob | string,
        hints?: {
            expectedType?: string;
            language?: string;
            domain?: string;
            extractEntities?: boolean;
        },
        instructionOptions?: RecognizeByInstructionsOptions
    ): Promise<RecognitionResult & { entities?: any[] }> {
        // Note: smartRecognize uses recognizeWithContext internally which handles custom instructions
        // Pass instructionOptions through the config for now
        const configWithOptions = instructionOptions ? { ...this.config, ...instructionOptions } : this.config;
        return smartRecognize(data, hints, configWithOptions as any);
    }

    // === MODIFICATION OPERATIONS ===

    //
    async modifyByPrompt(
        entity: any,
        prompt: string,
        options?: { preserveId?: boolean; preserveType?: boolean }
    ): Promise<ModificationResult> {
        return modifyEntityByPrompt(entity, prompt, {
            preserveId: options?.preserveId ?? true,
            preserveType: options?.preserveType ?? true
        }, this.config);
    }

    //
    async modifyByInstructions(
        entity: any,
        instructions: ModificationInstruction[]
    ): Promise<ModificationResult> {
        return modifyEntityByInstructions(entity, instructions, {}, this.config);
    }

    //
    async batchModify(
        entities: any[],
        prompt: string
    ): Promise<BatchModificationResult> {
        return batchModifyEntities(entities, prompt, {}, 5, this.config);
    }

    //
    async mergeEntities(
        primary: any,
        secondary: any,
        strategy?: "prefer_primary" | "prefer_secondary" | "prefer_newer" | "ask_ai"
    ): Promise<ModificationResult> {
        return smartMergeEntities(primary, secondary, strategy, this.config);
    }

    // === SELECTION OPERATIONS ===

    //
    async select<T = any>(
        data: T[],
        options: SelectionOptions
    ): Promise<SelectionResult<T>> {
        return selectData(data, options);
    }

    //
    async semanticSearch<T = any>(
        data: T[],
        query: string | string[],
        options?: { fields?: string[]; minScore?: number }
    ): Promise<SelectionResult<T>> {
        const terms = Array.isArray(query) ? query : [query];
        return aiSemanticSearch(data, {
            terms,
            fields: options?.fields,
            minScore: options?.minScore,
            mode: "semantic"
        }, this.config);
    }

    //
    async findSimilarEntities<T = any>(
        reference: T,
        candidates: T[],
        threshold?: number
    ): Promise<SimilarityResult<T>[]> {
        return findSimilar(reference, candidates, threshold, 10, this.config);
    }

    //
    async detectDuplicates<T = any>(
        data: T[],
        fields?: string[]
    ): Promise<{ groups: T[][]; duplicateCount: number }> {
        return findDuplicates(data, fields, 0.8, this.config);
    }

    //
    async getSuggestedFilters<T = any>(
        data: T[],
        goal: string
    ): Promise<DataFilter[]> {
        return suggestFilters(data, goal, this.config);
    }

    //
    groupByField<T = any>(
        data: T[],
        field: string
    ): { key: any; items: T[]; count: number }[] {
        return groupBy(data, field);
    }

    //
    async collectAndMerge<T = any>(
        sources: { name: string; data: T[] }[],
        strategy?: "union" | "intersection" | "unique"
    ): Promise<{ items: T[]; sourceBreakdown: Record<string, number> }> {
        return collectFromMultipleSources(sources, strategy);
    }

    // === ENTITY OPERATIONS ===

    //
    async resolveEntityDetails(entity: any): Promise<{ ok: boolean; entities: any[]; error?: string | null }> {
        if (!this.gptInstance) {
            await this.initialize();
        }
        return resolveEntity(this.gptInstance, entity) as Promise<{ ok: boolean; entities: any[]; error?: string | null }>;
    }

    //
    async detectAndAssignType(entity: any): Promise<any> {
        const type = detectEntityTypeByJSON(entity);
        if (type !== "unknown" && !entity.type) {
            entity.type = type;
        }
        fixEntityId(entity);
        return entity;
    }

    //
    async processEntities(
        entities: any[],
        options?: { detectTypes?: boolean; fixIds?: boolean; resolve?: boolean }
    ): Promise<any[]> {
        const processed: any[] = [];

        for (const entity of entities) {
            let result = { ...entity };

            if (options?.detectTypes !== false) {
                const type = detectEntityTypeByJSON(result);
                if (type !== "unknown" && !result.type) {
                    result.type = type;
                }
            }

            if (options?.fixIds !== false) {
                fixEntityId(result);
            }

            processed.push(result);
        }

        return processed;
    }

    // === PIPELINE OPERATIONS ===

    //
    async runPipeline(
        initialData: any,
        steps: PipelineStep[]
    ): Promise<PipelineResult> {
        const startTime = performance.now();

        const result: PipelineResult = {
            ok: true,
            steps: [],
            finalOutput: null,
            totalTimeMs: 0
        };

        let currentData = initialData;

        for (const step of steps) {
            const stepResult: { step: string; result: any; error?: string } = {
                step: step.type,
                result: null
            };

            try {
                switch (step.type) {
                    case "recognize":
                        stepResult.result = await this.recognize(currentData, step.params);
                        if (stepResult.result.ok) {
                            currentData = stepResult.result.recognized_data;
                        }
                        break;

                    case "modify":
                        stepResult.result = await this.modifyByPrompt(
                            currentData,
                            step.params.prompt,
                            step.params.options
                        );
                        if (stepResult.result.ok) {
                            currentData = stepResult.result.modified;
                        }
                        break;

                    case "select":
                        stepResult.result = await this.select(
                            Array.isArray(currentData) ? currentData : [currentData],
                            step.params
                        );
                        currentData = stepResult.result.items;
                        break;

                    case "merge":
                        stepResult.result = await this.mergeEntities(
                            currentData,
                            step.params.secondary,
                            step.params.strategy
                        );
                        if (stepResult.result.ok) {
                            currentData = stepResult.result.modified;
                        }
                        break;

                    case "extract":
                        stepResult.result = await this.extractEntitiesFromData(currentData);
                        if (stepResult.result.ok) {
                            currentData = stepResult.result.data;
                        }
                        break;

                    case "transform":
                        if (typeof step.params.transformFn === "function") {
                            currentData = await step.params.transformFn(currentData);
                            stepResult.result = { ok: true, data: currentData };
                        }
                        break;

                    case "validate":
                        // Simple validation
                        const isValid = step.params.validateFn
                            ? await step.params.validateFn(currentData)
                            : true;
                        stepResult.result = { ok: isValid, data: currentData };
                        if (!isValid && !step.continueOnError) {
                            result.ok = false;
                        }
                        break;
                }

            } catch (e) {
                stepResult.error = String(e);
                if (!step.continueOnError) {
                    result.ok = false;
                }
            }

            result.steps.push(stepResult);

            if (!result.ok && !step.continueOnError) {
                break;
            }
        }

        result.finalOutput = currentData;
        result.totalTimeMs = performance.now() - startTime;

        return result;
    }

    // === WORKFLOW STATE MANAGEMENT ===

    //
    createWorkflowState(initialData: any, context?: DataContext): AIWorkflowState {
        return {
            data: initialData,
            context: context || {},
            history: [],
            errors: []
        };
    }

    //
    async executeWorkflowStep(
        state: AIWorkflowState,
        action: string,
        params: any
    ): Promise<AIWorkflowState> {
        const timestamp = Date.now();
        let result: any;

        try {
            switch (action) {
                case "recognize":
                    result = await this.recognize(state.data, { context: state.context });
                    if (result.ok) {
                        state.data = result.recognized_data;
                    }
                    break;

                case "modify":
                    result = await this.modifyByPrompt(state.data, params.prompt);
                    if (result.ok) {
                        state.data = result.modified;
                    }
                    break;

                case "search":
                    const searchResult = await this.semanticSearch(
                        Array.isArray(state.data) ? state.data : [state.data],
                        params.query
                    );
                    result = searchResult;
                    state.data = searchResult.items;
                    break;

                case "filter":
                    const filterResult = await this.select(
                        Array.isArray(state.data) ? state.data : [state.data],
                        { filters: params.filters }
                    );
                    result = filterResult;
                    state.data = filterResult.items;
                    break;

                case "merge":
                    result = await this.mergeEntities(state.data, params.other);
                    if (result.ok) {
                        state.data = result.modified;
                    }
                    break;

                default:
                    state.errors.push(`Unknown action: ${action}`);
            }

        } catch (e) {
            state.errors.push(`Action ${action} failed: ${String(e)}`);
            result = { ok: false, error: String(e) };
        }

        state.history.push({ action, timestamp, result });
        return state;
    }

    // === UTILITY METHODS ===

    //
    clearCache(): void {
        this.cache.clear();
    }

    //
    getConfig(): OrchestratorConfig {
        return { ...this.config };
    }

    //
    setConfig(config: Partial<OrchestratorConfig>): void {
        Object.assign(this.config, config);
    }

    //
    isInitialized(): boolean {
        return this.gptInstance !== null;
    }
}

// === FACTORY AND SINGLETON ===

let defaultOrchestrator: AIOrchestrator | null = null;

//
export const getOrchestrator = async (): Promise<AIOrchestrator> => {
    if (!defaultOrchestrator) {
        defaultOrchestrator = new AIOrchestrator();
        await defaultOrchestrator.initialize();
    }
    return defaultOrchestrator;
}

//
export const createOrchestrator = (config?: OrchestratorConfig): AIOrchestrator => {
    return new AIOrchestrator(config);
}

// === CONVENIENCE FUNCTIONS ===

//
export const quickProcess = async (
    data: File | Blob | string,
    actions: ("recognize" | "extract" | "normalize")[] = ["recognize"]
): Promise<any> => {
    const orchestrator = await getOrchestrator();

    let result = data;

    for (const action of actions) {
        switch (action) {
            case "recognize":
                const recResult = await orchestrator.recognize(result as any) as RecognitionResult;
                if (recResult.ok) {
                    result = recResult.recognized_data?.[0];
                }
                break;

            case "extract":
                const extResult = await orchestrator.extractEntitiesFromData(result as any);
                if (extResult.ok) {
                    result = extResult.data as any;
                }
                break;

            case "normalize":
                // Process entities
                if (Array.isArray(result)) {
                    result = await orchestrator.processEntities(result as any) as any;
                }
                break;
        }
    }

    return result;
}

//
export const quickModify = async (
    entity: any,
    prompt: string
): Promise<any> => {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.modifyByPrompt(entity, prompt);
    return result.ok ? result.modified : entity;
}

//
export const quickSearch = async <T = any>(
    data: T[],
    query: string
): Promise<T[]> => {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.semanticSearch(data, query);
    return result.items;
}

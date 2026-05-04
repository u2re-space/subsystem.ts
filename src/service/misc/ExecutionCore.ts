/**
 * Rule-based execution engine for recognition and post-processing flows.
 *
 * It selects the best rule for a given input/context pair, records execution
 * history, runs the processor, and optionally propagates clipboard/broadcast
 * side effects after success.
 */
import { processDataWithInstruction } from 'com/service/service/RecognizeData';
import { toBase64 } from 'com/service/model/GPT-Responses';
import { actionHistory, type ActionEntry, type ActionContext, type ActionInput, type ActionResult } from './ActionHistory';

export interface ExecutionRule {
    id: string;
    name: string;
    description: string;
    source: ActionContext['source'];
    inputTypes: ActionInput['type'][];
    action: string;
    condition: (input: ActionInput, context: ActionContext) => boolean;
    processor: (input: ActionInput, context: ActionContext, options?: ExecutionOptions) => Promise<ActionResult>;
    autoCopy: boolean;
    autoSave: boolean;
    priority: number; // Higher priority rules are checked first
}

export interface ExecutionOptions {
    ruleSet?: string;
    forceAction?: string;
    skipHistory?: boolean;
    customInstruction?: string;
    recognitionFormat?: "auto" | "markdown" | "html" | "text" | "json" | "most-suitable" | "most-optimized" | "most-legibility";
    processingFormat?: "markdown" | "html" | "json" | "text" | "typescript" | "javascript" | "python" | "java" | "cpp" | "csharp" | "php" | "ruby" | "go" | "rust" | "xml" | "yaml" | "css" | "scss";
}

/** Main rule engine shared by workcenter, share-target, launch-queue, and CRX flows. */
export class ExecutionCore {
    private rules: ExecutionRule[] = [];
    private ruleSets: Map<string, ExecutionRule[]> = new Map();

    constructor(rules?: ExecutionOptions) {
        this.initializeDefaultRules(rules ?? {
            recognitionFormat: 'markdown',
            processingFormat: 'markdown'
        });
    }

    /** Register one execution rule and keep rules sorted by descending priority. */
    registerRule(rule: ExecutionRule): void {
        this.rules.push(rule);
        this.rules.sort((a, b) => b.priority - a.priority); // Higher priority first
    }

    /** Register a named rule subset for callers that want to restrict matching. */
    registerRuleSet(name: string, rules: ExecutionRule[]): void {
        this.ruleSets.set(name, rules);
    }

    /**
     * Resolve the best rule for this request, execute it, and mirror the result
     * into action history plus any configured follow-up side effects.
     */
    async execute(input: ActionInput, context: ActionContext, options: ExecutionOptions = {}): Promise<ActionResult> {
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create history entry
        const entry: Omit<ActionEntry, 'id' | 'timestamp' | 'result'> = {
            context,
            action: options.forceAction || 'auto',
            input,
            status: 'processing',
            ruleSet: options.ruleSet,
            executionId
        };

        const historyEntry = actionHistory.addEntry(entry);

        try {
            // Find matching rule
            const rule = this.findMatchingRule(input, context, options);

            if (!rule) {
                throw new Error('No matching execution rule found');
            }

            // Update action in history
            actionHistory.updateEntry(historyEntry.id, { action: rule.action });

            // Execute the processor
            const startTime = Date.now();
            const result = await rule.processor(input, context, options);
            const processingTime = Date.now() - startTime;

            // Enhance result with metadata
            const enhancedResult: ActionResult = {
                ...result,
                processingTime,
                autoCopied: rule.autoCopy
            };

            // Update history with result
            actionHistory.updateEntry(historyEntry.id, {
                result: enhancedResult,
                status: 'completed',
                dataCategory: enhancedResult.dataCategory
            });

            // Auto-copy if enabled
            if (rule.autoCopy && enhancedResult.type !== 'error') {
                await this.autoCopyResult(enhancedResult, context);
            }

            return enhancedResult;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Update history with error
            actionHistory.updateEntry(historyEntry.id, {
                status: 'failed',
                error: errorMessage
            });

            // Return error result
            return {
                type: 'error',
                content: errorMessage
            };
        }
    }

    /**
     * Find the best matching rule for the given input and context
     */
    private findMatchingRule(input: ActionInput, context: ActionContext, options: ExecutionOptions): ExecutionRule | null {
        // Check forced action first
        if (options.forceAction) {
            const forcedRule = this.rules.find(rule =>
                rule.action === options.forceAction &&
                rule.source === context.source &&
                rule.inputTypes.includes(input.type)
            );
            if (forcedRule) return forcedRule;
        }

        // Check rule set if specified
        if (options.ruleSet) {
            const ruleSet = this.ruleSets.get(options.ruleSet);
            if (ruleSet) {
                const matchingRule = ruleSet.find(rule =>
                    rule.source === context.source &&
                    rule.inputTypes.includes(input.type) &&
                    rule.condition(input, context)
                );
                if (matchingRule) return matchingRule;
            }
        }

        // Find best matching rule from all rules
        return this.rules.find(rule =>
            rule.source === context.source &&
            rule.inputTypes.includes(input.type) &&
            rule.condition(input, context)
        ) || null;
    }

    /**
     * Auto-copy result to clipboard
     */
    private async autoCopyResult(result: ActionResult, context: ActionContext): Promise<void> {
        try {
            let textToCopy = '';

            // Extract text content based on result type
            switch (result.type) {
                case 'markdown':
                case 'text':
                    textToCopy = result.content;
                    break;
                case 'json':
                    // For JSON, try to extract meaningful text content
                    try {
                        const data = JSON.parse(result.content);
                        if (typeof data === 'string') {
                            textToCopy = data;
                        } else if (data.recognized_data) {
                            textToCopy = Array.isArray(data.recognized_data)
                                ? data.recognized_data.join('\n\n')
                                : String(data.recognized_data);
                        } else {
                            textToCopy = result.content; // Fallback to raw JSON
                        }
                    } catch {
                        textToCopy = result.content;
                    }
                    break;
                case 'html':
                    // Strip HTML tags for clipboard
                    textToCopy = result.content.replace(/<[^>]*>/g, '');
                    break;
                default:
                    return; // Don't auto-copy errors
            }

            if (textToCopy.trim()) {
                // Use different copy methods based on context
                if (context.source === 'chrome-extension') {
                    // Use Chrome extension clipboard API
                    if (typeof chrome !== 'undefined' && chrome.runtime) {
                        // This will be handled by the extension's background script
                        return;
                    }
                } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(textToCopy.trim());
                } else if (typeof document !== 'undefined' && document.body) {
                    // Fallback method - only available in main thread context
                    const textArea = document.createElement('textarea');
                    textArea.value = textToCopy.trim();
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.body.removeChild(textArea);
                } else {
                    // Service worker context - cannot access DOM
                    console.log('[ExecutionCore] Cannot auto-copy in service worker context - DOM not available');
                    return;
                }

                // Broadcast copy notification
                this.notifyCopySuccess(context);
            }
        } catch (error) {
            console.warn('Failed to auto-copy result:', error);
        }
    }

    /**
     * Notify about successful copy
     */
    private notifyCopySuccess(context: ActionContext): void {
        // Broadcast to different contexts based on source
        const message = { type: 'copy-success', context };

        if (context.source === 'chrome-extension') {
            // Chrome extension notification
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage(message);
            }
        } else {
            // Broadcast channel for web contexts
            try {
                const bc = new BroadcastChannel('rs-clipboard');
                bc.postMessage(message);
                bc.close();
            } catch (e) {
                console.warn('Failed to broadcast copy success:', e);
            }
        }
    }

    /**
     * Initialize default execution rules
     */
    private initializeDefaultRules(options?: ExecutionOptions): void {
        // Work Center Rules
        // Text/Markdown files - treat as source data, no recognition needed
        this.registerRule({
            id: 'workcenter-text-files-source',
            name: 'Work Center Text File Source',
            description: 'Process text/markdown files as source data',
            source: 'workcenter',
            inputTypes: ['files'],
            action: 'source',
            condition: (input) => {
                return input.files?.some(f =>
                    f?.type?.startsWith?.('text/') ||
                    f?.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                ) ?? false;
            },
            processor: async (input) => {
                // Read text/markdown files and return as source data
                const textFiles = input.files!.filter((f: File) =>
                    f?.type?.startsWith?.('text/') ||
                    f?.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                );

                let combinedContent = '';
                for (const file of textFiles) {
                    try {
                        const content = await file.text();
                        combinedContent += content + '\n\n';
                    } catch (error) {
                        console.warn(`Failed to read text file ${(file as File)?.name ?? 'unknown file'}:`, error);
                    }
                }

                return {
                    type: 'markdown',
                    content: combinedContent.trim(),
                    dataCategory: 'recognized', // Text files are already "recognized"
                    responseId: `source_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                };
            },
            autoCopy: false,
            autoSave: true,
            priority: 11 // Higher than recognition, lower than analysis
        });

        this.registerRule({
            id: 'workcenter-files-recognize',
            name: 'Work Center File Recognition',
            description: 'Recognize content from uploaded files',
            source: 'workcenter',
            inputTypes: ['files', 'image'],
            action: 'recognize',
            condition: (input) => Boolean((input?.files?.length ?? 0) > 0),
            processor: async (input, context, options) => {
                let result;

                // Determine recognition format instruction
                const formatInstruction = this.getRecognitionFormatInstruction(options?.recognitionFormat);

                // Handle multiple files by creating a combined message
                if (input.files!.length > 1) {
                    // Create a message array with multiple file attachments
                    const messages = [
                        {
                            type: "message",
                            role: "user",
                            content: [
                                { type: "input_text", text: `Analyze and recognize content from the following ${input.files!.length} files. ${formatInstruction}` },
                                ...(await Promise.all(input.files!.map(async (file, index) => {
                                    // Convert each file to the proper format
                                    const FileCtor = (globalThis as any).File;
                                    const isFile = FileCtor && file instanceof FileCtor;

                                    const header = { type: "input_text", text: `\n--- File ${index + 1}: ${file.name} ---\n` };

                                    if (isFile && file.type.startsWith('image/')) {
                                        try {
                                            const arrayBuffer = await file.arrayBuffer();
                                            const bytes = new Uint8Array(arrayBuffer);
                                            const base64 = toBase64(bytes);
                                            return [
                                                header,
                                                {
                                                    type: "input_image",
                                                    detail: "auto",
                                                    image_url: `data:${file.type};base64,${base64}`
                                                }
                                            ];
                                        } catch (error) {
                                            console.warn(`Failed to process image ${file.name}:`, error);
                                            return [
                                                header,
                                                {
                                                    type: "input_text",
                                                    text: `[Failed to process image: ${file.name}]`
                                                }
                                            ];
                                        }
                                    } else {
                                        try {
                                            const text = await file.text();
                                            return [
                                                header,
                                                {
                                                    type: "input_text",
                                                    text: text
                                                }
                                            ];
                                        } catch (error) {
                                            console.warn(`Failed to read file ${file.name}:`, error);
                                            return [
                                                header,
                                                {
                                                    type: "input_text",
                                                    text: `[Failed to read file: ${file.name}]`
                                                }
                                            ];
                                        }
                                    }
                                }))).flat()
                            ].filter(item => item !== null)
                        }
                    ];

                    result = await processDataWithInstruction(
                        messages,
                        {
                            instruction: `Analyze and recognize content from the provided files. ${formatInstruction}`,
                            outputFormat: options?.recognitionFormat || 'auto',
                            intermediateRecognition: { enabled: false } // Already processed
                        }
                    );
                } else {
                    // Single file - use the original approach
                    const file = input.files![0];
                    const FileCtor = (globalThis as any).File;
                    const isFile = FileCtor && file instanceof FileCtor;

                    if (isFile && file.type.startsWith('image/')) {
                        // For single image file, convert to data URL
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const bytes = new Uint8Array(arrayBuffer);
                            const base64 = toBase64(bytes);
                            const dataUrl = `data:${file.type};base64,${base64}`;
                            result = await processDataWithInstruction(
                                dataUrl,
                                {
                                    instruction: `Analyze and recognize content from the provided image. ${formatInstruction}`,
                                    outputFormat: options?.recognitionFormat || 'auto',
                                    intermediateRecognition: { enabled: false }
                                }
                            );
                        } catch (error) {
                            console.warn(`Failed to process image ${(file as File)?.name ?? 'unknown file'}:`, error);
                            result = await processDataWithInstruction(
                                file,
                                {
                                    instruction: `Analyze and recognize content from the provided file. ${formatInstruction}`,
                                    outputFormat: options?.recognitionFormat || 'auto',
                                    intermediateRecognition: { enabled: false }
                                }
                            );
                        }
                    } else {
                        result = await processDataWithInstruction(
                            file,
                            {
                                instruction: 'Analyze and recognize content from the provided file',
                                outputFormat: options?.recognitionFormat || 'auto',
                                intermediateRecognition: { enabled: false }
                            }
                        );
                    }
                }

                return {
                    type: this.detectResultFormat(result),
                    content: this.formatAIResult(result),
                    rawData: result,
                    responseId: result.responseId,
                    dataCategory: 'recognized'
                };
            },
            autoCopy: false,
            autoSave: true,
            priority: 10
        });

        this.registerRule({
            id: 'workcenter-text-analyze',
            name: 'Work Center Text Analysis',
            description: 'Analyze provided text content',
            source: 'workcenter',
            inputTypes: ['text', 'markdown'],
            action: 'analyze',
            condition: (input) => Boolean(input.text || input.recognizedContent),
            processor: async (input, context, options) => {
                const content = input.recognizedContent || input.recognizedData?.content || input.text || '';

                // Determine if we have files that need special processing
                const hasImages = input.files?.some(f => f.type.startsWith('image/') || f.type === 'image/svg+xml') || false;
                const hasSvgContent = typeof content === 'string' && content.includes('<svg');

                // Use user-provided instruction if available, otherwise default to analysis
                const userInstruction = input.text && input.text.trim() && input.text.trim() !== "Analyze and process the provided content intelligently";
                const instructions = userInstruction
                    ? input?.text?.trim?.()
                    : `Analyze the provided content. ${this.getProcessingFormatInstruction(options?.processingFormat)}`;

                const result = await processDataWithInstruction(
                    hasImages || hasSvgContent ? [content, ...(input.files || [])] : content,
                    {
                        instruction: instructions,
                        outputFormat: options?.processingFormat || 'auto',
                        outputLanguage: 'auto',
                        enableSVGImageGeneration: 'auto',
                        intermediateRecognition: {
                            enabled: hasImages,
                            outputFormat: options?.recognitionFormat || 'markdown',
                            dataPriorityInstruction: undefined,
                            cacheResults: true
                        },
                        dataType: hasSvgContent ? 'svg' : (hasImages ? 'image' : 'text'),
                        processingEffort: 'medium',
                        processingVerbosity: 'medium'
                    }
                );

                return {
                    type: this.detectResultFormat(result),
                    content: this.formatAIResult(result),
                    rawData: result,
                    responseId: result.responseId,
                    dataCategory: 'processed'
                };
            },
            autoCopy: false,
            autoSave: true,
            priority: 9
        });

        // Share Target Rules
        // Share target text/markdown files - treat as source data
        this.registerRule({
            id: 'share-target-text-files-source',
            name: 'Share Target Text File Source',
            description: 'Process shared text/markdown files as source data',
            source: 'share-target',
            inputTypes: ['files'],
            action: 'source',
            condition: (input) => {
                return input.files?.some?.((f: File) =>
                    f?.type?.startsWith?.('text/') ||
                    f?.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                ) ?? false;
            },
            processor: async (input) => {
                // Read text/markdown files and return as source data
                const textFiles = input.files!.filter?.((f: File) =>
                    f?.type?.startsWith?.('text/') ||
                    f?.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                );

                let combinedContent = '';
                for (const file of textFiles) {
                    try {
                        const content = await file.text();
                        combinedContent += content + '\n\n';
                    } catch (error) {
                        console.warn(`Failed to read text file ${(file as File)?.name ?? 'unknown file'}:`, error);
                    }
                }

                return {
                    type: 'markdown',
                    content: combinedContent.trim(),
                    dataCategory: 'recognized', // Text files are already "recognized"
                    responseId: `share_source_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                };
            },
            autoCopy: false,
            autoSave: true,
            priority: 16 // Higher priority for share target
        });

        this.registerRule({
            id: 'share-target-images-recognize',
            name: 'Share Target Image Recognition',
            description: 'Recognize content from shared images',
            source: 'share-target',
            inputTypes: ['image', 'files'],
            action: 'recognize',
            condition: (input) => input.files?.some(f => f.type.startsWith('image/')) || false,
            processor: async (input) => {
                const imageFiles = input.files!.filter(f => f.type.startsWith('image/'));
                let result;

                if (imageFiles.length > 1) {
                    // Handle multiple images
                    const messages = [
                        {
                            type: "message",
                            role: "user",
                            content: [
                                { type: "input_text", text: `Recognize and extract text/content from the following ${imageFiles.length} shared images:` },
                                ...(await Promise.all(imageFiles.map(async (file, index) => {
                                    try {
                                        const arrayBuffer = await file.arrayBuffer();
                                        const bytes = new Uint8Array(arrayBuffer);
                                        const base64 = btoa(String.fromCharCode(...bytes));
                                        return [
                                            { type: "input_text", text: `\n--- Image ${index + 1}: ${(file as File)?.name ?? 'unknown file'} ---\n` },
                                            {
                                                type: "input_image",
                                                detail: "auto",
                                                image_url: `data:${file.type};base64,${base64}`
                                            }
                                        ];
                                    } catch (error) {
                                        console.warn(`Failed to process image ${(file as File)?.name ?? 'unknown file'}:`, error);
                                        return [
                                            { type: "input_text", text: `\n--- Image ${index + 1}: ${(file as File)?.name ?? 'unknown file'} ---\n` },
                                            {
                                                type: "input_text",
                                                text: `[Failed to process image: ${(file as File)?.name ?? 'unknown file'}]`
                                            }
                                        ];
                                    }
                                }))).flat()
                            ]
                        }
                    ];

                    result = await processDataWithInstruction(
                        messages,
                        {
                            instruction: 'Recognize and extract text/content from the shared images',
                            outputFormat: options?.recognitionFormat || 'auto',
                            intermediateRecognition: { enabled: false }
                        }
                    );
                } else {
                    // Single image
                    result = await processDataWithInstruction(
                        imageFiles[0],
                        {
                            instruction: 'Recognize and extract text/content from the shared image',
                            outputFormat: options?.recognitionFormat || 'auto',
                            intermediateRecognition: { enabled: false }
                        }
                    );
                }

                return {
                    type: this.detectResultFormat(result),
                    content: this.formatAIResult(result),
                    rawData: result,
                    responseId: result.responseId,
                    dataCategory: 'recognized'
                };
            },
            autoCopy: true,
            autoSave: true,
            priority: 15
        });

        this.registerRule({
            id: 'share-target-markdown-view',
            name: 'Share Target Markdown View',
            description: 'View shared markdown content',
            source: 'share-target',
            inputTypes: ['text', 'markdown'],
            action: 'view',
            condition: (input) => this.isMarkdownContent(input.text || ''),
            processor: async (input) => {
                // For markdown content shared via share target, just return it as-is
                return {
                    type: 'markdown',
                    content: input.text || ''
                };
            },
            autoCopy: false,
            autoSave: true,
            priority: 14
        });

        this.registerRule({
            id: 'share-target-url-analyze',
            name: 'Share Target URL Analysis',
            description: 'Analyze shared URL content',
            source: 'share-target',
            inputTypes: ['url'],
            action: 'analyze',
            condition: () => true,
            processor: async (input, context, options) => {
                const instructions = `Analyze the content from this URL and provide insights. ${this.getProcessingFormatInstruction(options?.processingFormat)}`;
                const result = await processDataWithInstruction(
                    input.url!,
                    {
                        instruction: instructions,
                        outputFormat: options?.processingFormat || 'auto',
                        outputLanguage: 'auto',
                        enableSVGImageGeneration: 'auto',
                        intermediateRecognition: { enabled: false },
                        dataType: 'text'
                    }
                );

                return {
                    type: this.detectResultFormat(result),
                    content: this.formatAIResult(result),
                    rawData: result,
                    responseId: result.responseId,
                    dataCategory: 'recognized'
                };
            },
            autoCopy: true,
            autoSave: true,
            priority: 13
        });

        // Chrome Extension Rules
        // Chrome extension text/markdown files - treat as source data
        this.registerRule({
            id: 'chrome-extension-text-files-source',
            name: 'Chrome Extension Text File Source',
            description: 'Process Chrome extension text/markdown files as source data',
            source: 'chrome-extension',
            inputTypes: ['files'],
            action: 'source',
            condition: (input) => {
                return input.files?.some(f =>
                    f?.type?.startsWith?.('text/') ||
                    f?.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                ) ?? false;
            },
            processor: async (input) => {
                // Read text/markdown files and return as source data
                const textFiles = input.files!.filter(f =>
                    f?.type?.startsWith?.('text/') ||
                    f?.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                );

                let combinedContent = '';
                for (const file of textFiles) {
                    try {
                        const content = await file.text();
                        combinedContent += content + '\n\n';
                    } catch (error) {
                        console.warn(`Failed to read text file ${(file as File)?.name ?? 'unknown file'}:`, error);
                    }
                }

                return {
                    type: 'markdown',
                    content: combinedContent.trim(),
                    dataCategory: 'recognized', // Text files are already "recognized"
                    responseId: `crx_source_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                };
            },
            autoCopy: true, // Chrome extension often wants immediate results
            autoSave: true,
            priority: 26 // Higher priority for Chrome extension
        });

        this.registerRule({
            id: 'chrome-extension-screenshot-recognize',
            name: 'Chrome Extension Screenshot Recognition',
            description: 'Recognize content from screenshot',
            source: 'chrome-extension',
            inputTypes: ['image'],
            action: 'recognize',
            condition: () => true,
            processor: async (input) => {
                let result;

                if (input.files!.length > 1) {
                    // Handle multiple screenshots
                    const messages = [
                        {
                            type: "message",
                            role: "user",
                            content: [
                                { type: "input_text", text: `Analyze the following ${input.files!.length} screenshots and extract any visible text or content:` },
                                ...(await Promise.all(input.files!.map(async (file, index) => {
                                    try {
                                        const arrayBuffer = await file.arrayBuffer();
                                        const bytes = new Uint8Array(arrayBuffer);
                                        const base64 = toBase64(bytes);
                                        return [
                                            { type: "input_text", text: `\n--- Screenshot ${index + 1}: ${file.name} ---\n` },
                                            {
                                                type: "input_image",
                                                detail: "auto",
                                                image_url: `data:${file.type};base64,${base64}`
                                            }
                                        ];
                                    } catch (error) {
                                        console.warn(`Failed to process screenshot ${file.name}:`, error);
                                        return [
                                            { type: "input_text", text: `\n--- Screenshot ${index + 1}: ${file.name} ---\n` },
                                            {
                                                type: "input_text",
                                                text: `[Failed to process screenshot: ${file.name}]`
                                            }
                                        ];
                                    }
                                }))).flat()
                            ]
                        }
                    ];

                    result = await processDataWithInstruction(
                        messages,
                        {
                            instruction: 'Analyze the screenshots and extract any visible text or content',
                            outputFormat: options?.recognitionFormat || 'auto',
                            intermediateRecognition: { enabled: false }
                        }
                    );
                } else {
                    // Single screenshot
                    const file = input.files![0];
                    const FileCtor = (globalThis as any).File;
                    const isFile = FileCtor && file instanceof FileCtor;

                    if (isFile && file.type.startsWith('image/')) {
                        // For single screenshot, convert to data URL
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const bytes = new Uint8Array(arrayBuffer);
                            const base64 = toBase64(bytes);
                            const dataUrl = `data:${file.type};base64,${base64}`;
                            result = await processDataWithInstruction(
                                dataUrl,
                                {
                                    instruction: 'Analyze the screenshot and extract any visible text or content',
                                    outputFormat: options?.recognitionFormat || 'auto',
                                    intermediateRecognition: { enabled: false }
                                }
                            );
                        } catch (error) {
                            console.warn(`Failed to process screenshot ${(file as File)?.name ?? 'unknown file'}:`, error);
                            result = await processDataWithInstruction(
                                file,
                                {
                                    instruction: 'Analyze the screenshot and extract any visible text or content',
                                    outputFormat: options?.recognitionFormat || 'auto',
                                    intermediateRecognition: { enabled: false }
                                }
                            );
                        }
                    } else {
                        result = await processDataWithInstruction(
                            file,
                            {
                                instruction: 'Analyze the screenshot and extract any visible text or content',
                                outputFormat: options?.recognitionFormat || 'auto',
                                intermediateRecognition: { enabled: false }
                            }
                        );
                    }
                }

                return {
                    type: this.detectResultFormat(result),
                    content: this.formatAIResult(result),
                    rawData: result,
                    responseId: result.responseId,
                    dataCategory: 'recognized'
                };
            },
            autoCopy: true,
            autoSave: true,
            priority: 20
        });

        // Launch Queue Rules (similar to share target)
        // Launch queue text/markdown files - treat as source data
        this.registerRule({
            id: 'launch-queue-text-files-source',
            name: 'Launch Queue Text File Source',
            description: 'Process launch queue text/markdown files as source data',
            source: 'launch-queue',
            inputTypes: ['files'],
            action: 'source',
            condition: (input) => {
                return input.files?.some(f =>
                    f.type.startsWith('text/') ||
                    f.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                ) ?? false;
            },
            processor: async (input) => {
                // Read text/markdown files and return as source data
                const textFiles = input.files!.filter(f =>
                    f.type.startsWith('text/') ||
                    f.type === 'application/markdown' ||
                    (f as File)?.name?.endsWith?.('.md') ||
                    (f as File)?.name?.endsWith?.('.txt')
                );

                let combinedContent = '';
                for (const file of textFiles) {
                    try {
                        const content = await file.text();
                        combinedContent += content + '\n\n';
                    } catch (error) {
                        console.warn(`Failed to read text file ${(file as File)?.name ?? 'unknown file'}:`, error);
                    }
                }

                return {
                    type: 'markdown',
                    content: combinedContent.trim(),
                    dataCategory: 'recognized', // Text files are already "recognized"
                    responseId: `launch_source_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                };
            },
            autoCopy: true, // Launch queue often wants immediate results
            autoSave: true,
            priority: 21 // Higher priority for launch queue
        });

        this.registerRule({
            id: 'launch-queue-files-process',
            name: 'Launch Queue File Processing',
            description: 'Process files from launch queue',
            source: 'launch-queue',
            inputTypes: ['files', 'mixed'],
            action: 'process',
            condition: () => true,
            processor: async (input) => {
                let result;

                if (input.files!.length > 1) {
                    // Handle multiple files from launch queue
                    const messages = [
                        {
                            type: "message",
                            role: "user",
                            content: [
                                { type: "input_text", text: `Process the following ${input.files!.length} files:` },
                                ...(await Promise.all(input.files!.map(async (file, index) => {
                                    const FileCtor = (globalThis as any).File;
                                    const isFile = FileCtor && file instanceof FileCtor;

                                    const header = { type: "input_text", text: `\n--- File ${index + 1}: ${file.name} ---\n` };

                                    if (isFile && file.type.startsWith('image/')) {
                                        try {
                                            const arrayBuffer = await file.arrayBuffer();
                                            const bytes = new Uint8Array(arrayBuffer);
                                            const base64 = toBase64(bytes);
                                            return [
                                                header,
                                                {
                                                    type: "input_image",
                                                    detail: "auto",
                                                    image_url: `data:${file.type};base64,${base64}`
                                                }
                                            ];
                                        } catch (error) {
                                            console.warn(`Failed to process file ${file.name}:`, error);
                                            return [
                                                header,
                                                {
                                                    type: "input_text",
                                                    text: `[Failed to process file: ${file.name}]`
                                                }
                                            ];
                                        }
                                    } else {
                                        try {
                                            const text = await file.text();
                                            return [
                                                header,
                                                {
                                                    type: "input_text",
                                                    text: text
                                                }
                                            ];
                                        } catch (error) {
                                            console.warn(`Failed to read file ${file.name}:`, error);
                                            return [
                                                header,
                                                {
                                                    type: "input_text",
                                                    text: `[Failed to read file: ${file.name}]`
                                                }
                                            ];
                                        }
                                    }
                                }))).flat()
                            ]
                        }
                    ];

                    result = await processDataWithInstruction(
                        messages,
                        {
                            instruction: 'Process the provided content',
                            outputFormat: options?.processingFormat || 'auto',
                            intermediateRecognition: { enabled: false }
                        }
                    );
                } else {
                    // Single file
                    const file = input.files![0];
                    const FileCtor = (globalThis as any).File;
                    const isFile = FileCtor && file instanceof FileCtor;

                    if (isFile && file.type.startsWith('image/')) {
                        // For single image file, convert to data URL
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const bytes = new Uint8Array(arrayBuffer);
                            const base64 = toBase64(bytes);
                            const dataUrl = `data:${file.type};base64,${base64}`;
                            result = await processDataWithInstruction(
                                dataUrl,
                                {
                                    instruction: 'Process the provided image content',
                                    outputFormat: options?.processingFormat || 'auto',
                                    intermediateRecognition: { enabled: false }
                                }
                            );
                        } catch (error) {
                            console.warn(`Failed to process image ${(file as File)?.name ?? 'unknown file'}:`, error);
                            result = await processDataWithInstruction(
                                file,
                                {
                                    instruction: 'Process the provided content',
                                    outputFormat: options?.processingFormat || 'auto',
                                    intermediateRecognition: { enabled: false }
                                }
                            );
                        }
                    } else {
                        result = await processDataWithInstruction(
                            file,
                            {
                                instruction: 'Process the provided content',
                                outputFormat: options?.processingFormat || 'auto',
                                intermediateRecognition: { enabled: false }
                            }
                        );
                    }
                }

                return {
                    type: this.detectResultFormat(result),
                    content: this.formatAIResult(result),
                    rawData: result,
                    responseId: result.responseId,
                    dataCategory: 'recognized'
                };
            },
            autoCopy: true,
            autoSave: true,
            priority: 12
        });
    }

    /**
     * Check if content is markdown
     */
    private isMarkdownContent(text: string): boolean {
        if (!text || typeof text !== 'string') return false;

        const trimmed = text.trim();
        if (trimmed.startsWith("<") && trimmed.endsWith(">")) return false;
        if (/<[a-zA-Z][^>]*>/.test(trimmed)) return false;

        // Check for markdown patterns
        const patterns = [
            /^---[\s\S]+?---/, // YAML frontmatter
            /^#{1,6}\s+.+$/m, // Headings
            /^\s*[-*+]\s+\S+/m, // Unordered lists
            /^\s*\d+\.\s+\S+/m, // Ordered lists
            /`{1,3}[^`]*`{1,3}/, // Code blocks/inline code
            /\[([^\]]+)\]\(([^)]+)\)/, // Links
            /!\[([^\]]+)\]\(([^)]+)\)/, // Images
        ];

        return patterns.some(pattern => pattern.test(text));
    }

    /**
     * Format AI result for display
     */
    private detectResultFormat(result: any): 'json' | 'markdown' | 'text' | 'html' {
        if (!result) return 'text';

        try {
            // Check if result.data exists and is an object
            const data = result.data || result;

            // If it's structured recognition data (has specific fields), return JSON
            if (data && typeof data === 'object') {
                const hasStructuredFields = [
                    'recognized_data',
                    'verbose_data',
                    'keywords_and_tags',
                    'confidence',
                    'suggested_type',
                    'using_ready'
                ].some(field => field in data);

                if (hasStructuredFields) {
                    return 'json';
                }

                // If it's any other object, check if it looks like markdown content
                if (data.content || data.text || data.message) {
                    return 'markdown';
                }

                // Default to JSON for objects
                return 'json';
            }

            // If it's a string, check if it looks like markdown
            if (typeof data === 'string') {
                // Simple heuristic: if it contains markdown-like elements or is multi-line
                if (data.includes('\n') || data.includes('#') || data.includes('*') || data.includes('`')) {
                    return 'markdown';
                }
                return 'text';
            }

            // Default fallback
            return 'json';
        } catch (error) {
            console.warn('Failed to detect result format:', error);
            return 'text';
        }
    }

    private formatAIResult(result: any): string {
        if (!result) return 'No result';

        try {
            // Extract meaningful content from AI response
            let content = '';

            if (result.data) {
                if (typeof result.data === 'string') {
                    content = result.data;
                } else if (result.data.recognized_data) {
                    const recognized = result.data.recognized_data;
                    content = Array.isArray(recognized) ? recognized.join('\n\n') : String(recognized);
                } else {
                    content = JSON.stringify(result.data, null, 2);
                }
            } else if (typeof result === 'string') {
                content = result;
            } else {
                content = JSON.stringify(result, null, 2);
            }

            // Unwrap unwanted code block formatting
            content = this.unwrapUnwantedCodeBlocks(content);

            return content;
        } catch (error) {
            console.warn('Failed to format AI result:', error);
            return String(result);
        }
    }

    private unwrapUnwantedCodeBlocks(content: string): string {
        if (!content) return content;

        // Remove wrapping code blocks that are not intended for code
        // Pattern: ```language\ncontent\n```
        const codeBlockRegex = /^```(?:katex|md|markdown|html|xml|json|text)?\n([\s\S]*?)\n```$/;

        const match = content.trim().match(codeBlockRegex);
        if (match) {
            const unwrapped = match[1].trim();

            // Additional check: if the unwrapped content looks like it should be wrapped
            // (e.g., actual code, or multiple lines that are clearly formatted content),
            // keep the original. Otherwise, unwrap it.
            const lines = unwrapped.split('\n');

            // If it's a single line or looks like markup/math, unwrap
            if (lines.length === 1 ||
                unwrapped.includes('<math') ||
                unwrapped.includes('<span class="katex') ||
                unwrapped.includes('<content') ||
                unwrapped.startsWith('<') && unwrapped.endsWith('>') ||
                /^\s*<[^>]+>/.test(unwrapped)) {
                console.log('[AI Response] Unwrapped unwanted code block formatting');
                return unwrapped;
            }

            // If it looks like actual code (multiple lines, indentation, etc.), keep wrapped
            if (lines.length > 3 ||
                lines.some(line => line.match(/^\s{4,}/) || line.includes('function') || line.includes('const ') || line.includes('let '))) {
                return content; // Keep the code block
            }

            // Default to unwrapping for single/multiple simple lines
            console.log('[AI Response] Unwrapped unwanted code block formatting');
            return unwrapped;
        }

        return content;
    }

    private getRecognitionFormatInstruction(format?: "auto" | "markdown" | "html" | "text" | "json" | "most-suitable" | "most-optimized" | "most-legibility"): string {
        if (!format || format === 'auto') {
            return 'Output the content in the most appropriate format (markdown is preferred for structured content).';
        }

        switch (format) {
            case 'most-suitable':
                return 'Analyze the content and output it in the most suitable format for its type and structure. Choose the format that best represents the content\'s nature and purpose.';
            case 'most-optimized':
                return 'Output the content in the most optimized format for storage and transmission efficiency. Prefer compact representations while maintaining essential information.';
            case 'most-legibility':
                return 'Output the content in the most human-readable and legible format. Prioritize clarity, readability, and ease of understanding over compactness.';
            case 'markdown':
                return 'Output the recognized content in Markdown format.';
            case 'html':
                return 'Output the recognized content in HTML format.';
            case 'text':
                return 'Output the recognized content as plain text.';
            case 'json':
                return 'Output the recognized content as structured JSON data.';
            default:
                return 'Output the content in the most appropriate format (markdown is preferred for structured content).';
        }
    }

    private getProcessingFormatInstruction(format?: "markdown" | "html" | "json" | "text" | "typescript" | "javascript" | "python" | "java" | "cpp" | "csharp" | "php" | "ruby" | "go" | "rust" | "xml" | "yaml" | "css" | "scss"): string {
        if (!format || format === 'markdown') {
            return 'Output the processed result in Markdown format.';
        }

        switch (format) {
            case 'html':
                return 'Output the processed result in HTML format.';
            case 'json':
                return 'Output the processed result as structured JSON data.';
            case 'text':
                return 'Output the processed result as plain text.';
            case 'typescript':
                return 'Output the processed result as TypeScript code.';
            case 'javascript':
                return 'Output the processed result as JavaScript code.';
            case 'python':
                return 'Output the processed result as Python code.';
            case 'java':
                return 'Output the processed result as Java code.';
            case 'cpp':
                return 'Output the processed result as C++ code.';
            case 'csharp':
                return 'Output the processed result as C# code.';
            case 'php':
                return 'Output the processed result as PHP code.';
            case 'ruby':
                return 'Output the processed result as Ruby code.';
            case 'go':
                return 'Output the processed result as Go code.';
            case 'rust':
                return 'Output the processed result as Rust code.';
            case 'xml':
                return 'Output the processed result in XML format.';
            case 'yaml':
                return 'Output the processed result in YAML format.';
            case 'css':
                return 'Output the processed result as CSS code.';
            case 'scss':
                return 'Output the processed result as SCSS code.';
            default:
                return 'Output the processed result in Markdown format.';
        }
    }
}

// Singleton instance
export const executionCore = new ExecutionCore();
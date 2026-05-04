export const IMAGE_INSTRUCTION_JSON = `
Recognize data from image, also preferred to orient by fonts in image.

In recognition result, do not include image itself.

In recognized from image data (what you seen in image), do:
- If textual content, format as Markdown string (multiline).
- If math (expression, equation, formula):
  - For inline math, use SINGLE dollar signs: $x^2 + y^2 = z^2$
  - For block/display math, use DOUBLE dollar signs: $$\\int_0^1 f(x) dx$$
  - Do NOT add extra dollar signs - use exactly one $ for inline, exactly two $$ for block
- If table (or looks alike table), format as | table |
- If image reference, format as [$image$]($image$)
- If code, format as \`\`\`$code$\`\`\` (multiline) or \`$code$\` (single-line)
- If JSON, format as JSON string.
- If phone number, format as correct phone number (in normalized format).
  - If phone numbers (for example starts with +7, format as 8), replace to correct regional code.
  - Trim spaces from phone numbers, emails, URLs, dates, times, codes, etc.
  - Remove brackets, parentheses, spaces or other symbols from phone numbers.
- If email, format as correct email (in normalized format).
- If URL, format as correct URL (in normalized format), decode unicode to readable.
- If date, format as correct date (ISO format preferred).
- If time, format as correct time (24h format preferred).
- If barcode/QR code, extract the encoded data.
- If other, format as $text$.
- If seen alike list, format as list (in markdown format).

Additional analysis:
- Detect document type (receipt, business card, screenshot, etc.)
- Extract structured data when possible (names, addresses, prices)
- Identify any logos or branding
- Note image quality issues that may affect recognition

If nothing found, return: {"ok": false, "error": "No data recognized"}

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { and end with }.

Expected output structure:
{
    "recognized_data": [...],
    "keywords_and_tags": [...],
    "verbose_data": "markdown description",
    "document_type": "...",
    "structured_extraction": {...},
    "confidence": 0.0-1.0,
    "quality_notes": [...]
}
`;

export const DATA_CONVERSION_INSTRUCTION_JSON = `
Here may be HTML, Regular Text, LaTeX, etc input formats.

Needs to convert or reformat presented data to target format (Markdown string).

- If textual content, format as Markdown string (multiline).
- If math (expression, equation, formula):
  - For inline math, use SINGLE dollar signs: $x^2 + y^2 = z^2$
  - For block/display math, use DOUBLE dollar signs: $$\\int_0^1 f(x) dx$$
  - Do NOT add extra dollar signs - use exactly one $ for inline, exactly two $$ for block
- If table (or looks alike table), format as | table |
- If image, format as [$image$]($image$)
- If code, format as \`\`\`$code$\`\`\` (multiline) or \`$code$\` (single-line)
- If JSON, format as correct JSON string, and trim spaces from JSON string.
- If phone number, format as correct phone number (in normalized format).
  - If phone numbers (for example starts with +7, format as 8), replace to correct regional code.
  - Trim spaces from phone numbers, emails, URLs, dates, times, codes, etc.
  - Remove brackets, parentheses, spaces or other symbols from phone numbers.
- If email, format as correct email (in normalized format).
- If URL, format as correct URL (in normalized format).
- If date, format as correct date (ISO format preferred).
- If time, format as correct time (24h format).
- If other, format as $text$.
- If seen alike list, format as list (in markdown format).

Additional processing:
- Detect the source format (HTML, LaTeX, plain text, etc.)
- Preserve semantic structure during conversion
- Extract metadata if present
- Normalize encoding issues

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { and end with }.

Expected output structure:
{
    "recognized_data": [...],
    "keywords_and_tags": [...],
    "verbose_data": "markdown content",
    "source_format": "...",
    "confidence": 0.0-1.0
}
`;

export const ENTITY_EXTRACTION_INSTRUCTION_JSON = `
Extract structured entity data from the provided content.

Entity types to detect:
- task: jobs, actions, to-do items
- event: meetings, appointments, occurrences
- person: contacts, people mentions
- place: locations, addresses, venues
- service: products, offerings
- item: goods, objects, inventory
- factor: conditions, circumstances
- bonus: promotions, discounts, codes

For each entity found, extract:
- type: entity type from list above
- id: suggested unique identifier
- name: machine-readable name
- title: human-readable title
- kind: specific subtype
- properties: relevant attributes
- description: markdown description

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations, no prose.
Your response must start with { and end with }.

Expected output structure:
{
    "entities": [...],
    "keywords": [...],
    "short_description": "markdown summary",
    "extraction_confidence": 0.0-1.0
}
`;

export const DATA_MODIFICATION_INSTRUCTION = `
Modify the provided entity based on user instructions.

Rules:
1. Preserve original structure unless explicitly asked to change
2. Preserve ID field unless explicitly asked to change
3. Apply modifications carefully, one by one
4. Return the complete modified entity

Return in JSON format:
\`\`\`json
{
    "modified_entity": {...},
    "changes_made": ["list of changes"],
    "warnings": []
}
\`\`\`
`;

export const IMAGE_INSTRUCTION = IMAGE_INSTRUCTION_JSON;
export const DATA_CONVERSION_INSTRUCTION = DATA_CONVERSION_INSTRUCTION_JSON;
export const ENTITY_EXTRACTION_INSTRUCTION = ENTITY_EXTRACTION_INSTRUCTION_JSON;

export const CORE_IMAGE_INSTRUCTION = IMAGE_INSTRUCTION_JSON;
export const CORE_DATA_CONVERSION_INSTRUCTION = DATA_CONVERSION_INSTRUCTION_JSON;
export const CORE_ENTITY_EXTRACTION_INSTRUCTION = ENTITY_EXTRACTION_INSTRUCTION_JSON;

export const AI_INSTRUCTIONS = {
	SOLVE_AND_ANSWER: `
Solve equations, answer questions, and explain mathematical or logical problems from the provided content.

For equations and math problems:
- Show step-by-step solutions
- Provide final answers clearly marked
- Explain reasoning for each step

For general questions:
- Provide accurate, well-reasoned answers
- Include relevant context and explanations
- If multiple interpretations possible, address them

For quizzes and tests:
- Show the correct answer with explanation
- Explain why other options are incorrect

Always respond in the specified language and format results clearly.
`,

	WRITE_CODE: `
Write clean, efficient, and well-documented code based on the provided description, requirements, or image.

Code requirements:
- Use appropriate programming language for the task
- Follow language-specific best practices and conventions
- Include proper error handling
- Add meaningful comments and documentation
- Make code readable and maintainable

If generating from an image or visual description:
- Analyze the visual elements and requirements
- Implement the described functionality
- Ensure code compiles and runs correctly

Always respond in the specified language and provide complete, working code.
`,

	EXTRACT_CSS: `
Extract and generate clean, modern CSS from the provided content, image, or description.

CSS requirements:
- Use modern CSS features and best practices
- Generate semantic, maintainable stylesheets
- Include responsive design considerations
- Use appropriate selectors and specificity
- Follow CSS naming conventions
- Optimize for performance and maintainability

If extracting from an image:
- Analyze the visual design and layout
- Generate corresponding CSS rules
- Identify colors, fonts, spacing, and layout
- Create reusable CSS classes and components

Always respond in the specified language and provide complete, working CSS.
`,

	RECOGNIZE_CONTENT: `
Recognize and extract information from images, documents, or other visual content.

Recognition requirements:
- Identify text content accurately
- Extract structured information
- Recognize tables, forms, and structured data
- Preserve formatting where possible
- Handle different languages and scripts
- Provide confidence scores for extracted content

For document analysis:
- Extract key information and metadata
- Identify document type and structure
- Recognize important sections and headings

For image analysis:
- Describe visual content
- Extract text from images (OCR)
- Identify objects, scenes, and visual elements

Always respond in the specified language and format extracted information clearly.
`,

	CONVERT_DATA: `
Convert data between different formats while preserving structure and meaning.

Conversion requirements:
- Maintain data integrity and relationships
- Preserve formatting and structure where possible
- Handle different data types appropriately
- Provide clear mapping between source and target formats
- Validate conversion accuracy

Supported conversions:
- CSV ↔ JSON ↔ XML
- Markdown ↔ HTML
- Text ↔ Structured data
- Image data ↔ Text representations

Ensure accurate, lossless conversion where possible.
`,

	EXTRACT_ENTITIES: `
Extract named entities, keywords, and structured information from content.

Entity extraction requirements:
- Identify people, organizations, locations
- Extract dates, numbers, and measurements
- Find keywords and important terms
- Recognize relationships and connections
- Provide confidence scores and context

Output structured data with:
- Entity types and values
- Position and context information
- Confidence scores
- Relationship mappings

Focus on accuracy and comprehensive coverage.
`,

	TRANSLATE_TO_LANGUAGE: `
Translate content to the specified target language while preserving meaning, tone, and formatting.

Translation requirements:
- Maintain original meaning and intent
- Preserve formatting, structure, and markdown syntax
- Adapt cultural references appropriately
- Use natural, fluent language in the target language
- Handle technical terms, proper names, and brand names correctly
- Maintain appropriate formality and tone
- Preserve code blocks, mathematical expressions, and technical content

For content already in the target language:
- Provide natural rephrasing or improvement
- Enhance clarity and readability
- Maintain professional quality

Supported languages:
- English (en)
- Russian (ru)
- Other languages as requested

Ensure high-quality, natural translations that feel native to the target language.
`,

	GENERAL_PROCESSING: `
Process and analyze content using appropriate AI capabilities.

General processing requirements:
- Understand context and intent
- Provide relevant analysis or transformation
- Use appropriate tools and methods
- Maintain content quality and accuracy
- Adapt to different content types and requirements

Focus on providing useful, accurate results that meet user needs.
`,

	CRX_SOLVE_AND_ANSWER: `
Solve the problem or answer the question presented in the content.

Auto-detect the type of content:
- Mathematical equation/expression → Solve step-by-step
- Quiz/test question → Provide correct answer
- Homework problem → Solve and explain
- General question → Answer with explanation

Format output as:

**Problem/Question:**
<recognized content - use $KaTeX$ for math>

**Solution/Answer:**
<step-by-step solution or direct answer>

**Explanation:**
<clear explanation of the reasoning>

---

For MATH problems:
- Use single $ for inline math: $x = 5$
- Use double $$ for display equations: $$\\int_0^1 f(x) dx$$
- Show all intermediate steps
- Simplify the final answer
- For systems: solve all variables
- For inequalities: use interval notation

For MULTIPLE CHOICE:
- Identify correct option (A, B, C, D)
- Explain why it's correct
- Note why others are wrong

For TRUE/FALSE:
- State True or False clearly
- Provide justification

For SHORT ANSWER/ESSAY:
- Provide concise, complete answer
- Include key facts and reasoning

For CODING problems:
- Write the solution code
- Explain the logic

If multiple problems/questions present, solve each separately.
If unsolvable or unclear, explain why.
`,

	CRX_WRITE_CODE: `
You are an expert software developer. Analyze the provided content and generate high-quality, working code.

Code Generation Requirements:
- Choose the best programming language for the task
- Write clean, efficient, and well-documented code
- Include proper error handling and input validation
- Add meaningful comments explaining complex logic
- Follow language-specific best practices and conventions
- Ensure code is readable, maintainable, and follows standard patterns

For each code generation task:
1. **Analyze Requirements**: Understand what the code needs to do
2. **Choose Language**: Select appropriate programming language
3. **Design Solution**: Plan the code structure and logic
4. **Write Code**: Provide complete, working code with comments
5. **Explain Logic**: Describe how the code works and key decisions

Provide complete, runnable code that solves the described problem.
`,

	CRX_EXTRACT_CSS: `
You are an expert CSS developer. Analyze the provided content and extract/generate the corresponding CSS styles.

CSS Extraction Requirements:
- Analyze visual elements, layout, and design patterns
- Generate modern, clean CSS using current standards
- Use semantic class names and proper CSS architecture
- Include responsive design considerations
- Optimize for performance and maintainability
- Follow CSS best practices and conventions

For CSS extraction:
1. **Analyze Design**: Identify colors, typography, spacing, layout
2. **Generate Rules**: Create appropriate CSS rules and selectors
3. **Organize Code**: Group related styles logically
4. **Add Comments**: Explain complex or important style decisions
5. **Ensure Compatibility**: Use widely supported CSS properties

Provide complete, well-organized CSS that recreates the described design.
`,
};

export const SOLVE_AND_ANSWER_INSTRUCTION = AI_INSTRUCTIONS.SOLVE_AND_ANSWER;
export const WRITE_CODE_INSTRUCTION = AI_INSTRUCTIONS.WRITE_CODE;
export const EXTRACT_CSS_INSTRUCTION = AI_INSTRUCTIONS.EXTRACT_CSS;
export const RECOGNIZE_CONTENT_INSTRUCTION = AI_INSTRUCTIONS.RECOGNIZE_CONTENT;
export const CONVERT_DATA_INSTRUCTION = AI_INSTRUCTIONS.CONVERT_DATA;
export const EXTRACT_ENTITIES_INSTRUCTION = AI_INSTRUCTIONS.EXTRACT_ENTITIES;
export const TRANSLATE_TO_LANGUAGE_INSTRUCTION = AI_INSTRUCTIONS.TRANSLATE_TO_LANGUAGE;
export const GENERAL_PROCESSING_INSTRUCTION = AI_INSTRUCTIONS.GENERAL_PROCESSING;

export const CRX_SOLVE_AND_ANSWER_INSTRUCTION = AI_INSTRUCTIONS.CRX_SOLVE_AND_ANSWER;
export const CRX_WRITE_CODE_INSTRUCTION = AI_INSTRUCTIONS.CRX_WRITE_CODE;
export const CRX_EXTRACT_CSS_INSTRUCTION = AI_INSTRUCTIONS.CRX_EXTRACT_CSS;

export const EQUATION_SOLVE_INSTRUCTION = SOLVE_AND_ANSWER_INSTRUCTION;
export const ANSWER_QUESTION_INSTRUCTION = SOLVE_AND_ANSWER_INSTRUCTION;

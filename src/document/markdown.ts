/**
 * Markdown Renderer
 *
 * Shared markdown rendering utility.
 * Uses marked for parsing and optionally highlight.js for code highlighting.
 */

import { H } from "fest/lure";

// ============================================================================
// TYPES
// ============================================================================

export interface RenderOptions {
    /** Enable syntax highlighting for code blocks */
    syntaxHighlight?: boolean;
    /** Enable GitHub Flavored Markdown */
    gfm?: boolean;
    /** Sanitize HTML output */
    sanitize?: boolean;
    /** Base URL for relative links */
    baseUrl?: string;
}

export interface MarkdownResult {
    html: string;
    element?: HTMLElement;
}

// ============================================================================
// SIMPLE MARKDOWN PARSER
// ============================================================================

/**
 * Simple markdown to HTML converter
 * Handles common markdown syntax without external dependencies
 */
function parseMarkdown(markdown: string): string {
    let html = markdown;

    // Escape HTML entities for code content
    const escapeHtml = (text: string) => text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Process code blocks first (before other transformations)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const escapedCode = escapeHtml(code.trim());
        return `<pre><code class="language-${lang || 'text'}">${escapedCode}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers (must be at start of line)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Blockquotes
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^(-{3,}|_{3,}|\*{3,})$/gm, '<hr>');

    // Unordered lists
    html = html.replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Images ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');

    // Paragraphs (double newlines)
    html = html.replace(/\n\n+/g, '</p><p>');

    // Single newlines to <br>
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph if not already
    if (!html.startsWith('<')) {
        html = `<p>${html}</p>`;
    }

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p><br><\/p>/g, '');

    return html;
}

// ============================================================================
// MARKDOWN RENDERING
// ============================================================================

/**
 * Render markdown to HTML string
 */
export async function renderMarkdown(
    markdown: string,
    options: RenderOptions = {}
): Promise<string> {
    const { gfm = true } = options;

    // Try to use marked library if available
    try {
        const { marked } = await import("marked");
        return await marked.parse(markdown, { gfm, breaks: true });
    } catch {
        // Fallback to simple parser
        return parseMarkdown(markdown);
    }
}

/**
 * Render markdown to DOM element
 */
export async function renderMarkdownToElement(
    markdown: string,
    options: RenderOptions = {}
): Promise<HTMLElement> {
    const html = await renderMarkdown(markdown, options);
    return H`<div class="markdown-body">${html}</div>` as HTMLElement;
}

/**
 * Render markdown synchronously (simple parser only)
 */
export function renderMarkdownSync(markdown: string): string {
    return parseMarkdown(markdown);
}

/**
 * Extract plain text from markdown
 */
export function stripMarkdown(markdown: string): string {
    return markdown
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]+`/g, '')
        // Remove headers
        .replace(/^#+\s+/gm, '')
        // Remove emphasis
        .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
        // Remove links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove images
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        // Remove blockquotes
        .replace(/^>\s+/gm, '')
        // Remove horizontal rules
        .replace(/^[-_*]{3,}$/gm, '')
        // Trim whitespace
        .trim();
}

/**
 * Extract title from markdown (first h1 or first line)
 */
export function extractTitle(markdown: string): string {
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    const firstLine = markdown.split('\n')[0];
    return stripMarkdown(firstLine).slice(0, 100);
}

/**
 * Check if content is likely markdown
 */
export function isLikelyMarkdown(content: string): boolean {
    const mdPatterns = [
        /^#+ /m,           // Headers
        /\*\*[^*]+\*\*/,   // Bold
        /\[[^\]]+\]\([^)]+\)/, // Links
        /```[\s\S]*?```/,  // Code blocks
        /^[-*] /m,         // Lists
        /^>\s/m            // Blockquotes
    ];

    return mdPatterns.some(pattern => pattern.test(content));
}

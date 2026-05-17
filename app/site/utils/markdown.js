/**
 * Secure Markdown Parser - Vanilla JavaScript
 * 
 * OWASP A7:2017 - XSS Prevention
 * Security approach: ESCAPE FIRST, then apply markdown formatting.
 * All user inputs are escaped before any markdown parsing occurs.
 * No innerHTML is used with unescaped content.
 * 
 * Supports: Headers, bold, italic, code blocks, inline code, links, lists,
 * blockquotes, horizontal rules, and tables.
 */

(function() {
    'use strict';

    // ============================================================
    // HTML ENTITY ESCAPING (MUST BE DONE FIRST)
    // ============================================================
    
    var HTML_ENTITIES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '`': '&#x60;'
    };

    /**
     * Escapes HTML entities to prevent XSS attacks
     * This MUST be called on raw input before any processing
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`]/g, function(char) {
            return HTML_ENTITIES[char] || char;
        });
    }

    /**
     * Validates that a URL is safe (no javascript:, data:, vbscript: protocols)
     * @param {string} url - URL to validate
     * @returns {boolean} True if URL is safe
     */
    function isValidUrl(url) {
        if (!url) return false;
        var lowerUrl = url.toLowerCase().trim();
        // Block dangerous protocols
        if (lowerUrl.startsWith('javascript:') || 
            lowerUrl.startsWith('data:') ||
            lowerUrl.startsWith('vbscript:') ||
            lowerUrl.startsWith('file:')) {
            return false;
        }
        // Allow safe protocols and relative paths
        return lowerUrl.startsWith('http://') || 
               lowerUrl.startsWith('https://') || 
               lowerUrl.startsWith('mailto:') ||
               lowerUrl.startsWith('/') ||
               lowerUrl.startsWith('#') ||
               !lowerUrl.includes(':');
    }

    // ============================================================
    // MARKDOWN PARSER - WORKS ON PRE-ESCAPED CONTENT
    // ============================================================

    /**
     * Parse markdown to HTML
     * SECURITY: Input is escaped BEFORE markdown processing
     * @param {string} rawText - Raw markdown text (will be escaped first)
     * @returns {string} Safe HTML output
     */
    function parseMarkdown(rawText) {
        if (!rawText) return '';
        
        rawText = normalizeMarkdown(rawText);

        // CRITICAL: Escape ALL HTML first to prevent XSS
        var text = escapeHtml(rawText);
        
        // Store code blocks to protect them from other transformations
        var codeBlocks = [];
        var inlineCodeBlocks = [];
        
        // Extract fenced code blocks (``` or ~~~)
        // Note: backticks are escaped as &#x60; at this point
        text = text.replace(/&#x60;&#x60;&#x60;(\w*)\n([\s\S]*?)&#x60;&#x60;&#x60;/g, function(match, lang, code) {
            var index = codeBlocks.length;
            codeBlocks.push({
                lang: lang,
                code: code.trim()
            });
            return '\x00CODEBLOCK' + index + '\x00';
        });
        
        // Also handle alternative fence style
        text = text.replace(/~~~(\w*)\n([\s\S]*?)~~~/g, function(match, lang, code) {
            var index = codeBlocks.length;
            codeBlocks.push({
                lang: lang,
                code: code.trim()
            });
            return '\x00CODEBLOCK' + index + '\x00';
        });
        
        // Extract inline code (single backticks)
        text = text.replace(/&#x60;([^&#x60;]+?)&#x60;/g, function(match, code) {
            var index = inlineCodeBlocks.length;
            inlineCodeBlocks.push(code);
            return '\x00INLINECODE' + index + '\x00';
        });
        
        // Split into lines for block-level processing
        var lines = text.split('\n');
        var result = [];
        var inList = false;
        var inOrderedList = false;
        var inBlockquote = false;
        var inTable = false;
        var tableRows = [];
        var listItems = [];
        
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var trimmedLine = line.trim();
            
            // Skip empty lines but close open blocks
            if (!trimmedLine) {
                if (inList) {
                    result.push('<ul class="md-list">' + listItems.join('') + '</ul>');
                    listItems = [];
                    inList = false;
                }
                if (inOrderedList) {
                    result.push('<ol class="md-list md-ordered">' + listItems.join('') + '</ol>');
                    listItems = [];
                    inOrderedList = false;
                }
                if (inBlockquote) {
                    result.push('</blockquote>');
                    inBlockquote = false;
                }
                if (inTable && tableRows.length > 0) {
                    result.push(renderTable(tableRows));
                    tableRows = [];
                    inTable = false;
                }
                result.push('<br>');
                continue;
            }
            
            // Check for code block placeholder
            if (trimmedLine.indexOf('\x00CODEBLOCK') === 0) {
                closeOpenBlocks();
                result.push(line);
                continue;
            }
            
            // Headers (# syntax)
            var headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
            if (headerMatch) {
                closeOpenBlocks();
                var level = headerMatch[1].length;
                var headerText = processInlineMarkdown(headerMatch[2]);
                result.push('<h' + level + ' class="md-header md-h' + level + '">' + headerText + '</h' + level + '>');
                continue;
            }
            
            // Horizontal rule
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
                closeOpenBlocks();
                result.push('<hr class="md-hr">');
                continue;
            }
            
            // Blockquote
            if (trimmedLine.indexOf('&gt;') === 0) {
                if (!inBlockquote) {
                    closeOpenBlocks();
                    result.push('<blockquote class="md-blockquote">');
                    inBlockquote = true;
                }
                var quoteContent = trimmedLine.replace(/^(&gt;\s*)+/, '');
                result.push('<p>' + processInlineMarkdown(quoteContent) + '</p>');
                continue;
            } else if (inBlockquote) {
                result.push('</blockquote>');
                inBlockquote = false;
            }
            
            // Table detection (pipes at start and end, or separator line)
            if (trimmedLine.indexOf('|') !== -1) {
                var isTableSeparator = /^\|?[\s-:|]+\|?$/.test(trimmedLine);
                if (isTableSeparator || inTable || /^\|.*\|/.test(trimmedLine)) {
                    if (!inTable) {
                        closeOpenBlocks();
                        inTable = true;
                    }
                    if (!isTableSeparator) {
                        tableRows.push(trimmedLine);
                    }
                    continue;
                }
            }
            if (inTable && tableRows.length > 0) {
                result.push(renderTable(tableRows));
                tableRows = [];
                inTable = false;
            }
            
            // Unordered list (-, *, +)
            var ulMatch = trimmedLine.match(/^[-*+]\s+(.+)$/);
            if (ulMatch) {
                if (inOrderedList) {
                    result.push('<ol class="md-list md-ordered">' + listItems.join('') + '</ol>');
                    listItems = [];
                    inOrderedList = false;
                }
                if (!inList) {
                    closeOtherBlocks(['list']);
                    inList = true;
                }
                listItems.push('<li>' + processInlineMarkdown(ulMatch[1]) + '</li>');
                continue;
            }
            
            // Ordered list (1., 2., etc.)
            var olMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
            if (olMatch) {
                if (inList) {
                    result.push('<ul class="md-list">' + listItems.join('') + '</ul>');
                    listItems = [];
                    inList = false;
                }
                if (!inOrderedList) {
                    closeOtherBlocks(['orderedList']);
                    inOrderedList = true;
                }
                listItems.push('<li>' + processInlineMarkdown(olMatch[2]) + '</li>');
                continue;
            }
            
            // Close lists if we hit non-list content
            if (inList) {
                result.push('<ul class="md-list">' + listItems.join('') + '</ul>');
                listItems = [];
                inList = false;
            }
            if (inOrderedList) {
                result.push('<ol class="md-list md-ordered">' + listItems.join('') + '</ol>');
                listItems = [];
                inOrderedList = false;
            }
            
            // Regular paragraph
            result.push('<p class="md-paragraph">' + processInlineMarkdown(trimmedLine) + '</p>');
        }
        
        // Close any open blocks
        if (inList) {
            result.push('<ul class="md-list">' + listItems.join('') + '</ul>');
        }
        if (inOrderedList) {
            result.push('<ol class="md-list md-ordered">' + listItems.join('') + '</ol>');
        }
        if (inBlockquote) {
            result.push('</blockquote>');
        }
        if (inTable && tableRows.length > 0) {
            result.push(renderTable(tableRows));
        }
        
        // Helper to close open blocks
        function closeOpenBlocks() {
            if (inList) {
                result.push('<ul class="md-list">' + listItems.join('') + '</ul>');
                listItems = [];
                inList = false;
            }
            if (inOrderedList) {
                result.push('<ol class="md-list md-ordered">' + listItems.join('') + '</ol>');
                listItems = [];
                inOrderedList = false;
            }
            if (inBlockquote) {
                result.push('</blockquote>');
                inBlockquote = false;
            }
            if (inTable && tableRows.length > 0) {
                result.push(renderTable(tableRows));
                tableRows = [];
                inTable = false;
            }
        }
        
        function closeOtherBlocks(except) {
            except = except || [];
            if (except.indexOf('list') === -1 && inList) {
                result.push('<ul class="md-list">' + listItems.join('') + '</ul>');
                listItems = [];
                inList = false;
            }
            if (except.indexOf('orderedList') === -1 && inOrderedList) {
                result.push('<ol class="md-list md-ordered">' + listItems.join('') + '</ol>');
                listItems = [];
                inOrderedList = false;
            }
            if (inBlockquote) {
                result.push('</blockquote>');
                inBlockquote = false;
            }
        }
        
        // Join result and restore code blocks
        var html = result.join('\n');
        
        // Restore fenced code blocks
        html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, function(match, index) {
            var block = codeBlocks[parseInt(index, 10)];
            var langClass = block.lang ? ' language-' + block.lang : '';
            return '<pre class="md-code-block' + langClass + '"><code>' + block.code + '</code></pre>';
        });
        
        // Restore inline code
        html = html.replace(/\x00INLINECODE(\d+)\x00/g, function(match, index) {
            return '<code class="md-inline-code">' + inlineCodeBlocks[parseInt(index, 10)] + '</code>';
        });
        
        // Clean up excessive <br> tags
        html = html.replace(/(<br>\s*){3,}/g, '<br><br>');
        
        return html;
    }

    /**
     * Process inline markdown elements (bold, italic, links, etc.)
     * @param {string} text - Pre-escaped text
     * @returns {string} Text with inline markdown converted to HTML
     */
    function processInlineMarkdown(text) {
        if (!text) return '';
        
        // Inline code placeholders (handled separately)
        // Already extracted, so skip
        
        // CRITICAL: Extract and protect URLs BEFORE bold/italic transformations
        // Otherwise underscores in URLs (for example, generated_report_FL_20260226.xlsx) get
        // interpreted as italic markers and corrupt the URL
        var urlPlaceholders = [];
        var identifierPlaceholders = [];
        
        // Protect markdown links [text](url) first
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, linkText, url) {
            var decodedUrl = url
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'");
            
            var replacement;
            if (isValidUrl(decodedUrl)) {
                var safeUrl = url.replace(/"/g, '&quot;');
                replacement = '<a href="' + safeUrl + '" class="md-link" target="_blank" rel="noopener noreferrer">' + linkText + '</a>';
            } else {
                replacement = linkText;
            }
            var index = urlPlaceholders.length;
            urlPlaceholders.push(replacement);
            return '\x00URL' + index + '\x00';
        });
        
        // Protect auto-linked URLs (http:// or https://)
        // Note: & is NOT excluded because after HTML escaping, & becomes &amp;
        // and presigned URLs contain & as query parameter separators that must be preserved
        text = text.replace(/(?<!["\(])https?:\/\/[^\s<>\)]+/g, function(url) {
            var replacement;
            if (isValidUrl(url.replace(/&amp;/g, '&'))) {
                replacement = '<a href="' + url + '" class="md-link" target="_blank" rel="noopener noreferrer">' + url + '</a>';
            } else {
                replacement = url;
            }
            var index = urlPlaceholders.length;
            urlPlaceholders.push(replacement);
            return '\x00URL' + index + '\x00';
        });

        // Protect machine identifiers before bold/italic parsing. AgentCore tool names
        // such as portfolio-planning___get_math_model_input intentionally contain
        // underscores, which otherwise look like markdown emphasis delimiters.
        text = text.replace(/\b[a-zA-Z0-9-]+___[a-zA-Z0-9_-]+\b/g, function(identifier) {
            var index = identifierPlaceholders.length;
            identifierPlaceholders.push('<code class="md-inline-code">' + identifier + '</code>');
            return '\x00IDENTIFIER' + index + '\x00';
        });
        
        // Now safe to apply bold/italic — URLs and identifiers are protected as placeholders
        
        // Bold + Italic (***text*** or ___text___)
        text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
        
        // Bold (**text** or __text__)
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong class="md-bold">$1</strong>');
        
        // Italic (*text* or _text_)
        text = text.replace(/\*([^\*\s][^\*]*?)\*/g, '<em class="md-italic">$1</em>');
        text = text.replace(/_([^_\s][^_]*?)_/g, '<em class="md-italic">$1</em>');
        
        // Strikethrough (~~text~~)
        text = text.replace(/~~(.+?)~~/g, '<del class="md-strikethrough">$1</del>');
        
        // Restore URL placeholders
        text = text.replace(/\x00URL(\d+)\x00/g, function(match, index) {
            return urlPlaceholders[parseInt(index, 10)];
        });
        text = text.replace(/\x00IDENTIFIER(\d+)\x00/g, function(match, index) {
            return identifierPlaceholders[parseInt(index, 10)];
        });
        
        return text;
    }

    /**
     * Render a table from rows
     * @param {Array} rows - Array of table row strings
     * @returns {string} HTML table
     */
    function renderTable(rows) {
        if (rows.length === 0) return '';
        
        var html = '<div class="md-table-wrapper"><table class="md-table"><thead><tr>';
        
        // Parse header row
        var headerCells = parseTableRow(rows[0]);
        headerCells.forEach(function(cell) {
            html += '<th>' + processInlineMarkdown(cell) + '</th>';
        });
        html += '</tr></thead>';
        
        // Parse body rows (skip row 0 which is header)
        if (rows.length > 1) {
            html += '<tbody>';
            for (var i = 1; i < rows.length; i++) {
                var cells = parseTableRow(rows[i]);
                html += '<tr>';
                cells.forEach(function(cell) {
                    html += '<td>' + processInlineMarkdown(cell) + '</td>';
                });
                html += '</tr>';
            }
            html += '</tbody>';
        }
        
        html += '</table></div>';
        return html;
    }

    /**
     * Repair common LLM formatting glitches before secure escaping.
     * Models sometimes stream compact markdown where headings, lists, and tables
     * are adjacent without newlines. This keeps the chat readable without trusting
     * any raw HTML from the model.
     */
    function normalizeMarkdown(rawText) {
        var text = String(rawText || '').replace(/\r\n/g, '\n');

        // Table rows can arrive as "... | value || NEXT | value". Treat double
        // pipes surrounded by optional spaces as a row boundary.
        text = text.replace(/\s+\|\|\s+/g, '\n| ');

        // Ensure headings start on their own line.
        text = text.replace(/([^\n])(\s*#{1,6}\s+)/g, function(_match, before, heading) {
            return before + '\n\n' + heading.trimStart();
        });

        // Split compact heading/list and heading/table forms:
        // "### Summary- Item" -> "### Summary\n- Item"
        // "### Holdings| Symbol |" -> "### Holdings\n| Symbol |"
        // "### Flags1. Item" -> "### Flags\n1. Item"
        text = text.replace(/^(#{1,6}\s+[^-\n|0-9]{3,80})-\s+/gm, '$1\n- ');
        text = text.replace(/^(#{1,6}\s+[^|\n]{3,80})\|/gm, '$1\n|');
        text = text.replace(/^(#{1,6}\s+[^0-9\n|]{3,80})(\d+\.)/gm, '$1\n$2');
        text = text.replace(/(\S)-\s+([A-Z][A-Za-z ]{2,40}:)/g, '$1\n- $2');

        // Split sentences that accidentally run into a new bolded section.
        text = text.replace(/([.!?])(\s*)(\*\*[A-Z][^*]{2,80}\*\*)/g, '$1\n\n$3');

        return text;
    }

    /**
     * Parse a table row into cells
     * @param {string} row - Table row string
     * @returns {Array} Array of cell contents
     */
    function parseTableRow(row) {
        // Remove leading/trailing pipes and split
        var trimmed = row.trim();
        if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
        if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
        return trimmed.split('|').map(function(cell) {
            return cell.trim();
        });
    }

    // ============================================================
    // SAFE DOM RENDERING
    // ============================================================

    /**
     * Safely render markdown to a DOM element
     * @param {HTMLElement} element - Target element
     * @param {string} rawMarkdown - Raw markdown text
     */
    function renderToElement(element, rawMarkdown) {
        if (!element) return;
        
        var html = parseMarkdown(rawMarkdown);
        element.innerHTML = html;
    }

    /**
     * Create a DOM element with rendered markdown
     * @param {string} rawMarkdown - Raw markdown text
     * @returns {HTMLElement} Div element containing rendered markdown
     */
    function createMarkdownElement(rawMarkdown) {
        var div = document.createElement('div');
        div.className = 'md-content';
        div.innerHTML = parseMarkdown(rawMarkdown);
        return div;
    }

    // ============================================================
    // EXPORT
    // ============================================================

    window.MarkdownParser = {
        parse: parseMarkdown,
        renderToElement: renderToElement,
        createElement: createMarkdownElement,
        normalize: normalizeMarkdown,
        escapeHtml: escapeHtml,
        isValidUrl: isValidUrl
    };

})();

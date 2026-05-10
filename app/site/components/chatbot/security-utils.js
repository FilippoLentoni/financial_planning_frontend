/**
 * Security Utilities - XSS Prevention
 * OWASP A7:2017 - XSS compliant
 */

(function() {
    'use strict';

    var HTML_ENTITIES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} - Escaped string
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`=\/]/g, function(char) {
            return HTML_ENTITIES[char] || char;
        });
    }

    /**
     * Safely set text content of an element
     * @param {HTMLElement} element - Target element
     * @param {string} text - Text to set
     */
    function setTextContent(element, text) {
        if (element) element.textContent = text;
    }

    // Export to ChatbotUtils namespace
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.escapeHtml = escapeHtml;
    window.ChatbotUtils.setTextContent = setTextContent;

})();
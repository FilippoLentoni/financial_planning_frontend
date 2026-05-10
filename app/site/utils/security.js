/**
 * Security Utilities Module
 * 
 * OWASP A7:2017 - XSS Prevention
 * Provides utilities for escaping and sanitizing user inputs.
 */

(function() {
    'use strict';

    /**
     * HTML Entity map for escaping dangerous characters
     */
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
     * Escapes HTML entities to prevent XSS attacks
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`=\/]/g, function(char) {
            return HTML_ENTITIES[char] || char;
        });
    }

    /**
     * Safely sets text content of an element (prevents XSS)
     * @param {HTMLElement} element - DOM element
     * @param {string} text - Text to set
     */
    function setTextContent(element, text) {
        if (element) element.textContent = text;
    }

    /**
     * Validates that a URL is safe (no javascript:, data:, vbscript: protocols)
     * @param {string} url - URL to validate
     * @returns {boolean} True if safe
     */
    function isValidUrl(url) {
        if (!url) return false;
        var lowerUrl = url.toLowerCase().trim();
        if (lowerUrl.startsWith('javascript:') || 
            lowerUrl.startsWith('data:') ||
            lowerUrl.startsWith('vbscript:')) {
            return false;
        }
        return lowerUrl.startsWith('http://') || 
               lowerUrl.startsWith('https://') || 
               lowerUrl.startsWith('/') ||
               !lowerUrl.includes(':');
    }

    /**
     * Sanitizes a string for use in HTML attributes
     * @param {string} str - String to sanitize
     * @returns {string} Sanitized string
     */
    function sanitizeAttribute(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Export to window
    window.SecurityUtils = {
        escapeHtml: escapeHtml,
        setTextContent: setTextContent,
        isValidUrl: isValidUrl,
        sanitizeAttribute: sanitizeAttribute
    };

})();

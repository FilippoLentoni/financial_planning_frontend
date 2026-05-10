/**
 * Robot Tool Animation Component
 * 
 * Shows an animated robot executing tools with input/output display in head visor.
 * Security: OWASP10 compliant - all user inputs are escaped before rendering.
 * No external dependencies - pure vanilla JavaScript.
 */

(function() {
    'use strict';

    // ============================================================
    // SECURITY: XSS Prevention Utilities (OWASP A7:2017 - XSS)
    // ============================================================
    
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
     * Escape HTML special characters to prevent XSS attacks.
     * @param {string} str - String to escape
     * @returns {string} Escaped string safe for HTML insertion
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`=\/]/g, function(char) {
            return HTML_ENTITIES[char] || char;
        });
    }

    /**
     * Safely set text content (automatically escapes)
     * @param {HTMLElement} element - DOM element
     * @param {string} text - Text to set
     */
    function setTextContent(element, text) {
        if (element) element.textContent = text;
    }

    /**
     * Truncate string to max length with ellipsis
     * @param {string} str - String to truncate
     * @param {number} maxLen - Maximum length
     * @returns {string} Truncated string
     */
    function truncate(str, maxLen) {
        if (!str) return '';
        str = String(str);
        if (str.length <= maxLen) return str;
        return str.substring(0, maxLen - 3) + '...';
    }

    // ============================================================
    // RobotToolAnimation Class
    // ============================================================

    function RobotToolAnimation() {
        this.overlay = null;
        this.visorName = null;
        this.visorInput = null;
        this.visorOutput = null;
        this.statusText = null;
        this.isActive = false;
        this.currentTool = null;
        
        this.init();
    }

    /**
     * Initialize the robot tool animation overlay
     */
    RobotToolAnimation.prototype.init = function() {
        // Check if already initialized
        if (document.getElementById('robot-tool-overlay')) {
            this.cacheElements();
            return;
        }
        
        // Create the overlay HTML
        var overlayHtml = '\
            <div class="robot-tool-overlay" id="robot-tool-overlay">\
                <div class="robot-tool-container">\
                    <div class="tool-robot">\
                        <div class="tool-robot-head">\
                            <!-- Antenna -->\
                            <div class="tool-robot-antenna"></div>\
                            \
                            <!-- Ears -->\
                            <div class="tool-robot-ear tool-robot-ear-left"></div>\
                            <div class="tool-robot-ear tool-robot-ear-right"></div>\
                            \
                            <!-- Visor Display -->\
                            <div class="tool-robot-visor">\
                                <div class="tool-visor-content">\
                                    <div class="tool-visor-header">\
                                        <span class="tool-visor-icon">🔧</span>\
                                        <span class="tool-visor-name" id="tool-visor-name">TOOL</span>\
                                    </div>\
                                    <div class="tool-visor-data">\
                                        <div class="tool-visor-section">\
                                            <div class="tool-visor-label">INPUT</div>\
                                            <div class="tool-visor-value streaming" id="tool-visor-input">...</div>\
                                        </div>\
                                        <div class="tool-visor-section">\
                                            <div class="tool-visor-label">OUTPUT</div>\
                                            <div class="tool-visor-value output" id="tool-visor-output">Executing...</div>\
                                        </div>\
                                    </div>\
                                </div>\
                            </div>\
                            \
                            <!-- Arms -->\
                            <div class="tool-robot-arms">\
                                <div class="tool-robot-arm tool-robot-arm-left"></div>\
                                <div class="tool-robot-arm tool-robot-arm-right"></div>\
                            </div>\
                            \
                            <!-- Sparks -->\
                            <div class="tool-sparks">\
                                <div class="tool-spark"></div>\
                                <div class="tool-spark"></div>\
                                <div class="tool-spark"></div>\
                                <div class="tool-spark"></div>\
                                <div class="tool-spark"></div>\
                            </div>\
                        </div>\
                    </div>\
                    \
                    <!-- Status -->\
                    <div class="tool-status">\
                        <div class="tool-status-text" id="tool-status-text">\
                            Executing tool: <span class="tool-name" id="tool-status-name">...</span>\
                        </div>\
                        <div class="tool-progress-bar">\
                            <div class="tool-progress-fill"></div>\
                        </div>\
                    </div>\
                </div>\
            </div>';
        
        // Append to body
        var container = document.createElement('div');
        container.innerHTML = overlayHtml;
        document.body.appendChild(container.firstElementChild);
        
        this.cacheElements();
        console.log('[RobotToolAnimation] Initialized');
    };

    /**
     * Cache DOM element references
     */
    RobotToolAnimation.prototype.cacheElements = function() {
        this.overlay = document.getElementById('robot-tool-overlay');
        this.visorName = document.getElementById('tool-visor-name');
        this.visorInput = document.getElementById('tool-visor-input');
        this.visorOutput = document.getElementById('tool-visor-output');
        this.statusText = document.getElementById('tool-status-text');
        this.statusName = document.getElementById('tool-status-name');
    };

    /**
     * Show the robot tool animation for a tool execution
     * @param {Object} toolUse - Tool use object with name and input
     */
    RobotToolAnimation.prototype.show = function(toolUse) {
        // Check for custom tool animation first (wrapped in try-catch for safety)
        try {
            if (window.ToolAnimations && window.ToolAnimations.has(toolUse.name)) {
                console.log('[RobotToolAnimation] Using custom animation for:', toolUse.name);
                this.usingCustomAnimation = true;
                this.customAnimationToolName = toolUse.name;
                window.ToolAnimations.safeShow(toolUse.name, toolUse);
                return; // Don't show default animation
            }
        } catch (e) {
            console.warn('[RobotToolAnimation] Custom animation check failed:', e);
        }
        
        this.usingCustomAnimation = false;
        this.customAnimationToolName = null;
        
        if (!this.overlay) {
            this.init();
        }
        
        this.currentTool = toolUse;
        this.isActive = true;
        
        // SECURITY: Escape all user-provided content before display
        var toolName = escapeHtml(truncate(toolUse.name || 'Unknown Tool', 20));
        var inputStr = '';
        
        try {
            // Convert input to string representation, truncated for display
            var inputObj = toolUse.input || {};
            inputStr = JSON.stringify(inputObj);
            inputStr = truncate(inputStr, 60);
        } catch (e) {
            inputStr = '[complex input]';
        }
        
        // Update visor display - using textContent for safety
        setTextContent(this.visorName, toolName);
        setTextContent(this.visorInput, inputStr);
        setTextContent(this.visorOutput, 'Executing...');
        setTextContent(this.statusName, toolName);
        
        // Add streaming class to input
        if (this.visorInput) {
            this.visorInput.classList.add('streaming');
            this.visorInput.classList.remove('error');
        }
        
        // Reset output styling
        if (this.visorOutput) {
            this.visorOutput.classList.remove('error');
            this.visorOutput.classList.add('output');
        }
        
        // Remove completion/error states
        this.overlay.classList.remove('completed', 'error');
        
        // Show overlay with animation
        this.overlay.classList.add('active');
        
        console.log('[RobotToolAnimation] Showing for tool:', toolUse.name);
    };

    /**
     * Update the output display during execution
     * @param {string} output - Partial or complete output
     */
    RobotToolAnimation.prototype.updateOutput = function(output) {
        // If using custom animation, delegate to it
        if (this.usingCustomAnimation && this.customAnimationToolName) {
            try {
                window.ToolAnimations.safeUpdateOutput(this.customAnimationToolName, output);
            } catch (e) {
                console.warn('[RobotToolAnimation] Custom animation update failed:', e);
            }
            return;
        }
        
        if (!this.isActive) return;
        
        // SECURITY: Escape output before display
        var displayOutput = escapeHtml(truncate(String(output), 80));
        setTextContent(this.visorOutput, displayOutput);
        
        // Keep streaming effect on input while executing
        if (this.visorInput) {
            this.visorInput.classList.remove('streaming');
        }
    };

    /**
     * Complete the tool execution (success)
     * @param {*} result - Tool result
     */
    RobotToolAnimation.prototype.complete = function(result) {
        // If using custom animation, delegate to it
        if (this.usingCustomAnimation && this.customAnimationToolName) {
            try {
                window.ToolAnimations.safeComplete(this.customAnimationToolName, result);
            } catch (e) {
                console.warn('[RobotToolAnimation] Custom animation complete failed:', e);
            }
            this.usingCustomAnimation = false;
            this.customAnimationToolName = null;
            return;
        }
        
        if (!this.isActive) return;
        
        // SECURITY: Escape result before display
        var resultStr = '';
        try {
            if (typeof result === 'string') {
                resultStr = result;
            } else if (result && result.content && Array.isArray(result.content)) {
                // MCP format - extract text from content array
                resultStr = result.content.map(function(c) {
                    return c.text || JSON.stringify(c);
                }).join(' ');
            } else {
                resultStr = JSON.stringify(result);
            }
        } catch (e) {
            resultStr = '[result]';
        }
        
        resultStr = truncate(resultStr, 80);
        setTextContent(this.visorOutput, resultStr);
        
        // Mark as completed
        this.overlay.classList.add('completed');
        
        // Remove streaming class
        if (this.visorInput) {
            this.visorInput.classList.remove('streaming');
        }
        
        console.log('[RobotToolAnimation] Completed');
        
        // Auto-hide after delay
        var self = this;
        setTimeout(function() {
            self.hide();
        }, 1500);
    };

    /**
     * Show error state
     * @param {string} errorMessage - Error message
     */
    RobotToolAnimation.prototype.error = function(errorMessage) {
        // If using custom animation, delegate to it
        if (this.usingCustomAnimation && this.customAnimationToolName) {
            try {
                window.ToolAnimations.safeError(this.customAnimationToolName, errorMessage);
            } catch (e) {
                console.warn('[RobotToolAnimation] Custom animation error display failed:', e);
            }
            this.usingCustomAnimation = false;
            this.customAnimationToolName = null;
            return;
        }
        
        if (!this.isActive) return;
        
        // SECURITY: Escape error message before display
        var displayError = escapeHtml(truncate(String(errorMessage || 'Error'), 80));
        setTextContent(this.visorOutput, '❌ ' + displayError);
        
        // Add error styling
        this.overlay.classList.add('error');
        if (this.visorOutput) {
            this.visorOutput.classList.add('error');
        }
        
        // Remove streaming class
        if (this.visorInput) {
            this.visorInput.classList.remove('streaming');
        }
        
        console.log('[RobotToolAnimation] Error:', errorMessage);
        
        // Auto-hide after delay
        var self = this;
        setTimeout(function() {
            self.hide();
        }, 2000);
    };

    /**
     * Hide the robot tool animation
     */
    RobotToolAnimation.prototype.hide = function() {
        // If using custom animation, delegate to it
        if (this.usingCustomAnimation && this.customAnimationToolName) {
            try {
                window.ToolAnimations.safeHide(this.customAnimationToolName);
            } catch (e) {
                console.warn('[RobotToolAnimation] Custom animation hide failed:', e);
            }
            this.usingCustomAnimation = false;
            this.customAnimationToolName = null;
            return;
        }
        
        if (this.overlay) {
            this.overlay.classList.remove('active');
        }
        
        this.isActive = false;
        this.currentTool = null;
        
        console.log('[RobotToolAnimation] Hidden');
    };

    /**
     * Check if animation is currently active
     * @returns {boolean} True if active
     */
    RobotToolAnimation.prototype.isShowing = function() {
        return this.isActive;
    };

    // ============================================================
    // Export to global scope
    // ============================================================
    
    // Create singleton instance
    window.RobotToolAnimation = new RobotToolAnimation();

})();

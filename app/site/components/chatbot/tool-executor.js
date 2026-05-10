/**
 * Tool Executor - Handles tool execution and approval workflows
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;

    /**
     * ToolExecutor constructor
     * @param {object} options - Configuration options
     */
    function ToolExecutor(options) {
        options = options || {};
        this.toolApprovals = {};
        this.pendingApproval = null;
        this.shouldStop = false;
        
        // Callbacks
        this.onStatusUpdate = options.onStatusUpdate || function() {};
        this.onToolResult = options.onToolResult || function() {};
        
        // DOM elements for approval dialog
        this.approvalOverlay = null;
        this.approvalContent = null;
        
        this.loadToolApprovals();
    }

    /**
     * Set approval dialog elements
     */
    ToolExecutor.prototype.setApprovalElements = function(overlay, content, buttons) {
        this.approvalOverlay = overlay;
        this.approvalContent = content;
        this.approvalButtons = buttons;
        
        var self = this;
        
        if (buttons.approve) {
            buttons.approve.addEventListener('click', function() {
                self.handleApprovalResponse(true, false);
            });
        }
        
        if (buttons.alwaysApprove) {
            buttons.alwaysApprove.addEventListener('click', function() {
                self.handleApprovalResponse(true, true);
            });
        }
        
        if (buttons.deny) {
            buttons.deny.addEventListener('click', function() {
                self.handleApprovalResponse(false, false);
            });
        }
        
        if (buttons.alwaysDeny) {
            buttons.alwaysDeny.addEventListener('click', function() {
                self.handleApprovalResponse(false, true);
            });
        }
    };

    /**
     * Execute a list of tool uses
     * @param {array} toolUses - Array of tool use objects
     * @param {function} onComplete - Callback when all tools are executed
     */
    ToolExecutor.prototype.executeTools = function(toolUses, onComplete) {
        var self = this;
        var toolResults = [];
        var toolIndex = 0;
        
        function executeNextTool() {
            if (self.shouldStop || toolIndex >= toolUses.length) {
                onComplete(toolResults);
                return;
            }
            
            var toolUse = toolUses[toolIndex];
            toolIndex++;
            
            // Check approval status
            var approvalStatus = self.getToolApprovalStatus(toolUse.name);
            
            if (approvalStatus === 'always_deny') {
                self.onStatusUpdate(toolUse.id, 'denied', 'Tool execution denied by configuration');
                toolResults.push({
                    toolUseId: toolUse.id,
                    result: 'Error: Tool execution denied'
                });
                executeNextTool();
                return;
            }
            
            if (approvalStatus === 'require_approval') {
                self.requestToolApproval(toolUse).then(function(response) {
                    if (response.approved) {
                        if (response.remember) {
                            self.setToolApprovalStatus(toolUse.name, 'auto_approve');
                        }
                        executeToolCall(toolUse);
                    } else {
                        if (response.remember) {
                            self.setToolApprovalStatus(toolUse.name, 'always_deny');
                        }
                        self.onStatusUpdate(toolUse.id, 'denied', 'Tool execution denied by user');
                        toolResults.push({
                            toolUseId: toolUse.id,
                            result: 'Error: Tool execution denied by user'
                        });
                        executeNextTool();
                    }
                });
                return;
            }
            
            // Auto-approved - execute directly
            executeToolCall(toolUse);
        }
        
        function executeToolCall(toolUse) {
            self.onStatusUpdate(toolUse.id, 'executing', undefined, toolUse.input);
            
            // Show robot tool animation
            if (false && window.RobotToolAnimation) {
                window.RobotToolAnimation.show(toolUse);
            }
            
            // Call the tool via MCPService
            window.MCPService.callTool(toolUse.name, toolUse.input)
                .then(function(result) {
                    var resultText = self.formatToolResult(result);
                    self.onStatusUpdate(toolUse.id, 'completed', resultText);
                    
                    if (false && window.RobotToolAnimation) {
                        window.RobotToolAnimation.complete(result);
                    }
                    
                    toolResults.push({
                        toolUseId: toolUse.id,
                        result: resultText
                    });
                    executeNextTool();
                })
                .catch(function(error) {
                    self.onStatusUpdate(toolUse.id, 'error', error.message);
                    
                    if (false && window.RobotToolAnimation) {
                        window.RobotToolAnimation.error(error.message);
                    }
                    
                    toolResults.push({
                        toolUseId: toolUse.id,
                        result: 'Error: ' + error.message
                    });
                    executeNextTool();
                });
        }
        
        executeNextTool();
    };

    /**
     * Format tool result for display
     */
    ToolExecutor.prototype.formatToolResult = function(result) {
        if (!result) return '';
        
        if (result.content && Array.isArray(result.content)) {
            return result.content.map(function(c) {
                return c.text || JSON.stringify(c);
            }).join('\n');
        }
        
        return JSON.stringify(result, null, 2);
    };

    /**
     * Request tool approval from user
     */
    ToolExecutor.prototype.requestToolApproval = function(toolUse) {
        var self = this;
        
        return new Promise(function(resolve) {
            self.pendingApproval = {
                toolUse: toolUse,
                resolve: resolve
            };
            
            if (self.approvalContent) {
                self.approvalContent.innerHTML = '\
                    <p>The AI wants to execute the following tool:</p>\
                    <div class="tool-approval-info">\
                        <div class="tool-name">🔧 ' + escapeHtml(toolUse.name) + '</div>\
                        <strong>Input:</strong>\
                        <pre>' + escapeHtml(JSON.stringify(toolUse.input || {}, null, 2)) + '</pre>\
                    </div>\
                    <p>Do you want to allow this tool to execute?</p>';
            }
            
            if (self.approvalOverlay) {
                self.approvalOverlay.classList.remove('hidden');
            }
        });
    };

    /**
     * Handle approval dialog response
     */
    ToolExecutor.prototype.handleApprovalResponse = function(approved, remember) {
        if (this.pendingApproval) {
            this.pendingApproval.resolve({
                approved: approved,
                remember: remember
            });
            this.pendingApproval = null;
        }
        
        if (this.approvalOverlay) {
            this.approvalOverlay.classList.add('hidden');
        }
    };

    /**
     * Get tool approval status
     */
    ToolExecutor.prototype.getToolApprovalStatus = function(toolName) {
        return this.toolApprovals[toolName] || 'require_approval';
    };

    /**
     * Set tool approval status
     */
    ToolExecutor.prototype.setToolApprovalStatus = function(toolName, status) {
        this.toolApprovals[toolName] = status;
        this.saveToolApprovals();
    };

    /**
     * Load tool approvals from localStorage
     */
    ToolExecutor.prototype.loadToolApprovals = function() {
        try {
            var saved = localStorage.getItem('agentic_tool_approvals');
            if (saved) {
                this.toolApprovals = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[ToolExecutor] Failed to load tool approvals:', e);
        }
    };

    /**
     * Save tool approvals to localStorage
     */
    ToolExecutor.prototype.saveToolApprovals = function() {
        try {
            localStorage.setItem('agentic_tool_approvals', JSON.stringify(this.toolApprovals));
        } catch (e) {
            console.warn('[ToolExecutor] Failed to save tool approvals:', e);
        }
    };

    /**
     * Stop execution
     */
    ToolExecutor.prototype.stop = function() {
        this.shouldStop = true;
    };

    /**
     * Reset stop flag
     */
    ToolExecutor.prototype.reset = function() {
        this.shouldStop = false;
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.ToolExecutor = ToolExecutor;

})();
/**
 * Multi Worker Panel - Manages multiple simultaneous worker panels
 * 
 * Allows 2+ worker panels to be open at the same time for parallel execution visibility.
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;
    var setTextContent = window.ChatbotUtils.setTextContent;

    // Maximum concurrent panels that can be displayed
    var MAX_VISIBLE_PANELS = 3;

    /**
     * SingleWorkerPanel - represents one worker's panel
     */
    function SingleWorkerPanel(workerId, workerName, container, index) {
        this.workerId = workerId;
        this.workerName = workerName;
        this.index = index;
        this.html = '';
        this.status = 'Processing...';
        this.lastSessionId = 0;
        
        this.panel = this.createPanel(container);
        this.messagesEl = this.panel.querySelector('.worker-panel-messages');
        this.statusEl = this.panel.querySelector('.worker-status-text');
        this.nameEl = this.panel.querySelector('.worker-panel-name');
    }

    /**
     * Create panel DOM
     */
    SingleWorkerPanel.prototype.createPanel = function(container) {
        var panel = document.createElement('div');
        panel.className = 'worker-mini-panel';
        panel.setAttribute('data-worker-id', this.workerId);
        panel.style.setProperty('--panel-index', this.index);
        
        panel.innerHTML = '\
            <div class="worker-mini-panel-header">\
                <div class="worker-mini-panel-title">\
                    <span class="worker-icon">⚙️</span>\
                    <span class="worker-panel-name">' + escapeHtml(this.workerName) + '</span>\
                </div>\
                <button class="worker-mini-panel-close" title="Close">&times;</button>\
            </div>\
            <div class="worker-mini-panel-status">\
                <span class="worker-status-indicator"></span>\
                <span class="worker-status-text">Processing...</span>\
            </div>\
            <div class="worker-panel-messages"></div>';
        
        var self = this;
        var closeBtn = panel.querySelector('.worker-mini-panel-close');
        closeBtn.addEventListener('click', function() {
            self.hide();
        });
        
        container.appendChild(panel);
        
        // Animate in
        setTimeout(function() {
            panel.classList.add('active');
        }, 50);
        
        return panel;
    };

    /**
     * Add message to panel
     */
    SingleWorkerPanel.prototype.addMessage = function(from, content, label) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'worker-message from-' + from;
        
        var msgId = 'worker-msg-' + this.workerId + '-' + Date.now();
        msgDiv.setAttribute('data-msg-id', msgId);
        
        var headerDiv = document.createElement('div');
        headerDiv.className = 'worker-message-header';
        headerDiv.innerHTML = (from === 'parent' ? '👑 ' : '⚙️ ') + escapeHtml(label || (from === 'parent' ? 'Orchestrator' : 'Worker'));
        
        var contentDiv = document.createElement('div');
        contentDiv.className = 'worker-message-content';
        contentDiv.textContent = content;
        
        msgDiv.appendChild(headerDiv);
        msgDiv.appendChild(contentDiv);
        
        this.messagesEl.appendChild(msgDiv);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        
        return msgId;
    };

    /**
     * Update message content with markdown rendering
     */
    SingleWorkerPanel.prototype.updateMessage = function(msgId, content, isStreaming) {
        var msgEl = this.messagesEl.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            var contentEl = msgEl.querySelector('.worker-message-content');
            if (contentEl) {
                // Use markdown rendering if available (MarkdownParser.parse)
                if (window.MarkdownParser && window.MarkdownParser.parse) {
                    contentEl.innerHTML = window.MarkdownParser.parse(content || '');
                    contentEl.classList.add('markdown-content', 'md-content');
                } else {
                    contentEl.textContent = content;
                }
                
                if (isStreaming) {
                    contentEl.classList.add('streaming');
                } else {
                    contentEl.classList.remove('streaming');
                }
            }
        }
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    };

    /**
     * Update status
     */
    SingleWorkerPanel.prototype.updateStatus = function(text) {
        this.status = text;
        if (this.statusEl) {
            this.statusEl.textContent = text;
        }
    };

    /**
     * Add tool use with animation
     */
    SingleWorkerPanel.prototype.addToolUse = function(toolUse) {
        var container = document.createElement('div');
        container.className = 'tool-use-container';
        container.setAttribute('data-tool-id', toolUse.id || '');
        
        var statusClass = toolUse.status || 'executing';
        var statusText = {
            'pending': 'Pending',
            'pending_approval': 'Awaiting Approval',
            'executing': 'Executing...',
            'completed': 'Completed',
            'error': 'Error',
            'denied': 'Denied'
        }[statusClass] || 'Unknown';
        
        // Extract display name
        var displayName = toolUse.name;
        if (displayName && displayName.indexOf('___') !== -1) {
            displayName = displayName.split('___').pop();
        }
        
        container.innerHTML = '\
            <div class="tool-use-header">\
                <div class="tool-use-info">\
                    <span class="tool-use-icon">🔧</span>\
                    <span class="tool-use-name">' + escapeHtml(displayName) + '</span>\
                </div>\
                <span class="tool-use-status ' + escapeHtml(statusClass) + '">' + escapeHtml(statusText) + '</span>\
                <span class="tool-use-toggle">▼</span>\
            </div>\
            <div class="tool-use-body">\
                <div class="tool-use-input">\
                    <div class="tool-use-input-label">Input</div>\
                    <div class="tool-use-input-content">' + escapeHtml(JSON.stringify(toolUse.input || {}, null, 2)) + '</div>\
                </div>\
                <div class="tool-use-result">\
                    <div class="tool-use-result-label">Result</div>\
                    <div class="tool-use-result-content">Executing...</div>\
                </div>\
            </div>';
        
        var header = container.querySelector('.tool-use-header');
        header.addEventListener('click', function() {
            container.classList.toggle('expanded');
        });
        
        this.messagesEl.appendChild(container);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        
        // Show tool-specific animation if available (RobotToolAnimation)
        this.showToolAnimation(displayName, toolUse);
        
        return container;
    };

    /**
     * Update tool use status
     */
    SingleWorkerPanel.prototype.updateToolUseStatus = function(toolId, status, result, input) {
        var toolEl = this.messagesEl.querySelector('[data-tool-id="' + toolId + '"]');
        if (!toolEl) return;
        
        var statusEl = toolEl.querySelector('.tool-use-status');
        if (statusEl) {
            statusEl.className = 'tool-use-status ' + escapeHtml(status);
            var statusText = {
                'pending': 'Pending',
                'pending_approval': 'Awaiting Approval',
                'executing': 'Executing...',
                'completed': 'Completed',
                'error': 'Error',
                'denied': 'Denied'
            }[status] || 'Unknown';
            setTextContent(statusEl, statusText);
        }
        
        if (input !== undefined) {
            var inputEl = toolEl.querySelector('.tool-use-input-content');
            if (inputEl) {
                setTextContent(inputEl, JSON.stringify(input, null, 2));
            }
        }
        
        if (result !== undefined) {
            var resultEl = toolEl.querySelector('.tool-use-result-content');
            if (resultEl) {
                resultEl.className = 'tool-use-result-content' + (status === 'error' ? ' error' : '');
                // Render result with markdown if it looks like text
                var resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                if (window.MarkdownParser && window.MarkdownParser.parse && typeof result === 'string') {
                    resultEl.innerHTML = window.MarkdownParser.parse(resultText);
                    resultEl.classList.add('markdown-content', 'md-content');
                } else {
                    setTextContent(resultEl, resultText);
                }
            }
        }
        
        if (status === 'completed' || status === 'error') {
            toolEl.classList.add('expanded');
            // Hide animation and pass result for display
            this.hideToolAnimation(status === 'completed', result);
        }
    };

    /**
     * Show inline tool animation within the worker panel
     * Does NOT use the global RobotToolAnimation - keeps animations local to panel
     */
    SingleWorkerPanel.prototype.showToolAnimation = function(toolName, toolUse) {
        // Remove any existing animation in this panel
        this.hideToolAnimation(false);
        
        // Truncate tool name for display
        var displayName = toolName || 'Tool';
        if (displayName.length > 20) {
            displayName = displayName.substring(0, 17) + '...';
        }
        
        // Truncate input for display
        var inputStr = '';
        try {
            var inputObj = toolUse && toolUse.input ? toolUse.input : {};
            inputStr = JSON.stringify(inputObj);
            if (inputStr.length > 50) {
                inputStr = inputStr.substring(0, 47) + '...';
            }
        } catch (e) {
            inputStr = '[input]';
        }
        
        // Create inline mini robot animation
        var animContainer = document.createElement('div');
        animContainer.className = 'worker-robot-animation active';
        animContainer.setAttribute('data-tool-animation', 'true');
        
        animContainer.innerHTML = '\
            <div class="worker-robot-head">\
                <div class="worker-robot-eyes">\
                    <div class="worker-robot-eye"></div>\
                    <div class="worker-robot-eye"></div>\
                </div>\
                <div class="worker-robot-mouth"></div>\
            </div>\
            <div class="worker-robot-visor">\
                <div class="worker-robot-visor-header">\
                    <span class="visor-icon">🔧</span>\
                    <span class="visor-tool-name">' + escapeHtml(displayName) + '</span>\
                </div>\
                <div class="worker-robot-visor-content">\
                    <div class="visor-input">' + escapeHtml(inputStr) + '</div>\
                    <div class="visor-output">Executing...</div>\
                </div>\
            </div>\
            <div class="worker-robot-info">\
                <div class="worker-robot-tool-name">' + escapeHtml(displayName) + '</div>\
                <div class="worker-robot-status">Executing...</div>\
            </div>';
        
        this.messagesEl.appendChild(animContainer);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        
        this.currentToolAnimation = animContainer;
    };

    /**
     * Hide inline robot animation within the panel
     */
    SingleWorkerPanel.prototype.hideToolAnimation = function(success, result) {
        if (!this.currentToolAnimation) return;
        
        // Update state based on success/error
        if (success) {
            this.currentToolAnimation.classList.remove('active');
            this.currentToolAnimation.classList.add('complete');
        } else if (result) {
            this.currentToolAnimation.classList.remove('active');
            this.currentToolAnimation.classList.add('error');
        }
        
        // Update visor output
        var outputEl = this.currentToolAnimation.querySelector('.visor-output');
        var statusEl = this.currentToolAnimation.querySelector('.worker-robot-status');
        
        if (outputEl && result !== undefined) {
            var resultStr = '';
            try {
                if (typeof result === 'string') {
                    resultStr = result;
                } else if (result && result.content && Array.isArray(result.content)) {
                    resultStr = result.content.map(function(c) {
                        return c.text || JSON.stringify(c);
                    }).join(' ');
                } else {
                    resultStr = JSON.stringify(result);
                }
                if (resultStr.length > 60) {
                    resultStr = resultStr.substring(0, 57) + '...';
                }
            } catch (e) {
                resultStr = success ? 'Complete' : 'Error';
            }
            
            outputEl.textContent = resultStr;
            outputEl.className = 'visor-output' + (success ? '' : ' error');
        }
        
        if (statusEl) {
            statusEl.textContent = success ? 'Complete' : 'Error';
        }
        
        // Auto-hide after delay
        var self = this;
        var anim = this.currentToolAnimation;
        setTimeout(function() {
            if (anim && anim.parentNode) {
                anim.style.opacity = '0';
                anim.style.transform = 'scale(0.9)';
                anim.style.transition = 'opacity 0.3s, transform 0.3s';
                setTimeout(function() {
                    if (anim && anim.parentNode) {
                        anim.remove();
                    }
                }, 300);
            }
        }, 1500);
        
        this.currentToolAnimation = null;
    };

    /**
     * Show panel
     */
    SingleWorkerPanel.prototype.show = function() {
        this.panel.classList.add('active');
    };

    /**
     * Hide panel
     */
    SingleWorkerPanel.prototype.hide = function() {
        this.panel.classList.remove('active');
    };

    /**
     * Destroy panel
     */
    SingleWorkerPanel.prototype.destroy = function() {
        if (this.panel && this.panel.parentNode) {
            this.panel.remove();
        }
    };

    /**
     * Save HTML content for later
     */
    SingleWorkerPanel.prototype.saveContent = function() {
        this.html = this.messagesEl.innerHTML;
    };

    /**
     * Restore HTML content
     */
    SingleWorkerPanel.prototype.restoreContent = function() {
        this.messagesEl.innerHTML = this.html;
    };

    /**
     * MultiWorkerPanel - manages multiple panels
     */
    function MultiWorkerPanel(chatbotContainer) {
        this.chatbotContainer = chatbotContainer;
        this.panels = {}; // workerId -> SingleWorkerPanel
        this.panelOrder = []; // Order of panels (for positioning)
        this.currentSessionId = 0;
        this.workerHistory = {}; // Persist content across sessions
        
        // Create container for panels
        this.panelsContainer = document.createElement('div');
        this.panelsContainer.className = 'multi-worker-panels-container';
        this.chatbotContainer.appendChild(this.panelsContainer);
    }

    /**
     * Start new session
     */
    MultiWorkerPanel.prototype.startNewSession = function() {
        this.currentSessionId++;
    };

    /**
     * Get or create panel for worker
     */
    MultiWorkerPanel.prototype.getOrCreatePanel = function(worker) {
        if (!this.panels[worker.id]) {
            // Create new panel
            var index = this.panelOrder.length;
            var panel = new SingleWorkerPanel(
                worker.id,
                worker.name || 'Worker Agent',
                this.panelsContainer,
                index
            );
            
            this.panels[worker.id] = panel;
            this.panelOrder.push(worker.id);
            
            // Restore history if any
            if (this.workerHistory[worker.id]) {
                panel.messagesEl.innerHTML = this.workerHistory[worker.id].html;
                // Add session separator
                this.addSessionSeparator(panel);
            }
        }
        
        return this.panels[worker.id];
    };

    /**
     * Add session separator
     */
    MultiWorkerPanel.prototype.addSessionSeparator = function(panel) {
        if (this.currentSessionId > 1) {
            var separator = document.createElement('div');
            separator.className = 'worker-delegation-separator';
            separator.innerHTML = '<span>───── Session ' + this.currentSessionId + ' ─────</span>';
            panel.messagesEl.appendChild(separator);
        }
    };

    /**
     * Show worker with task
     */
    MultiWorkerPanel.prototype.showWorker = function(worker, task) {
        var panel = this.getOrCreatePanel(worker);
        
        // Add task message
        panel.addMessage('parent', task, 'Orchestrator');
        panel.updateStatus('Thinking...');
        panel.show();
        
        // Update container class
        this.updateContainerClass();
        
        return panel.addMessage('worker', '', worker.name);
    };

    /**
     * Update container class based on active panels
     */
    MultiWorkerPanel.prototype.updateContainerClass = function() {
        var activePanels = this.getActivePanels();
        this.chatbotContainer.classList.remove('worker-panels-1', 'worker-panels-2', 'worker-panels-3');
        if (activePanels.length > 0) {
            this.chatbotContainer.classList.add('worker-panels-' + Math.min(activePanels.length, MAX_VISIBLE_PANELS));
        }
    };

    /**
     * Get active panels
     */
    MultiWorkerPanel.prototype.getActivePanels = function() {
        var self = this;
        return this.panelOrder.filter(function(id) {
            return self.panels[id] && self.panels[id].panel.classList.contains('active');
        });
    };

    /**
     * Update worker message
     */
    MultiWorkerPanel.prototype.updateWorkerMessage = function(workerId, msgId, content, isStreaming) {
        var panel = this.panels[workerId];
        if (panel) {
            panel.updateMessage(msgId, content, isStreaming);
        }
    };

    /**
     * Update worker status
     */
    MultiWorkerPanel.prototype.updateWorkerStatus = function(workerId, status) {
        var panel = this.panels[workerId];
        if (panel) {
            panel.updateStatus(status);
        }
    };

    /**
     * Add tool use to worker
     */
    MultiWorkerPanel.prototype.addWorkerToolUse = function(workerId, toolUse) {
        var panel = this.panels[workerId];
        if (panel) {
            return panel.addToolUse(toolUse);
        }
        return null;
    };

    /**
     * Update tool use status
     */
    MultiWorkerPanel.prototype.updateToolUseStatus = function(workerId, toolId, status, result, input) {
        var panel = this.panels[workerId];
        if (panel) {
            panel.updateToolUseStatus(toolId, status, result, input);
        }
    };

    /**
     * Complete worker
     */
    MultiWorkerPanel.prototype.completeWorker = function(workerId, result) {
        var panel = this.panels[workerId];
        if (panel) {
            panel.updateStatus('Complete');
            // Save content for history
            panel.saveContent();
            this.workerHistory[workerId] = {
                html: panel.html,
                status: 'Complete'
            };
            
            // Hide after delay
            var self = this;
            setTimeout(function() {
                panel.hide();
                self.updateContainerClass();
            }, 2000);
        }
    };

    /**
     * Hide all panels
     */
    MultiWorkerPanel.prototype.hideAll = function() {
        var self = this;
        Object.keys(this.panels).forEach(function(id) {
            self.panels[id].hide();
        });
        this.updateContainerClass();
    };

    /**
     * Show specific worker's history
     */
    MultiWorkerPanel.prototype.showWorkerHistory = function(workerId) {
        var panel = this.panels[workerId];
        if (panel) {
            panel.show();
            this.updateContainerClass();
            return true;
        } else if (this.workerHistory[workerId]) {
            // Recreate panel with history
            var worker = window.OrchestratorService ? window.OrchestratorService.getWorkerById(workerId) : null;
            if (worker) {
                panel = this.getOrCreatePanel(worker);
                panel.show();
                this.updateContainerClass();
                return true;
            }
        }
        return false;
    };

    /**
     * Clear all panels
     */
    MultiWorkerPanel.prototype.clearAll = function() {
        var self = this;
        Object.keys(this.panels).forEach(function(id) {
            self.panels[id].destroy();
        });
        this.panels = {};
        this.panelOrder = [];
        this.workerHistory = {};
        this.updateContainerClass();
    };

    /**
     * Check if worker has content
     */
    MultiWorkerPanel.prototype.hasWorkerContent = function(workerId) {
        return !!(this.panels[workerId] || this.workerHistory[workerId]);
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.MultiWorkerPanel = MultiWorkerPanel;

})();
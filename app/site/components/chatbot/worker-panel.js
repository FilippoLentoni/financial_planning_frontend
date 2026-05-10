/**
 * Worker Panel - Handles the worker side panel for orchestrator mode
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;
    var setTextContent = window.ChatbotUtils.setTextContent;

    /**
     * WorkerPanel constructor
     * @param {object} elements - DOM elements
     */
    function WorkerPanel(elements) {
        this.panel = elements.panel;
        this.panelName = elements.panelName;
        this.panelStatus = elements.panelStatus;
        this.statusText = elements.statusText;
        this.panelMessages = elements.panelMessages;
        this.closeBtn = elements.closeBtn;
        this.chatbotContainer = elements.chatbotContainer;
        
        // Store content per worker for parallel execution
        this.workerContents = {};
        this.currentWorkerId = null;
        this.currentWorkerName = null;
        
        // Session tracking to avoid separators between parallel delegations
        this.currentSessionId = 0;
        
        this.bindEvents();
    }

    /**
     * Bind event listeners
     */
    WorkerPanel.prototype.bindEvents = function() {
        var self = this;
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', function() {
                self.hide();
            });
        }
    };

    /**
     * Start a new session (call when user sends a new message)
     */
    WorkerPanel.prototype.startNewSession = function() {
        this.currentSessionId++;
    };

    /**
     * Show worker panel - accumulates content across sessions
     */
    WorkerPanel.prototype.show = function(worker, task) {
        if (!this.panel) return;
        
        // Initialize worker content storage if needed
        if (!this.workerContents[worker.id]) {
            this.workerContents[worker.id] = {
                name: worker.name || 'Worker Agent',
                html: '',
                status: 'Processing...',
                lastSessionId: 0
            };
        }
        
        var workerContent = this.workerContents[worker.id];
        
        // Track current worker
        this.currentWorkerId = worker.id;
        this.currentWorkerName = workerContent.name;
        
        if (this.panelName) {
            this.panelName.textContent = this.currentWorkerName;
        }
        
        // Restore existing content first
        if (this.panelMessages && workerContent.html) {
            this.panelMessages.innerHTML = workerContent.html;
        }
        
        // Add separator only if this is a NEW session (user message), not parallel delegation
        if (workerContent.lastSessionId > 0 && workerContent.lastSessionId < this.currentSessionId && this.panelMessages) {
            var separator = document.createElement('div');
            separator.className = 'worker-delegation-separator';
            separator.innerHTML = '<span>───── Session ' + this.currentSessionId + ' ─────</span>';
            this.panelMessages.appendChild(separator);
        }
        
        // Update last session for this worker
        workerContent.lastSessionId = this.currentSessionId;
        
        // Add task message from orchestrator
        this.addMessage('parent', task, 'Orchestrator');
        
        // Save updated content
        workerContent.html = this.panelMessages.innerHTML;
        
        this.panel.classList.add('active');
        if (this.chatbotContainer) {
            this.chatbotContainer.classList.add('worker-panel-open');
        }
    };

    /**
     * Switch to viewing a different worker's content
     */
    WorkerPanel.prototype.switchToWorker = function(workerId) {
        if (!this.workerContents[workerId]) return false;
        
        // Save current worker's content before switching
        if (this.currentWorkerId && this.panelMessages) {
            this.workerContents[this.currentWorkerId].html = this.panelMessages.innerHTML;
        }
        
        var workerContent = this.workerContents[workerId];
        this.currentWorkerId = workerId;
        this.currentWorkerName = workerContent.name;
        
        if (this.panelName) {
            this.panelName.textContent = this.currentWorkerName;
        }
        
        if (this.panelMessages) {
            this.panelMessages.innerHTML = workerContent.html;
            this.panelMessages.scrollTop = this.panelMessages.scrollHeight;
        }
        
        this.updateStatus(workerContent.status);
        
        return true;
    };

    /**
     * Save current panel content for the current worker
     */
    WorkerPanel.prototype.saveCurrentContent = function() {
        if (this.currentWorkerId && this.panelMessages && this.workerContents[this.currentWorkerId]) {
            this.workerContents[this.currentWorkerId].html = this.panelMessages.innerHTML;
        }
    };

    /**
     * Hide worker panel (does NOT clear content - allows revisiting)
     */
    WorkerPanel.prototype.hide = function() {
        if (!this.panel) return;
        
        this.panel.classList.remove('active');
        if (this.chatbotContainer) {
            this.chatbotContainer.classList.remove('worker-panel-open');
        }
    };

    /**
     * Reopen worker panel to view previous content
     */
    WorkerPanel.prototype.reopen = function() {
        if (!this.panel) return;
        
        this.panel.classList.add('active');
        if (this.chatbotContainer) {
            this.chatbotContainer.classList.add('worker-panel-open');
        }
        
        if (this.panelMessages) {
            this.panelMessages.scrollTop = this.panelMessages.scrollHeight;
        }
    };

    /**
     * Check if panel has content
     */
    WorkerPanel.prototype.hasContent = function() {
        return this.panelMessages && this.panelMessages.children.length > 0;
    };

    /**
     * Clear panel content
     */
    WorkerPanel.prototype.clear = function() {
        if (this.panelMessages) {
            this.panelMessages.innerHTML = '';
        }
    };

    /**
     * Clear all worker content storage (call when starting new orchestration)
     */
    WorkerPanel.prototype.clearAllWorkers = function() {
        this.workerContents = {};
        this.currentWorkerId = null;
        this.currentWorkerName = null;
        if (this.panelMessages) {
            this.panelMessages.innerHTML = '';
        }
    };

    /**
     * Get list of workers with content
     */
    WorkerPanel.prototype.getWorkersWithContent = function() {
        return Object.keys(this.workerContents);
    };

    /**
     * Add message to worker panel
     */
    WorkerPanel.prototype.addMessage = function(from, content, label) {
        if (!this.panelMessages) return null;
        
        var msgDiv = document.createElement('div');
        msgDiv.className = 'worker-message from-' + from;
        
        var msgId = 'worker-msg-' + Date.now();
        msgDiv.setAttribute('data-msg-id', msgId);
        
        var headerDiv = document.createElement('div');
        headerDiv.className = 'worker-message-header';
        headerDiv.innerHTML = (from === 'parent' ? '👑 ' : '⚙️ ') + escapeHtml(label || (from === 'parent' ? 'Orchestrator' : 'Worker'));
        
        var contentDiv = document.createElement('div');
        contentDiv.className = 'worker-message-content';
        contentDiv.textContent = content;
        
        msgDiv.appendChild(headerDiv);
        msgDiv.appendChild(contentDiv);
        
        this.panelMessages.appendChild(msgDiv);
        this.panelMessages.scrollTop = this.panelMessages.scrollHeight;
        
        return msgId;
    };

    /**
     * Update worker panel message content (for streaming)
     */
    WorkerPanel.prototype.updateMessage = function(msgId, content, isStreaming) {
        if (!this.panelMessages) return;
        
        var msgEl = this.panelMessages.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            var contentEl = msgEl.querySelector('.worker-message-content');
            if (contentEl) {
                contentEl.textContent = content;
                if (isStreaming) {
                    contentEl.classList.add('streaming');
                } else {
                    contentEl.classList.remove('streaming');
                }
            }
        }
        
        this.panelMessages.scrollTop = this.panelMessages.scrollHeight;
    };

    /**
     * Update worker panel status
     */
    WorkerPanel.prototype.updateStatus = function(text, workerId) {
        // Update status for specific worker or current worker
        var targetWorkerId = workerId || this.currentWorkerId;
        if (targetWorkerId && this.workerContents[targetWorkerId]) {
            this.workerContents[targetWorkerId].status = text;
        }
        
        // Only update UI if this is the currently displayed worker
        if (this.statusText && (!workerId || workerId === this.currentWorkerId)) {
            this.statusText.textContent = text;
        }
    };

    /**
     * Add expandable tool use to worker panel (matches main chat UI)
     * Uses the same class names as the main chat for consistent styling
     */
    WorkerPanel.prototype.addToolUse = function(toolUse) {
        if (!this.panelMessages) return null;
        
        // Use the same tool-use-container structure as the main chat
        var container = document.createElement('div');
        container.className = 'tool-use-container';
        container.setAttribute('data-tool-id', toolUse.id || '');
        
        var statusClass = toolUse.status || 'pending';
        var statusText = {
            'pending': 'Pending',
            'pending_approval': 'Awaiting Approval',
            'executing': 'Executing...',
            'completed': 'Completed',
            'error': 'Error',
            'denied': 'Denied'
        }[statusClass] || 'Unknown';
        
        // Extract display name from tool name (remove gateway prefix if present)
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
                    <div class="tool-use-result-content">Waiting...</div>\
                </div>\
            </div>';
        
        var header = container.querySelector('.tool-use-header');
        header.addEventListener('click', function() {
            container.classList.toggle('expanded');
        });
        
        this.panelMessages.appendChild(container);
        this.panelMessages.scrollTop = this.panelMessages.scrollHeight;
        
        return container;
    };

    /**
     * Update worker tool use status and result (matches main chat UI)
     */
    WorkerPanel.prototype.updateToolUseStatus = function(toolId, status, result, input) {
        if (!this.panelMessages) return;
        
        var toolEl = this.panelMessages.querySelector('[data-tool-id="' + toolId + '"]');
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
        
        // Update input display if provided
        if (input !== undefined) {
            var inputContentEl = toolEl.querySelector('.tool-use-input-content');
            if (inputContentEl) {
                setTextContent(inputContentEl, JSON.stringify(input, null, 2));
            }
        }
        
        // Update result display
        if (result !== undefined) {
            var resultContentEl = toolEl.querySelector('.tool-use-result-content');
            if (resultContentEl) {
                resultContentEl.className = 'tool-use-result-content' + (status === 'error' ? ' error' : '');
                setTextContent(resultContentEl, typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            }
        }
        
        // Auto-expand on completion or error
        if (status === 'completed' || status === 'error') {
            toolEl.classList.add('expanded');
        }
    };

    /**
     * Show mini robot animation for tool execution
     */
    WorkerPanel.prototype.showRobotAnimation = function(toolName) {
        if (!this.panelMessages) return null;
        
        var existing = this.panelMessages.querySelector('.worker-robot-animation');
        if (existing) existing.remove();
        
        var animation = document.createElement('div');
        animation.className = 'worker-robot-animation';
        animation.innerHTML = '\
            <div class="worker-robot-head">\
                <div class="worker-robot-eyes">\
                    <div class="worker-robot-eye"></div>\
                    <div class="worker-robot-eye"></div>\
                </div>\
                <div class="worker-robot-mouth"></div>\
            </div>\
            <div class="worker-robot-info">\
                <div class="worker-robot-tool-name">' + escapeHtml(toolName) + '</div>\
                <div class="worker-robot-status">Executing...</div>\
            </div>';
        
        this.panelMessages.appendChild(animation);
        this.panelMessages.scrollTop = this.panelMessages.scrollHeight;
        
        return animation;
    };

    /**
     * Update worker robot animation status
     */
    WorkerPanel.prototype.updateRobotStatus = function(status) {
        if (!this.panelMessages) return;
        
        var animation = this.panelMessages.querySelector('.worker-robot-animation');
        if (animation) {
            var statusEl = animation.querySelector('.worker-robot-status');
            if (statusEl) {
                statusEl.textContent = status;
            }
        }
    };

    /**
     * Complete worker robot animation (success)
     */
    WorkerPanel.prototype.completeRobotAnimation = function() {
        if (!this.panelMessages) return;
        
        var animation = this.panelMessages.querySelector('.worker-robot-animation');
        if (animation) {
            animation.classList.add('complete');
            var statusEl = animation.querySelector('.worker-robot-status');
            if (statusEl) {
                statusEl.textContent = '✅ Complete';
            }
            
            setTimeout(function() {
                animation.style.transition = 'opacity 0.5s, transform 0.5s';
                animation.style.opacity = '0';
                animation.style.transform = 'scale(0.9)';
                setTimeout(function() {
                    animation.remove();
                }, 500);
            }, 1000);
        }
    };

    /**
     * Show error in worker robot animation
     */
    WorkerPanel.prototype.errorRobotAnimation = function(errorMsg) {
        if (!this.panelMessages) return;
        
        var animation = this.panelMessages.querySelector('.worker-robot-animation');
        if (animation) {
            animation.classList.add('error');
            var statusEl = animation.querySelector('.worker-robot-status');
            if (statusEl) {
                statusEl.textContent = '❌ Error: ' + errorMsg;
            }
            
            setTimeout(function() {
                animation.style.transition = 'opacity 0.5s';
                animation.style.opacity = '0';
                setTimeout(function() {
                    animation.remove();
                }, 500);
            }, 2000);
        }
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.WorkerPanel = WorkerPanel;

})();
/**
 * Chatbot Component - Main chatbot UI controller
 * 
 * Security: OWASP10 compliant - all user inputs are escaped.
 * No external dependencies - pure vanilla JavaScript.
 * Integrates with MCP gateways and supports response streaming.
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

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`=\/]/g, function(char) {
            return HTML_ENTITIES[char] || char;
        });
    }

    function setTextContent(element, text) {
        if (element) element.textContent = text;
    }

    // ============================================================
    // Chatbot Component Class
    // ============================================================

    function ChatbotComponent(containerId, options) {
        this.containerId = containerId;
        this.options = options || {};
        this.container = null;
        this.elements = {};
        this.state = {
            messages: [],
            isLoading: false,
            isStreaming: false,
            connectedGateways: [],
            availableTools: [],
            mcpStatus: 'disconnected', // disconnected, connecting, connected, error
            pendingApproval: null,
            tokenUsage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0
            },
            skeletonIds: {}
        };
        this.toolApprovals = {}; // toolName -> 'auto_approve' | 'always_deny' | 'require_approval'
        this.shouldStop = false;
        
        // Callbacks
        this.onToolApproval = options.onToolApproval || null;
        this.getAccessToken = options.getAccessToken || function() { return null; };
        this.getIdToken = options.getIdToken || function() { return null; };
        this.getApiEndpoint = options.getApiEndpoint || function() { return ''; };
        this.getGatewaysList = options.getGatewaysList || function() { return []; };
    }

    /**
     * Initialize the chatbot component
     */
    ChatbotComponent.prototype.init = function() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error('[Chatbot] Container not found:', this.containerId);
            return;
        }
        
        this.render();
        this.cacheElements();
        this.bindEvents();
        this.loadToolApprovals();
        
        // Restore runtime session from sessionStorage for conversation continuity
        this._runtimeSessionId = sessionStorage.getItem('agentic_runtimeSessionId') || null;
        
        console.log('[Chatbot] Initialized');
    };

    /**
     * Render the chatbot HTML structure
     */
    ChatbotComponent.prototype.render = function() {
        this.container.innerHTML = '\
            <div class="chatbot-container">\
                <!-- Robot Speaker Overlay -->\
                <div class="robot-speaker-overlay" id="robot-speaker-overlay">\
                    <div class="robot-speaker">\
                        <div class="robot-speaker-head">\
                            <div class="robot-antenna"></div>\
                            <div class="robot-eye left"></div>\
                            <div class="robot-eye right"></div>\
                            <div class="robot-mouth"></div>\
                        </div>\
                        <span class="robot-speaker-text">Processing...</span>\
                    </div>\
                </div>\
                <!-- Stream Particles Container -->\
                <div class="stream-particles-container" id="stream-particles">\
                    <div class="stream-edge-glow top"></div>\
                    <div class="stream-edge-glow right"></div>\
                    <div class="stream-edge-glow bottom"></div>\
                    <div class="stream-edge-glow left"></div>\
                </div>\
                <!-- Data Stream Background -->\
                <div class="data-stream-bg" id="data-stream-bg"></div>\
                <div class="chatbot-header">\
                    <h3>Financial Planning Chat</h3>\
                    <div class="chatbot-controls">\
                        <div class="orchestrator-toggle" id="orchestrator-toggle" title="Enable multi-agent orchestration mode">\
                            <span class="orchestrator-toggle-label">🎭 Orchestrator</span>\
                            <div class="orchestrator-toggle-switch" id="orchestrator-switch"></div>\
                            <span class="orchestrator-toggle-count" id="orchestrator-count"></span>\
                        </div>\
                        <select class="model-selector" id="chatbot-model-selector" title="Select AI Model">\
                            <option value="backend-default">Loading models...</option>\
                        </select>\
                        <button class="btn-icon" id="chatbot-tools-btn" title="View MCP Tools">🔧 Tools</button>\
                        <button class="btn-icon" id="chatbot-servers-btn" title="MCP Servers">🌐 Servers</button>\
                        <button class="btn-icon" id="chatbot-clear-btn" title="Clear Conversation">🗑️</button>\
                    </div>\
                </div>\
                <!-- Orchestrator Status Bar -->\
                <div class="orchestrator-status-bar" id="orchestrator-status-bar">\
                    <div class="orchestrator-status-info">\
                        <div class="orchestrator-status-badge">\
                            <span class="icon">🎭</span>\
                            <span>Orchestrator Mode</span>\
                        </div>\
                        <div class="orchestrator-workers-list" id="orchestrator-workers-list"></div>\
                    </div>\
                </div>\
                <div class="chatbot-status" id="chatbot-status">\
                    <span class="status-indicator" id="status-indicator"></span>\
                    <span id="status-text">Not connected</span>\
                </div>\
                <div class="chatbot-messages" id="chatbot-messages">\
                    <div class="chatbot-welcome">\
                        <h4>Welcome to Financial Planning Chat</h4>\
                        <p>Create 16-week synthetic portfolio plans, analyze liquidity risk, and prepare weekly review reports.</p>\
                        <p>Start with: create a moderate 16-week plan for my demo portfolio.</p>\
                    </div>\
                </div>\
                <div class="chatbot-token-usage" id="chatbot-token-usage">\
                    <span class="token-usage-label">📊 Token Usage:</span>\
                    <span class="token-usage-item">\
                        <span class="token-label">Input:</span>\
                        <span class="token-value" id="token-input">0</span>\
                    </span>\
                    <span class="token-usage-item">\
                        <span class="token-label">Output:</span>\
                        <span class="token-value" id="token-output">0</span>\
                    </span>\
                    <span class="token-usage-item token-total">\
                        <span class="token-label">Total:</span>\
                        <span class="token-value" id="token-total">0</span>\
                    </span>\
                </div>\
                <div class="chatbot-input-area">\
                    <form class="chatbot-input-form" id="chatbot-form">\
                        <textarea class="chatbot-input" id="chatbot-input" \
                            placeholder="Type your message... (Enter to send, Shift+Enter for new line)" \
                            maxlength="4000" rows="1"></textarea>\
                        <button type="submit" class="chatbot-send-btn" id="chatbot-send-btn">📤 Send</button>\
                        <button type="button" class="chatbot-stop-btn hidden" id="chatbot-stop-btn">⏹️ Stop</button>\
                    </form>\
                </div>\
            </div>\
            <div class="tools-panel-overlay hidden" id="tools-panel-overlay">\
                <div class="tools-panel">\
                    <div class="tools-panel-header">\
                        <h3>🔧 Available MCP Tools</h3>\
                        <button class="tools-panel-close" id="tools-panel-close">&times;</button>\
                    </div>\
                    <div class="tools-panel-content" id="tools-panel-content">\
                        <p>No tools available. Connect to MCP servers first.</p>\
                    </div>\
                </div>\
            </div>\
            <div class="tools-panel-overlay hidden" id="servers-panel-overlay">\
                <div class="tools-panel">\
                    <div class="tools-panel-header">\
                        <h3>🌐 MCP Servers</h3>\
                        <button class="tools-panel-close" id="servers-panel-close">&times;</button>\
                    </div>\
                    <div class="tools-panel-content" id="servers-panel-content">\
                        <p>Loading servers...</p>\
                    </div>\
                </div>\
            </div>\
            <div class="tool-approval-overlay hidden" id="tool-approval-overlay">\
                <div class="tool-approval-dialog">\
                    <div class="tool-approval-header">\
                        <span>⚠️</span>\
                        <h4>Tool Approval Required</h4>\
                    </div>\
                    <div class="tool-approval-content" id="tool-approval-content">\
                    </div>\
                    <div class="tool-approval-actions">\
                        <button class="tool-approval-btn approve" id="approval-approve">✅ Approve Once</button>\
                        <button class="tool-approval-btn secondary" id="approval-always-approve">✅ Always Approve</button>\
                        <button class="tool-approval-btn deny" id="approval-deny">❌ Deny Once</button>\
                        <button class="tool-approval-btn secondary" id="approval-always-deny">🚫 Always Deny</button>\
                    </div>\
                </div>\
            </div>\
            <!-- Worker Side Panel -->\
            <div class="worker-side-panel" id="worker-side-panel">\
                <div class="worker-side-panel-header">\
                    <div class="worker-side-panel-title">\
                        <span class="worker-icon">⚙️</span>\
                        <span id="worker-panel-name">Worker Agent</span>\
                    </div>\
                    <button class="worker-side-panel-close" id="worker-panel-close">&times;</button>\
                </div>\
                <div class="worker-side-panel-status" id="worker-panel-status">\
                    <span class="worker-status-indicator"></span>\
                    <span id="worker-status-text">Processing...</span>\
                </div>\
                <div class="worker-side-panel-messages" id="worker-panel-messages">\
                </div>\
            </div>';
    };

    /**
     * Cache DOM element references
     */
    ChatbotComponent.prototype.cacheElements = function() {
        this.elements = {
            messages: document.getElementById('chatbot-messages'),
            form: document.getElementById('chatbot-form'),
            input: document.getElementById('chatbot-input'),
            sendBtn: document.getElementById('chatbot-send-btn'),
            stopBtn: document.getElementById('chatbot-stop-btn'),
            clearBtn: document.getElementById('chatbot-clear-btn'),
            toolsBtn: document.getElementById('chatbot-tools-btn'),
            serversBtn: document.getElementById('chatbot-servers-btn'),
            statusIndicator: document.getElementById('status-indicator'),
            statusText: document.getElementById('status-text'),
            toolsPanel: document.getElementById('tools-panel-overlay'),
            toolsPanelContent: document.getElementById('tools-panel-content'),
            toolsPanelClose: document.getElementById('tools-panel-close'),
            serversPanel: document.getElementById('servers-panel-overlay'),
            serversPanelContent: document.getElementById('servers-panel-content'),
            serversPanelClose: document.getElementById('servers-panel-close'),
            approvalOverlay: document.getElementById('tool-approval-overlay'),
            approvalContent: document.getElementById('tool-approval-content'),
            approvalApprove: document.getElementById('approval-approve'),
            approvalAlwaysApprove: document.getElementById('approval-always-approve'),
            approvalDeny: document.getElementById('approval-deny'),
            approvalAlwaysDeny: document.getElementById('approval-always-deny'),
            modelSelector: document.getElementById('chatbot-model-selector'),
            // Orchestrator elements
            orchestratorToggle: document.getElementById('orchestrator-toggle'),
            orchestratorSwitch: document.getElementById('orchestrator-switch'),
            orchestratorCount: document.getElementById('orchestrator-count'),
            orchestratorStatusBar: document.getElementById('orchestrator-status-bar'),
            orchestratorWorkersList: document.getElementById('orchestrator-workers-list'),
            // Worker side panel elements
            workerSidePanel: document.getElementById('worker-side-panel'),
            workerPanelName: document.getElementById('worker-panel-name'),
            workerPanelStatus: document.getElementById('worker-panel-status'),
            workerStatusText: document.getElementById('worker-status-text'),
            workerPanelMessages: document.getElementById('worker-panel-messages'),
            workerPanelClose: document.getElementById('worker-panel-close'),
            chatbotContainer: this.container.querySelector('.chatbot-container')
        };
        
        // Bind worker panel close button
        var self = this;
        if (this.elements.workerPanelClose) {
            this.elements.workerPanelClose.addEventListener('click', function() {
                self.hideWorkerPanel();
            });
        }
    };

    /**
     * Bind event listeners
     */
    ChatbotComponent.prototype.bindEvents = function() {
        var self = this;
        
        // Form submit
        this.elements.form.addEventListener('submit', function(e) {
            e.preventDefault();
            self.handleSendMessage();
        });
        
        // Input auto-resize and key handling
        this.elements.input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                self.handleSendMessage();
            }
        });
        
        this.elements.input.addEventListener('input', function() {
            self.autoResizeInput();
        });
        
        // Stop button
        this.elements.stopBtn.addEventListener('click', function() {
            self.handleStop();
        });
        
        // Clear button
        this.elements.clearBtn.addEventListener('click', function() {
            self.clearConversation();
        });
        
        // Tools panel
        this.elements.toolsBtn.addEventListener('click', function() {
            self.showToolsPanel();
        });
        
        this.elements.toolsPanelClose.addEventListener('click', function() {
            self.hideToolsPanel();
        });
        
        this.elements.toolsPanel.addEventListener('click', function(e) {
            if (e.target === self.elements.toolsPanel) {
                self.hideToolsPanel();
            }
        });
        
        // Servers panel
        this.elements.serversBtn.addEventListener('click', function() {
            self.showServersPanel();
        });
        
        this.elements.serversPanelClose.addEventListener('click', function() {
            self.hideServersPanel();
        });
        
        this.elements.serversPanel.addEventListener('click', function(e) {
            if (e.target === self.elements.serversPanel) {
                self.hideServersPanel();
            }
        });
        
        // Model selector
        this.elements.modelSelector.addEventListener('change', function() {
            self.handleModelChange(self.elements.modelSelector.value);
        });
        
        // Tool approval buttons
        this.elements.approvalApprove.addEventListener('click', function() {
            self.handleApprovalResponse(true, false);
        });
        
        this.elements.approvalAlwaysApprove.addEventListener('click', function() {
            self.handleApprovalResponse(true, true);
        });
        
        this.elements.approvalDeny.addEventListener('click', function() {
            self.handleApprovalResponse(false, false);
        });
        
        this.elements.approvalAlwaysDeny.addEventListener('click', function() {
            self.handleApprovalResponse(false, true);
        });
        
        // Orchestrator toggle
        if (this.elements.orchestratorSwitch) {
            this.elements.orchestratorSwitch.addEventListener('click', function() {
                self.toggleOrchestratorMode();
            });
        }
        
        // Initialize orchestrator UI
        this.updateOrchestratorUI();
    };

    /**
     * Toggle orchestrator mode on/off
     */
    ChatbotComponent.prototype.toggleOrchestratorMode = function() {
        if (!window.OrchestratorService) {
            console.warn('[Chatbot] OrchestratorService not available');
            return;
        }
        
        var currentState = window.OrchestratorService.isEnabled();
        var newState = !currentState;
        
        // Need at least 1 connected gateway for orchestrator mode
        var connectedCount = window.MCPService ? window.MCPService.getConnectedGatewayUrls().length : 0;
        if (newState && connectedCount === 0) {
            this.showError('Connect to at least one MCP server to enable Orchestrator mode');
            return;
        }
        
        window.OrchestratorService.setEnabled(newState);
        this.updateOrchestratorUI();
        
        // Clear conversation when toggling orchestrator mode
        this.clearConversation();
    };

    /**
     * Update orchestrator UI elements based on current state
     */
    ChatbotComponent.prototype.updateOrchestratorUI = function() {
        var isEnabled = window.OrchestratorService && window.OrchestratorService.isEnabled();
        var connectedCount = window.MCPService ? window.MCPService.getConnectedGatewayUrls().length : 0;
        
        // Update toggle switch
        if (this.elements.orchestratorSwitch) {
            if (isEnabled) {
                this.elements.orchestratorSwitch.classList.add('active');
            } else {
                this.elements.orchestratorSwitch.classList.remove('active');
            }
        }
        
        // Update worker count
        if (this.elements.orchestratorCount) {
            this.elements.orchestratorCount.textContent = connectedCount > 0 ? '(' + connectedCount + ' workers)' : '';
        }
        
        // Update status bar
        if (this.elements.orchestratorStatusBar) {
            if (isEnabled) {
                this.elements.orchestratorStatusBar.classList.add('active');
                this.renderOrchestratorWorkers();
            } else {
                this.elements.orchestratorStatusBar.classList.remove('active');
            }
        }
    };

    /**
     * Render orchestrator workers list in status bar
     */
    ChatbotComponent.prototype.renderOrchestratorWorkers = function() {
        if (!this.elements.orchestratorWorkersList || !window.OrchestratorService) return;
        
        var workers = window.OrchestratorService.getWorkers();
        var html = '';
        
        workers.forEach(function(worker) {
            html += '<div class="orchestrator-worker-chip" data-worker-id="' + escapeHtml(worker.id) + '">' +
                '<span class="worker-status"></span>' +
                '<span>' + escapeHtml(worker.name) + '</span>' +
                '</div>';
        });
        
        this.elements.orchestratorWorkersList.innerHTML = html;
    };

    /**
     * Update worker chip to show active state
     */
    ChatbotComponent.prototype.setWorkerActive = function(workerId, active) {
        if (!this.elements.orchestratorWorkersList) return;
        
        var chip = this.elements.orchestratorWorkersList.querySelector('[data-worker-id="' + workerId + '"]');
        if (chip) {
            if (active) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        }
    };

    /**
     * Show worker side panel
     */
    ChatbotComponent.prototype.showWorkerPanel = function(worker, task) {
        if (!this.elements.workerSidePanel) return;
        
        // Update panel header
        if (this.elements.workerPanelName) {
            this.elements.workerPanelName.textContent = worker.name || 'Worker Agent';
        }
        
        // Clear previous messages
        if (this.elements.workerPanelMessages) {
            this.elements.workerPanelMessages.innerHTML = '';
        }
        
        // Add the task as a message from parent
        this.addWorkerPanelMessage('parent', task, 'Orchestrator');
        
        // Show panel and adjust main chat
        this.elements.workerSidePanel.classList.add('active');
        if (this.elements.chatbotContainer) {
            this.elements.chatbotContainer.classList.add('worker-panel-open');
        }
        
        // Create communication particle animation
        this.animateCommunicationParticle('to-worker');
    };

    /**
     * Hide worker side panel
     */
    ChatbotComponent.prototype.hideWorkerPanel = function() {
        if (!this.elements.workerSidePanel) return;
        
        this.elements.workerSidePanel.classList.remove('active');
        if (this.elements.chatbotContainer) {
            this.elements.chatbotContainer.classList.remove('worker-panel-open');
        }
    };

    /**
     * Add message to worker panel
     */
    ChatbotComponent.prototype.addWorkerPanelMessage = function(from, content, label) {
        if (!this.elements.workerPanelMessages) return null;
        
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
        
        this.elements.workerPanelMessages.appendChild(msgDiv);
        this.elements.workerPanelMessages.scrollTop = this.elements.workerPanelMessages.scrollHeight;
        
        return msgId;
    };

    /**
     * Update worker panel message content (for streaming)
     */
    ChatbotComponent.prototype.updateWorkerPanelMessage = function(msgId, content, isStreaming) {
        if (!this.elements.workerPanelMessages) return;
        
        var msgEl = this.elements.workerPanelMessages.querySelector('[data-msg-id="' + msgId + '"]');
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
        
        this.elements.workerPanelMessages.scrollTop = this.elements.workerPanelMessages.scrollHeight;
    };

    /**
     * Add tool indicator to worker panel (simple version)
     */
    ChatbotComponent.prototype.addWorkerToolIndicator = function(toolName) {
        if (!this.elements.workerPanelMessages) return;
        
        var indicator = document.createElement('div');
        indicator.className = 'worker-tool-indicator';
        indicator.innerHTML = '<span class="tool-icon">⚙️</span> Using <span class="tool-name">' + escapeHtml(toolName) + '</span>...';
        
        this.elements.workerPanelMessages.appendChild(indicator);
        this.elements.workerPanelMessages.scrollTop = this.elements.workerPanelMessages.scrollHeight;
        
        return indicator;
    };

    /**
     * Add expandable tool use to worker panel with full details
     */
    ChatbotComponent.prototype.addWorkerToolUse = function(toolUse) {
        if (!this.elements.workerPanelMessages) return null;
        
        var container = document.createElement('div');
        container.className = 'worker-tool-use-container';
        container.setAttribute('data-tool-id', toolUse.id || '');
        
        var statusClass = toolUse.status || 'pending';
        var statusText = {
            'pending': 'Pending',
            'executing': 'Executing...',
            'completed': 'Completed',
            'error': 'Error'
        }[statusClass] || 'Unknown';
        
        container.innerHTML = '\
            <div class="worker-tool-use-header">\
                <div class="worker-tool-use-info">\
                    <span class="worker-tool-use-icon">🔧</span>\
                    <span class="worker-tool-use-name">' + escapeHtml(toolUse.name) + '</span>\
                </div>\
                <span class="worker-tool-use-status ' + escapeHtml(statusClass) + '">' + escapeHtml(statusText) + '</span>\
                <span class="worker-tool-use-toggle">▼</span>\
            </div>\
            <div class="worker-tool-use-body">\
                <div class="worker-tool-use-input">\
                    <div class="worker-tool-use-label">Input</div>\
                    <div class="worker-tool-use-content">' + escapeHtml(JSON.stringify(toolUse.input || {}, null, 2)) + '</div>\
                </div>\
                <div class="worker-tool-use-result">\
                    <div class="worker-tool-use-label">Result</div>\
                    <div class="worker-tool-use-result-content">Waiting...</div>\
                </div>\
            </div>';
        
        // Toggle expand/collapse on header click
        var header = container.querySelector('.worker-tool-use-header');
        header.addEventListener('click', function() {
            container.classList.toggle('expanded');
        });
        
        this.elements.workerPanelMessages.appendChild(container);
        this.elements.workerPanelMessages.scrollTop = this.elements.workerPanelMessages.scrollHeight;
        
        return container;
    };

    /**
     * Update worker tool use status and result
     */
    ChatbotComponent.prototype.updateWorkerToolUseStatus = function(toolId, status, result, input) {
        if (!this.elements.workerPanelMessages) return;
        
        var toolEl = this.elements.workerPanelMessages.querySelector('[data-tool-id="' + toolId + '"]');
        if (!toolEl) return;
        
        var statusEl = toolEl.querySelector('.worker-tool-use-status');
        if (statusEl) {
            statusEl.className = 'worker-tool-use-status ' + escapeHtml(status);
            var statusText = {
                'pending': 'Pending',
                'executing': 'Executing...',
                'completed': 'Completed',
                'error': 'Error'
            }[status] || 'Unknown';
            setTextContent(statusEl, statusText);
        }
        
        // Update input if provided
        if (input !== undefined) {
            var inputContentEl = toolEl.querySelector('.worker-tool-use-content');
            if (inputContentEl) {
                setTextContent(inputContentEl, JSON.stringify(input, null, 2));
            }
        }
        
        // Update result if provided
        if (result !== undefined) {
            var resultContentEl = toolEl.querySelector('.worker-tool-use-result-content');
            if (resultContentEl) {
                resultContentEl.className = 'worker-tool-use-result-content' + (status === 'error' ? ' error' : '');
                setTextContent(resultContentEl, typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            }
        }
        
        // Auto-expand on completion to show result
        if (status === 'completed' || status === 'error') {
            toolEl.classList.add('expanded');
        }
    };

    /**
     * Show mini robot animation in worker panel for tool execution
     */
    ChatbotComponent.prototype.showWorkerRobotAnimation = function(toolName) {
        if (!this.elements.workerPanelMessages) return null;
        
        // Remove any existing robot animation
        var existing = this.elements.workerPanelMessages.querySelector('.worker-robot-animation');
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
        
        this.elements.workerPanelMessages.appendChild(animation);
        this.elements.workerPanelMessages.scrollTop = this.elements.workerPanelMessages.scrollHeight;
        
        return animation;
    };

    /**
     * Update worker robot animation status
     */
    ChatbotComponent.prototype.updateWorkerRobotStatus = function(status) {
        if (!this.elements.workerPanelMessages) return;
        
        var animation = this.elements.workerPanelMessages.querySelector('.worker-robot-animation');
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
    ChatbotComponent.prototype.completeWorkerRobotAnimation = function(result) {
        if (!this.elements.workerPanelMessages) return;
        
        var animation = this.elements.workerPanelMessages.querySelector('.worker-robot-animation');
        if (animation) {
            animation.classList.add('complete');
            var statusEl = animation.querySelector('.worker-robot-status');
            if (statusEl) {
                statusEl.textContent = '✅ Complete';
            }
            
            // Remove after a delay
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
    ChatbotComponent.prototype.errorWorkerRobotAnimation = function(errorMsg) {
        if (!this.elements.workerPanelMessages) return;
        
        var animation = this.elements.workerPanelMessages.querySelector('.worker-robot-animation');
        if (animation) {
            animation.classList.add('error');
            var statusEl = animation.querySelector('.worker-robot-status');
            if (statusEl) {
                statusEl.textContent = '❌ Error: ' + errorMsg;
            }
            
            // Remove after a delay
            setTimeout(function() {
                animation.style.transition = 'opacity 0.5s';
                animation.style.opacity = '0';
                setTimeout(function() {
                    animation.remove();
                }, 500);
            }, 2000);
        }
    };

    /**
     * Update worker panel status
     */
    ChatbotComponent.prototype.updateWorkerPanelStatus = function(text) {
        if (this.elements.workerStatusText) {
            this.elements.workerStatusText.textContent = text;
        }
    };

    /**
     * Animate communication particle between main chat and worker panel
     */
    ChatbotComponent.prototype.animateCommunicationParticle = function(direction) {
        var particle = document.createElement('div');
        particle.className = 'communication-particle ' + direction;
        
        // Position at edge of main chat or worker panel
        if (direction === 'to-worker') {
            particle.style.left = (window.innerWidth - 450) + 'px';
            particle.style.top = '200px';
        } else {
            particle.style.left = (window.innerWidth - 30) + 'px';
            particle.style.top = '300px';
        }
        
        document.body.appendChild(particle);
        
        // Animate
        var startX = parseFloat(particle.style.left);
        var startY = parseFloat(particle.style.top);
        var endX = direction === 'to-worker' ? (window.innerWidth - 30) : (window.innerWidth - 450);
        var endY = direction === 'to-worker' ? 300 : 200;
        
        var duration = 600;
        var startTime = null;
        
        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            
            // Ease out
            var eased = 1 - Math.pow(1 - progress, 3);
            
            particle.style.left = (startX + (endX - startX) * eased) + 'px';
            particle.style.top = (startY + (endY - startY) * eased) + 'px';
            particle.style.opacity = progress < 0.8 ? 1 : (1 - progress) / 0.2;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                particle.remove();
            }
        }
        
        requestAnimationFrame(animate);
    };

    /**
     * Auto-resize input textarea
     */
    ChatbotComponent.prototype.autoResizeInput = function() {
        var input = this.elements.input;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    };

    /**
     * Update connection status display
     */
    ChatbotComponent.prototype.updateStatus = function(status, text) {
        this.state.mcpStatus = status;
        
        var indicator = this.elements.statusIndicator;
        indicator.className = 'status-indicator ' + status;
        
        setTextContent(this.elements.statusText, text);
    };

    /**
     * Handle sending a message
     */
    ChatbotComponent.prototype.handleSendMessage = function() {
        var message = this.elements.input.value.trim();
        
        if (!message || this.state.isLoading) return;
        
        // Validate message length
        if (message.length > 4000) {
            this.showError('Message too long. Maximum 4000 characters.');
            return;
        }
        
        // Add user message to UI
        this.addMessage('user', message);
        
        // Clear input
        this.elements.input.value = '';
        this.autoResizeInput();
        
        // Send to AI
        this.sendToAI(message);
    };

    /**
     * Add a message to the chat
     */
    ChatbotComponent.prototype.addMessage = function(role, content, options) {
        options = options || {};
        
        var msgData = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            role: role,
            content: content,
            timestamp: new Date().toISOString(),
            toolUses: options.toolUses || [],
            isStreaming: options.isStreaming || false
        };
        
        this.state.messages.push(msgData);
        this.renderMessage(msgData);
        this.scrollToBottom();
        
        return msgData.id;
    };

    /**
     * Render a single message with robot avatars
     */
    ChatbotComponent.prototype.renderMessage = function(msg) {
        // Remove welcome message if it exists
        var welcome = this.elements.messages.querySelector('.chatbot-welcome');
        if (welcome) welcome.remove();
        
        var msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg ' + escapeHtml(msg.role);
        if (msg.isStreaming) msgDiv.className += ' streaming';
        msgDiv.setAttribute('data-msg-id', msg.id);
        
        // Create robot avatar
        var avatarDiv = document.createElement('div');
        avatarDiv.className = msg.role === 'user' ? 'robot-avatar-user' : 'robot-avatar-ai';
        
        // Create message body container
        var bodyDiv = document.createElement('div');
        bodyDiv.className = 'chat-msg-body';
        
        var headerDiv = document.createElement('div');
        headerDiv.className = 'chat-msg-header';
        
        var roleSpan = document.createElement('span');
        roleSpan.className = 'chat-msg-role';
        setTextContent(roleSpan, msg.role === 'user' ? 'You' : 'Agent');
        
        var timeSpan = document.createElement('span');
        timeSpan.className = 'chat-msg-time';
        setTextContent(timeSpan, new Date(msg.timestamp).toLocaleTimeString());
        
        headerDiv.appendChild(roleSpan);
        headerDiv.appendChild(timeSpan);
        
        var contentDiv = document.createElement('div');
        contentDiv.className = 'chat-msg-content';
        // CRITICAL: For assistant messages, use markdown rendering (which escapes first)
        // For user messages, use textContent (safe, no HTML interpretation)
        if (msg.role === 'assistant' && window.MarkdownParser) {
            contentDiv.innerHTML = window.MarkdownParser.parse(msg.content);
        } else {
            // User messages: use textContent for safety
            setTextContent(contentDiv, msg.content);
        }
        
        bodyDiv.appendChild(headerDiv);
        
        // Render tool uses if present
        if (msg.toolUses && msg.toolUses.length > 0) {
            var toolsContainer = document.createElement('div');
            toolsContainer.className = 'tool-uses-container';
            
            msg.toolUses.forEach(function(toolUse) {
                var toolEl = this.renderToolUse(toolUse);
                toolsContainer.appendChild(toolEl);
            }, this);
            
            bodyDiv.appendChild(toolsContainer);
        }
        
        bodyDiv.appendChild(contentDiv);
        
        // Append avatar and body to message
        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(bodyDiv);
        
        this.elements.messages.appendChild(msgDiv);
    };

    /**
     * Render a tool use component
     */
    ChatbotComponent.prototype.renderToolUse = function(toolUse) {
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
        
        container.innerHTML = '\
            <div class="tool-use-header">\
                <div class="tool-use-info">\
                    <span class="tool-use-icon">🔧</span>\
                    <span class="tool-use-name">' + escapeHtml(toolUse.name) + '</span>\
                </div>\
                <span class="tool-use-status ' + escapeHtml(statusClass) + '">' + escapeHtml(statusText) + '</span>\
                <span class="tool-use-toggle">▼</span>\
            </div>\
            <div class="tool-use-body">\
                <div class="tool-use-input">\
                    <div class="tool-use-input-label">Input</div>\
                    <div class="tool-use-input-content">' + escapeHtml(JSON.stringify(toolUse.input || {}, null, 2)) + '</div>\
                </div>\
                ' + (toolUse.result ? '\
                <div class="tool-use-result">\
                    <div class="tool-use-result-label">Result</div>\
                    <div class="tool-use-result-content ' + (toolUse.status === 'error' ? 'error' : '') + '">' + 
                        escapeHtml(typeof toolUse.result === 'string' ? toolUse.result : JSON.stringify(toolUse.result, null, 2)) + 
                    '</div>\
                </div>' : '') + '\
            </div>';
        
        // Toggle expand/collapse
        var header = container.querySelector('.tool-use-header');
        header.addEventListener('click', function() {
            container.classList.toggle('expanded');
        });
        
        return container;
    };

    /**
     * Update message content (for streaming)
     */
    ChatbotComponent.prototype.updateMessageContent = function(msgId, content) {
        var msgEl = this.elements.messages.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            var contentEl = msgEl.querySelector('.chat-msg-content');
            if (contentEl) {
                // Check if this is an assistant message for markdown rendering
                var isAssistant = msgEl.classList.contains('assistant');
                if (isAssistant && window.MarkdownParser) {
                    contentEl.innerHTML = window.MarkdownParser.parse(content);
                } else {
                    setTextContent(contentEl, content);
                }
            }
        }
        
        // Update state
        var msg = this.state.messages.find(function(m) { return m.id === msgId; });
        if (msg) {
            msg.content = content;
        }
        
        this.scrollToBottom();
    };

    /**
     * Update tool use status
     */
    ChatbotComponent.prototype.updateToolUseStatus = function(toolId, status, result, input) {
        var toolEl = this.elements.messages.querySelector('[data-tool-id="' + toolId + '"]');
        if (toolEl) {
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
            
            // Update input display if provided (useful when input wasn't available at render time)
            if (input !== undefined) {
                var inputContentEl = toolEl.querySelector('.tool-use-input-content');
                if (inputContentEl) {
                    setTextContent(inputContentEl, JSON.stringify(input, null, 2));
                }
            }
            
            if (result !== undefined) {
                var bodyEl = toolEl.querySelector('.tool-use-body');
                var resultEl = bodyEl.querySelector('.tool-use-result');
                
                if (!resultEl) {
                    resultEl = document.createElement('div');
                    resultEl.className = 'tool-use-result';
                    resultEl.innerHTML = '<div class="tool-use-result-label">Result</div><div class="tool-use-result-content"></div>';
                    bodyEl.appendChild(resultEl);
                }
                
                var resultContentEl = resultEl.querySelector('.tool-use-result-content');
                resultContentEl.className = 'tool-use-result-content' + (status === 'error' ? ' error' : '');
                setTextContent(resultContentEl, typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            }
        }
    };

    /**
     * Mark message as finished streaming
     */
    ChatbotComponent.prototype.finishStreaming = function(msgId) {
        var msgEl = this.elements.messages.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            msgEl.classList.remove('streaming');
        }
        
        var msg = this.state.messages.find(function(m) { return m.id === msgId; });
        if (msg) {
            msg.isStreaming = false;
        }
    };

    /**
     * Show typing indicator with skeleton message bubble and progressive status
     */
    ChatbotComponent.prototype.showTypingIndicator = function() {
        var existingIndicator = this.elements.messages.querySelector('.typing-indicator-container');
        if (existingIndicator) return;
        
        // Remove welcome message if it exists
        var welcome = this.elements.messages.querySelector('.chatbot-welcome');
        if (welcome) welcome.remove();
        
        var container = document.createElement('div');
        container.className = 'chat-msg assistant typing-indicator-container';
        
        // Create robot avatar
        var avatarDiv = document.createElement('div');
        avatarDiv.className = 'robot-avatar-ai';
        container.appendChild(avatarDiv);
        
        // Create message body
        var bodyDiv = document.createElement('div');
        bodyDiv.className = 'chat-msg-body';
        
        var headerDiv = document.createElement('div');
        headerDiv.className = 'chat-msg-header';
        var roleSpan = document.createElement('span');
        roleSpan.className = 'chat-msg-role';
        setTextContent(roleSpan, 'Agent');
        headerDiv.appendChild(roleSpan);
        bodyDiv.appendChild(headerDiv);
        
        // Create skeleton message content with typing indicator
        var skeletonContent = document.createElement('div');
        skeletonContent.className = 'skeleton-message-content';
        
        // Typing dots
        var typingDots = document.createElement('div');
        typingDots.className = 'typing-indicator';
        typingDots.innerHTML = '<span></span><span></span><span></span>';
        skeletonContent.appendChild(typingDots);
        
        // Progressive status text that updates over time
        var statusDiv = document.createElement('div');
        statusDiv.className = 'typing-status-text';
        setTextContent(statusDiv, 'Connecting...');
        skeletonContent.appendChild(statusDiv);
        
        bodyDiv.appendChild(skeletonContent);
        container.appendChild(bodyDiv);
        
        this.elements.messages.appendChild(container);
        this.scrollToBottom();
        
        // Progressive status updates to keep user informed during the wait
        var self = this;
        var statusMessages = [
            { delay: 800, text: 'Connected, sending request...' },
            { delay: 2500, text: 'Agent is thinking...' },
            { delay: 5000, text: 'Still working... (complex queries take longer)' },
            { delay: 10000, text: 'Processing... hang tight!' },
            { delay: 20000, text: 'Running analysis... this may take a moment' }
        ];
        
        this._typingStatusTimers = [];
        statusMessages.forEach(function(msg) {
            var timer = setTimeout(function() {
                var activeStatus = container.querySelector('.typing-status-text');
                if (activeStatus) {
                    activeStatus.style.opacity = '0';
                    setTimeout(function() {
                        if (activeStatus.parentNode) {
                            setTextContent(activeStatus, msg.text);
                            activeStatus.style.opacity = '1';
                        }
                    }, 200);
                }
            }, msg.delay);
            self._typingStatusTimers.push(timer);
        });
    };

    /**
     * Hide typing indicator and clean up progressive status timers
     */
    ChatbotComponent.prototype.hideTypingIndicator = function() {
        // Clear progressive status timers
        if (this._typingStatusTimers) {
            this._typingStatusTimers.forEach(function(timer) {
                clearTimeout(timer);
            });
            this._typingStatusTimers = null;
        }
        
        var indicator = this.elements.messages.querySelector('.typing-indicator-container');
        if (indicator) indicator.remove();
    };

    /**
     * Scroll messages to bottom
     */
    ChatbotComponent.prototype.scrollToBottom = function() {
        var messages = this.elements.messages;
        messages.scrollTop = messages.scrollHeight;
    };

    /**
     * Update token usage display
     */
    ChatbotComponent.prototype.updateTokenUsage = function(usage) {
        if (!usage) return;
        
        // Accumulate tokens
        var inputTokens = usage.inputTokens || 0;
        var outputTokens = usage.outputTokens || 0;
        
        // Bedrock usage is cumulative per conversation, use direct assignment
        this.state.tokenUsage.inputTokens = inputTokens;
        this.state.tokenUsage.outputTokens = outputTokens;
        this.state.tokenUsage.totalTokens = inputTokens + outputTokens;
        
        // Update display
        var inputEl = document.getElementById('token-input');
        var outputEl = document.getElementById('token-output');
        var totalEl = document.getElementById('token-total');
        
        if (inputEl) setTextContent(inputEl, this.formatNumber(this.state.tokenUsage.inputTokens));
        if (outputEl) setTextContent(outputEl, this.formatNumber(this.state.tokenUsage.outputTokens));
        if (totalEl) setTextContent(totalEl, this.formatNumber(this.state.tokenUsage.totalTokens));
        
        console.log('[Chatbot] Token usage updated:', this.state.tokenUsage);
    };

    /**
     * Format number with commas
     */
    ChatbotComponent.prototype.formatNumber = function(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    // ============================================================
    // STREAMING ANIMATION METHODS
    // ============================================================

    /**
     * Start streaming animation (robot, particles, data streams)
     */
    ChatbotComponent.prototype.startStreamAnimation = function() {
        // Activate robot speaker
        var robotOverlay = document.getElementById('robot-speaker-overlay');
        if (robotOverlay) {
            robotOverlay.classList.add('active', 'speaking');
        }
        
        // Activate particles
        var particles = document.getElementById('stream-particles');
        if (particles) {
            particles.classList.add('active');
            this.createFlowingParticles();
        }
        
        // Activate data stream background
        var dataBg = document.getElementById('data-stream-bg');
        if (dataBg) {
            dataBg.classList.add('active');
            this.createDataStreamColumns();
        }
        
        this.state.isStreaming = true;
    };

    /**
     * Stop streaming animation
     */
    ChatbotComponent.prototype.stopStreamAnimation = function() {
        // Deactivate robot speaker
        var robotOverlay = document.getElementById('robot-speaker-overlay');
        if (robotOverlay) {
            robotOverlay.classList.remove('active', 'speaking');
        }
        
        // Deactivate particles
        var particles = document.getElementById('stream-particles');
        if (particles) {
            particles.classList.remove('active');
            // Clear particles
            var existingParticles = particles.querySelectorAll('.stream-particle');
            existingParticles.forEach(function(p) { p.remove(); });
        }
        
        // Deactivate data stream background
        var dataBg = document.getElementById('data-stream-bg');
        if (dataBg) {
            dataBg.classList.remove('active');
            dataBg.innerHTML = '';
        }
        
        this.state.isStreaming = false;
    };

    /**
     * Create flowing particles around edges
     */
    ChatbotComponent.prototype.createFlowingParticles = function() {
        var container = document.getElementById('stream-particles');
        if (!container) return;
        
        var particleChars = ['⟨', '⟩', '◦', '•', '○', '●', '∘', '⊛', '⊕', '⊗', '△', '▽', '◇', '◆'];
        var directions = ['flow-top', 'flow-right', 'flow-bottom', 'flow-left'];
        
        // Create multiple particles per direction
        for (var d = 0; d < directions.length; d++) {
            for (var i = 0; i < 3; i++) {
                var particle = document.createElement('span');
                particle.className = 'stream-particle ' + directions[d];
                particle.textContent = particleChars[Math.floor(Math.random() * particleChars.length)];
                particle.style.animationDelay = (i * 1.5 + d * 0.5) + 's';
                container.appendChild(particle);
            }
        }
    };

    /**
     * Animate text chunk flowing around the edge of the chatbot
     * The text flows from robot (top) -> right edge -> bottom -> left -> into message
     */
    ChatbotComponent.prototype.animateTextFlow = function(text, callback) {
        var self = this;
        var container = document.getElementById('stream-particles');
        if (!container) {
            callback();
            return;
        }
        
        // Create the flowing text element
        var textEl = document.createElement('span');
        textEl.className = 'flowing-text-chunk';
        textEl.textContent = text;
        container.appendChild(textEl);
        
        // Start the flow animation - the CSS will handle the path
        // After animation completes, remove element and call callback
        setTimeout(function() {
            textEl.remove();
            callback();
        }, 800); // Match animation duration
    };

    /**
     * Queue text chunks and animate them flowing in sequence
     */
    ChatbotComponent.prototype.initTextFlowQueue = function() {
        this.textFlowQueue = [];
        this.isFlowAnimating = false;
        this.pendingTextBuffer = '';
    };

    /**
     * Add text to the flow queue
     */
    ChatbotComponent.prototype.queueTextFlow = function(text, msgId) {
        var self = this;
        
        // Buffer characters until we have a reasonable chunk (word or punctuation)
        this.pendingTextBuffer += text;
        
        // Check if we should flush (space, newline, or buffer is large enough)
        var shouldFlush = /[\s\n.,!?;:]$/.test(this.pendingTextBuffer) || this.pendingTextBuffer.length > 15;
        
        if (shouldFlush && this.pendingTextBuffer.trim()) {
            var chunk = this.pendingTextBuffer;
            this.pendingTextBuffer = '';
            
            this.textFlowQueue.push({
                text: chunk,
                msgId: msgId
            });
            
            this.processTextFlowQueue();
        }
    };

    /**
     * Flush any remaining text in the buffer
     */
    ChatbotComponent.prototype.flushTextFlowQueue = function(msgId) {
        if (this.pendingTextBuffer) {
            this.textFlowQueue.push({
                text: this.pendingTextBuffer,
                msgId: msgId
            });
            this.pendingTextBuffer = '';
            this.processTextFlowQueue();
        }
    };

    /**
     * Process the text flow queue - animate one item at a time
     */
    ChatbotComponent.prototype.processTextFlowQueue = function() {
        var self = this;
        
        if (this.isFlowAnimating || this.textFlowQueue.length === 0) {
            return;
        }
        
        this.isFlowAnimating = true;
        var item = this.textFlowQueue.shift();
        
        // Create and animate the flowing text
        this.createFlowingTextElement(item.text, function() {
            self.isFlowAnimating = false;
            // Process next item
            self.processTextFlowQueue();
        });
    };

    /**
     * Create a text element that flows out of the robot's mouth and around the edge
     * Uses requestAnimationFrame for smooth animation
     */
    ChatbotComponent.prototype.createFlowingTextElement = function(text, callback) {
        var container = document.getElementById('stream-particles');
        var robotOverlay = document.getElementById('robot-speaker-overlay');
        if (!container) {
            callback();
            return;
        }
        
        var textEl = document.createElement('div');
        textEl.className = 'flowing-text-element';
        textEl.textContent = text;
        container.appendChild(textEl);
        
        // Get container and robot dimensions
        var containerRect = container.getBoundingClientRect();
        var width = containerRect.width;
        var height = containerRect.height;
        var padding = 12;
        
        // Robot mouth position (center of robot, below the head)
        // Robot is at top center, mouth is approximately 85px from top
        var robotMouthX = width / 2;
        var robotMouthY = 95; // Position of robot's mouth
        
        // Animation settings
        var duration = 2000; // ms to complete animation
        var startTime = null;
        
        // Define the path: mouth -> drop down -> right edge -> down -> bottom -> left -> up to message area
        function getPositionOnPath(progress) {
            // Phase 1: 0-0.15 - Text emerges from mouth and drops down
            if (progress < 0.15) {
                var p = progress / 0.15;
                return {
                    x: robotMouthX,
                    y: robotMouthY + p * 30 // Drop down from mouth
                };
            }
            
            // Phase 2: 0.15-0.30 - Arc right from robot
            if (progress < 0.30) {
                var p = (progress - 0.15) / 0.15;
                var angle = Math.PI / 2 - (p * Math.PI / 2); // Arc from down to right
                return {
                    x: robotMouthX + Math.cos(angle) * 80 + (1 - Math.cos(angle)) * (width / 2 - padding - robotMouthX),
                    y: robotMouthY + 30 + Math.sin(angle) * 50
                };
            }
            
            // Phase 3: 0.30-0.50 - Move along right edge (top to bottom)
            if (progress < 0.50) {
                var p = (progress - 0.30) / 0.20;
                return {
                    x: width - padding,
                    y: robotMouthY + 80 + p * (height - robotMouthY - 80 - 150)
                };
            }
            
            // Phase 4: 0.50-0.70 - Move along bottom edge (right to left)
            if (progress < 0.70) {
                var p = (progress - 0.50) / 0.20;
                return {
                    x: width - padding - p * (width - 2 * padding),
                    y: height - 150
                };
            }
            
            // Phase 5: 0.70-0.85 - Move up left edge
            if (progress < 0.85) {
                var p = (progress - 0.70) / 0.15;
                return {
                    x: padding,
                    y: height - 150 - p * 100
                };
            }
            
            // Phase 6: 0.85-1.0 - Curve into message area and fade
            var p = (progress - 0.85) / 0.15;
            return {
                x: padding + p * 60,
                y: height - 250 - p * 50
            };
        }
        
        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            var elapsed = timestamp - startTime;
            var progress = Math.min(elapsed / duration, 1);
            
            if (progress >= 1) {
                textEl.remove();
                callback();
                return;
            }
            
            var pos = getPositionOnPath(progress);
            
            // Calculate opacity
            var opacity = 1;
            if (progress < 0.08) {
                opacity = progress / 0.08; // Fade in from mouth
            } else if (progress > 0.85) {
                opacity = (1 - progress) / 0.15; // Fade out into message
            }
            
            // Calculate scale (start big from mouth, shrink as it moves)
            var scale = 1;
            if (progress < 0.15) {
                scale = 0.8 + progress / 0.15 * 0.2; // Grow from 0.8 to 1.0
            } else if (progress > 0.7) {
                scale = 1 - (progress - 0.7) / 0.3 * 0.5; // Shrink to 0.5
            }
            
            textEl.style.left = pos.x + 'px';
            textEl.style.top = pos.y + 'px';
            textEl.style.opacity = opacity;
            textEl.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
            
            requestAnimationFrame(animate);
        }
        
        // Start animation
        requestAnimationFrame(animate);
    };

    /**
     * Create data stream columns (matrix-style background)
     */
    ChatbotComponent.prototype.createDataStreamColumns = function() {
        var container = document.getElementById('data-stream-bg');
        if (!container) return;
        
        var chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
        
        for (var i = 0; i < 10; i++) {
            var column = document.createElement('div');
            column.className = 'data-stream-column';
            
            // Generate random character string
            var text = '';
            for (var j = 0; j < 30; j++) {
                text += chars[Math.floor(Math.random() * chars.length)];
            }
            column.textContent = text;
            container.appendChild(column);
        }
    };

    /**
     * Configure Bedrock service (called when authenticated)
     */
    ChatbotComponent.prototype.configureBedrockService = function() {
        var config = window.APP_CONFIG || {};
        var devConfig = window.DEV_CONFIG || {};
        
        // Use config or dev config
        var identityPoolId = config.cognitoIdpId || devConfig.cognitoIdpId;
        var region = config.awsRegion || devConfig.awsRegion || 'us-east-1';
        var userPoolId = config.cognitoUserPoolId || devConfig.cognitoUserPoolId;
        
        if (identityPoolId && userPoolId && window.BedrockService) {
            window.BedrockService.configure(identityPoolId, region, userPoolId);
            console.log('[Chatbot] BedrockService configured');
        }
    };

    /**
     * Handle model selection change
     */
    ChatbotComponent.prototype.handleModelChange = function(modelId) {
        if (window.BedrockService) {
            window.BedrockService.setModelId(modelId);
            console.log('[Chatbot] Model changed to:', modelId);
        }
    };

    /**
     * Load available foundation models into the selector
     */
    ChatbotComponent.prototype.loadFoundationModels = function() {
        var self = this;
        var idToken = this.getIdToken();
        
        if (!idToken) {
            console.warn('[Chatbot] Cannot load models - no ID token available');
            return Promise.resolve();
        }
        
        if (!window.BedrockService) {
            console.warn('[Chatbot] Cannot load models - BedrockService not available');
            return Promise.resolve();
        }
        
        // Ensure BedrockService is configured
        this.configureBedrockService();
        
        console.log('[Chatbot] Loading foundation models from Bedrock...');
        
        return window.BedrockService.getAvailableModels(idToken)
            .then(function(models) {
                console.log('[Chatbot] Received', models.length, 'models from Bedrock');
                self.renderModelSelector(models);
                self.modelsLoaded = true;
                return models;
            })
            .catch(function(error) {
                console.error('[Chatbot] Failed to load models:', error);
                // Show error in selector
                if (self.elements.modelSelector) {
                    self.elements.modelSelector.innerHTML = '<option value="backend-default">Error loading models - using default</option>';
                }
                self.modelsLoaded = true; // Prevent retry loops
                return [];
            });
    };

    /**
     * Initialize with authentication (call this after user logs in)
     */
    ChatbotComponent.prototype.initWithAuth = function() {
        var self = this;
        
        // Configure Bedrock service
        this.configureBedrockService();
        
        var runtimeConfigured = window.RuntimeService && !window.RuntimeService.shouldUseLegacy();
        if (!runtimeConfigured && !this.modelsLoaded) {
            this.loadFoundationModels().then(function() {
                console.log('[Chatbot] Models loaded after auth');
            });
        }
    };

    /**
     * Render the model selector dropdown
     */
    ChatbotComponent.prototype.renderModelSelector = function(models) {
        var selector = this.elements.modelSelector;
        if (!selector) return;
        
        // Clear existing options
        selector.innerHTML = '';
        
        // Group models by provider
        var providers = {};
        models.forEach(function(model) {
            var provider = model.providerName || 'Other';
            if (!providers[provider]) {
                providers[provider] = [];
            }
            providers[provider].push(model);
        });
        
        // Get current model ID
        var currentModelId = window.BedrockService ? window.BedrockService.getModelId() : '';
        
        // Create optgroups for each provider
        Object.keys(providers).sort().forEach(function(provider) {
            var group = document.createElement('optgroup');
            group.label = provider;
            
            providers[provider].forEach(function(model) {
                var option = document.createElement('option');
                option.value = model.modelId;
                option.textContent = model.modelName || model.modelId;
                
                // Select current model
                if (model.modelId === currentModelId) {
                    option.selected = true;
                }
                
                group.appendChild(option);
            });
            
            selector.appendChild(group);
        });
        
        // If no models loaded, add default
        if (selector.options.length === 0) {
            var defaultOption = document.createElement('option');
            defaultOption.value = 'backend-default';
            defaultOption.textContent = 'Backend default';
            selector.appendChild(defaultOption);
        }
        
        console.log('[Chatbot] Model selector populated with', models.length, 'models');
    };

    /**
     * Send message to AI with streaming.
     * Routes through AgentCore Runtime proxy when configured, falls back to direct Bedrock.
     */
    ChatbotComponent.prototype.sendToAI = function(message) {
        var self = this;
        var idToken = this.getIdToken();
        var accessToken = this.getAccessToken();
        
        // Prefer ID token for Bedrock, fall back to access token
        var token = idToken || accessToken;
        
        if (!token) {
            this.showError('Not authenticated. Please login first.');
            return;
        }
        
        // Ensure BedrockService is configured (needed for SigV4 credentials in all paths).
        // Only configure once to avoid redundant log noise on every message.
        if (!this._bedrockConfigured) {
            this.configureBedrockService();
            this._bedrockConfigured = true;
        }
        
        var runtimeConfigured = window.RuntimeService && !window.RuntimeService.shouldUseLegacy();

        // Load models only for local legacy fallback. Deployed stacks route through backend runtime.
        if (!runtimeConfigured && !this.modelsLoaded) {
            this.modelsLoaded = true;
            this.loadFoundationModels();
        }
        
        // ──────────────────────────────────────────────────────
        // Route 1: AgentCore Runtime Proxy (preferred)
        //   The runtime handles orchestration, tool calls, and
        //   session management server-side.
        // ──────────────────────────────────────────────────────
        if (runtimeConfigured) {
            this.sendToRuntime(message);
            return;
        }
        
        this.showError('Backend runtime is not configured. Direct browser model invocation is disabled.');
        return;

        // ──────────────────────────────────────────────────────
        // Legacy direct Bedrock path disabled for deployed stacks.
        // ──────────────────────────────────────────────────────
        
        // Update BedrockService with current tool specs
        var allTools = window.MCPService ? window.MCPService.getAllTools() : [];
        var toolSpecs = allTools.map(function(tool) {
            return {
                toolSpec: {
                    name: tool.name,
                    description: tool.description || '',
                    inputSchema: {
                        json: tool.inputSchema || { type: 'object', properties: {} }
                    }
                }
            };
        });
        window.BedrockService.setToolSpecs(toolSpecs);
        
        this.setLoadingState(true);
        this.showTypingIndicator();
        this.shouldStop = false;
        
        // Start streaming animation
        this.startStreamAnimation();
        
        // Initialize text flow queue
        this.initTextFlowQueue();
        
        // Create streaming assistant message
        var msgId = this.addMessage('assistant', '', { isStreaming: true });
        this.hideTypingIndicator();
        
        var streamingContent = '';
        
        // Use BedrockService directly to call Bedrock API
        window.BedrockService.sendMessageStream(message, token, null, {
            onChunk: function(chunk) {
                if (self.shouldStop) return;
                streamingContent += chunk;
                self.updateMessageContent(msgId, streamingContent);
                
                // Animate the text chunk flowing around the edges
                self.queueTextFlow(chunk, msgId);
            },
            onToolUse: function(toolUse) {
                if (self.shouldStop) return;
                self.handleToolUse(toolUse, msgId);
            },
            onComplete: function(result) {
                // Flush any remaining text in the animation queue
                self.flushTextFlowQueue(msgId);
                
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();
                
                // Update token usage from Bedrock response
                if (result.usage) {
                    self.updateTokenUsage(result.usage);
                }
                
                if (result.toolUses && result.toolUses.length > 0) {
                    // Restart animation for tool execution
                    self.startStreamAnimation();
                    self.executeTools(result.toolUses, msgId);
                }
            },
            onError: function(error) {
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();
                self.updateMessageContent(msgId, 'Error: ' + error.message);
            }
        }).catch(function(error) {
            self.finishStreaming(msgId);
            self.setLoadingState(false);
            self.stopStreamAnimation();
            self.showError('Failed to send message: ' + error.message);
        });
    };

    /**
     * Send message via AgentCore Runtime proxy.
     * Tries WebSocket streaming first, falls back to REST.
     * The runtime handles tool calls + orchestration server-side,
     * so no client-side tool loop is needed.
     */
    ChatbotComponent.prototype.sendToRuntime = function(message) {
        var self = this;
        var runtimeService = window.RuntimeService;
        var sessionId = this._runtimeSessionId || null;

        this.setLoadingState(true);
        this.showTypingIndicator();
        this.shouldStop = false;
        this.startStreamAnimation();
        this.initTextFlowQueue();

        // Start elapsed time tracking
        this._startRuntimeTimer();

        // Don't create the message yet — show typing indicator until first content arrives
        var msgId = null;
        var streamingContent = '';
        var firstContentReceived = false;

        // Track active tool executions for this invocation
        var activeToolIds = [];

        // Helper: ensure the streaming message exists (called on first content)
        function ensureStreamingMessage() {
            if (!firstContentReceived) {
                firstContentReceived = true;
                self.hideTypingIndicator();
                msgId = self.addMessage('assistant', '', { isStreaming: true });
            }
            return msgId;
        }

        // Try WebSocket streaming if URL is configured
        if (runtimeService.wsUrl) {
            runtimeService.invokeStream(message, sessionId, {
                onSessionStart: function(newSessionId) {
                    self._runtimeSessionId = newSessionId;
                    sessionStorage.setItem('agentic_runtimeSessionId', newSessionId);
                    console.log('[Chatbot] Runtime session:', newSessionId);
                    self.updateRuntimeStatus('connected', 'Runtime session active');
                },
                onChunk: function(chunk) {
                    if (self.shouldStop) return;
                    ensureStreamingMessage();
                    streamingContent += chunk;
                    self.updateMessageContent(msgId, streamingContent);
                    self.queueTextFlow(chunk, msgId);
                    // Once we get text content, update status to show agent is responding
                    self._updateRuntimePhase('responding');
                },
                onEvent: function(eventData) {
                    if (!eventData) return;

                    // ── Strands-style events from AgentCore ──
                    // contentBlockStart with toolUse: agent is requesting a tool
                    if (eventData.contentBlockStart && eventData.contentBlockStart.toolUse) {
                        var tu = eventData.contentBlockStart.toolUse;
                        var toolId = tu.toolUseId || ('rt-tool-' + Date.now());
                        activeToolIds.push(toolId);
                        self.handleToolUse({
                            id: toolId,
                            name: tu.name,
                            input: tu.input || {},
                            status: 'executing'
                        }, msgId);
                        self._updateRuntimePhase('tool', tu.name);
                    }

                    // contentBlockStop after a tool use — tool execution finished
                    if (eventData.contentBlockStop && activeToolIds.length > 0) {
                        // Mark the last active tool as completed (result comes via text)
                        var lastToolId = activeToolIds[activeToolIds.length - 1];
                        self.updateToolUseStatus(lastToolId, 'completed');
                        self._updateRuntimePhase('thinking');
                    }

                    // Direct toolUse field (proxy-level extraction)
                    if (eventData.toolUse) {
                        var tuId = eventData.toolUse.id || ('rt-tool-' + Date.now());
                        activeToolIds.push(tuId);
                        self.handleToolUse({
                            id: tuId,
                            name: eventData.toolUse.name,
                            input: eventData.toolUse.input,
                            status: eventData.toolUse.status || 'executing'
                        }, msgId);
                        self._updateRuntimePhase('tool', eventData.toolUse.name);
                    }

                    // Direct toolResult field
                    if (eventData.toolResult) {
                        self.updateToolUseStatus(
                            eventData.toolResult.id,
                            eventData.toolResult.error ? 'error' : 'completed',
                            eventData.toolResult.output || eventData.toolResult.error
                        );
                        self._updateRuntimePhase('thinking');
                    }

                    // messageStart — agent begins a new response cycle
                    if (eventData.messageStart) {
                        self._updateRuntimePhase('thinking');
                    }

                    // messageStop — one full response turn complete
                    if (eventData.messageStop) {
                        self._updateRuntimePhase('responding');
                    }
                },
                onComplete: function(result) {
                    // If no content was ever received, create a message with the result info
                    if (!firstContentReceived) {
                        ensureStreamingMessage();
                        var fullResp = result.response || '(No response received from runtime)';
                        self.updateMessageContent(msgId, fullResp);
                    }
                    self.flushTextFlowQueue(msgId);
                    self.finishStreaming(msgId);
                    self.setLoadingState(false);
                    self.stopStreamAnimation();
                    self._stopRuntimeTimer();
                    self._updateRuntimePhase(null);
                    self.hideTypingIndicator();
                    // Store session for conversation continuity
                    if (result.sessionId) self._runtimeSessionId = result.sessionId;
                },
                onError: function(error) {
                    console.warn('[Chatbot] Runtime WS error, falling back to REST:', error.message);
                    self._stopRuntimeTimer();
                    self.hideTypingIndicator();
                    // Ensure message exists for the REST fallback
                    if (!firstContentReceived) {
                        ensureStreamingMessage();
                    }
                    // Fall back to REST
                    self.sendToRuntimeRest(message, msgId, streamingContent);
                }
            }).catch(function(error) {
                console.warn('[Chatbot] Runtime WS connection failed, falling back to REST:', error.message);
                self._stopRuntimeTimer();
                self.hideTypingIndicator();
                // Ensure message exists for the REST fallback
                if (!firstContentReceived) {
                    ensureStreamingMessage();
                }
                self.sendToRuntimeRest(message, msgId, streamingContent);
            });
        } else {
            // No WebSocket URL — use REST directly (create the message now)
            ensureStreamingMessage();
            this.sendToRuntimeRest(message, msgId, streamingContent);
        }
    };

    /**
     * Send message via Runtime REST proxy (synchronous full response).
     * Used as primary when no WS URL is configured, or as fallback.
     */
    ChatbotComponent.prototype.sendToRuntimeRest = function(message, msgId, existingContent) {
        var self = this;
        var runtimeService = window.RuntimeService;
        var sessionId = this._runtimeSessionId || null;

        runtimeService.invokeRest(message, sessionId, {
            onComplete: function(result) {
                self.flushTextFlowQueue(msgId);
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();

                // Display the full response
                var fullText = (existingContent || '') + (result.response || '');
                self.updateMessageContent(msgId, fullText || '(No response from runtime)');

                // Store session ID from result if present
                if (result.sessionId) self._runtimeSessionId = result.sessionId;
            },
            onError: function(error) {
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();
                self.updateMessageContent(msgId, 'Error: ' + error.message);
            }
        });
    };

    /**
     * Send message to orchestrator AI (multi-agent mode)
     */
    ChatbotComponent.prototype.sendToOrchestratorAI = function(message, idToken) {
        var self = this;
        
        this.setLoadingState(true);
        this.showTypingIndicator();
        this.shouldStop = false;
        this.startStreamAnimation();
        
        // Create assistant message for parent agent
        var msgId = this.addMessage('assistant', '', { isStreaming: true });
        this.hideTypingIndicator();
        
        var streamingContent = '';
        var workerContent = {};
        var workerMsgIds = {}; // Map worker ID to worker panel message ID
        var delegationToolIds = {}; // Map worker ID to delegation tool use ID
        
        window.OrchestratorService.processMessage(message, idToken, {
            onChunk: function(chunk, source) {
                if (self.shouldStop) return;
                if (source === 'parent') {
                    streamingContent += chunk;
                    self.updateMessageContent(msgId, streamingContent);
                }
            },
            onToolUse: function(toolUse, source) {
                if (self.shouldStop) return;
                if (source === 'parent' && toolUse.name.indexOf('delegate_to_') === 0) {
                    // Track which delegation tool corresponds to which worker
                    var workerIndex = toolUse.name.replace('delegate_to_worker_', '');
                    delegationToolIds[workerIndex] = toolUse.id;
                    // Render the tool use UI
                    self.handleToolUse(toolUse, msgId);
                    // Mark as executing since worker will handle it
                    self.updateToolUseStatus(toolUse.id, 'executing', undefined, toolUse.input);
                }
            },
            onWorkerStart: function(worker, toolUse) {
                self.setWorkerActive(worker.id, true);
                workerContent[worker.id] = '';
                
                // Show worker panel with the task
                var task = toolUse.input ? toolUse.input.task : 'Processing task...';
                self.showWorkerPanel(worker, task);
                self.updateWorkerPanelStatus('Thinking...');
                
                // Create worker response message placeholder
                workerMsgIds[worker.id] = self.addWorkerPanelMessage('worker', '', worker.name);
            },
            onWorkerChunk: function(worker, chunk) {
                workerContent[worker.id] = (workerContent[worker.id] || '') + chunk;
                // Update worker panel message with streaming content
                if (workerMsgIds[worker.id]) {
                    self.updateWorkerPanelMessage(workerMsgIds[worker.id], workerContent[worker.id], true);
                }
            },
            onWorkerToolUse: function(worker, toolUse) {
                console.log('[Chatbot] Worker', worker.name, 'using tool:', toolUse.name);
                self.updateWorkerPanelStatus('Using ' + toolUse.name + '...');
                // Use expandable tool use component instead of simple indicator
                self.addWorkerToolUse(toolUse);
            },
            onWorkerToolResult: function(worker, toolUse, result) {
                console.log('[Chatbot] Worker', worker.name, 'tool result:', toolUse.name, result);
                // Update the tool use status with result
                var status = result && result.error ? 'error' : 'completed';
                var resultText = result && result.error ? result.error : 
                    (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
                self.updateWorkerToolUseStatus(toolUse.id, status, resultText, toolUse.input);
            },
            onWorkerComplete: function(worker, result) {
                self.setWorkerActive(worker.id, false);
                self.updateWorkerPanelStatus('Complete');
                
                // Finish streaming on worker message
                if (workerMsgIds[worker.id]) {
                    self.updateWorkerPanelMessage(workerMsgIds[worker.id], result, false);
                }
                
                // Animate particle back to parent
                self.animateCommunicationParticle('to-parent');
                
                // Update the delegation tool status to completed
                var workerIndex = worker.id.replace('worker_', '');
                var delegationToolId = delegationToolIds[workerIndex];
                if (delegationToolId) {
                    var resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                    self.updateToolUseStatus(delegationToolId, 'completed', resultText);
                }
                
                // Hide worker panel after a delay
                setTimeout(function() {
                    self.hideWorkerPanel();
                }, 1500);
            },
            onComplete: function(result) {
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();
                self.hideWorkerPanel();
                if (result.usage) self.updateTokenUsage(result.usage);
            },
            onError: function(error) {
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();
                self.hideWorkerPanel();
                // Mark any pending delegation tools as error
                Object.keys(delegationToolIds).forEach(function(workerIndex) {
                    var toolId = delegationToolIds[workerIndex];
                    self.updateToolUseStatus(toolId, 'error', error.message);
                });
                self.updateMessageContent(msgId, streamingContent + '\n\nError: ' + error.message);
            }
        }).catch(function(error) {
            self.finishStreaming(msgId);
            self.setLoadingState(false);
            self.stopStreamAnimation();
            self.hideWorkerPanel();
            self.showError('Orchestrator error: ' + error.message);
        });
    };

    /**
     * Handle tool use from AI response
     */
    ChatbotComponent.prototype.handleToolUse = function(toolUse, msgId) {
        // Add tool use to message UI
        var msgEl = this.elements.messages.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            var bodyEl = msgEl.querySelector('.chat-msg-body');
            var contentEl = msgEl.querySelector('.chat-msg-content');
            var toolEl = this.renderToolUse(toolUse);
            
            // Insert tool element into the body div, before the content element
            if (bodyEl && contentEl) {
                bodyEl.insertBefore(toolEl, contentEl);
            } else if (bodyEl) {
                // Fallback: append to body if content element not found
                bodyEl.appendChild(toolEl);
            }
        }
    };

    /**
     * Execute tools and handle approvals
     */
    ChatbotComponent.prototype.executeTools = function(toolUses, msgId) {
        var self = this;
        // Note: MCPService.callTool uses stored gateway tokens (ID tokens)
        // No need to pass token here - it uses the stored gateway-specific tokens
        var idToken = this.getIdToken();
        
        var toolResults = [];
        var toolIndex = 0;
        
        function executeNextTool() {
            if (self.shouldStop || toolIndex >= toolUses.length) {
                // Continue conversation with tool results
                if (toolResults.length > 0) {
                    self.continueWithToolResults(toolResults);
                } else {
                    // No tool results, stop animation
                    self.stopStreamAnimation();
                }
                return;
            }
            
            var toolUse = toolUses[toolIndex];
            toolIndex++;
            
            // Check approval status
            var approvalStatus = self.getToolApprovalStatus(toolUse.name);
            
            if (approvalStatus === 'always_deny') {
                self.updateToolUseStatus(toolUse.id, 'denied', 'Tool execution denied by configuration');
                toolResults.push({
                    toolUseId: toolUse.id,
                    result: 'Error: Tool execution denied'
                });
                executeNextTool();
                return;
            }
            
            if (approvalStatus === 'require_approval') {
                // Show approval dialog
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
                        self.updateToolUseStatus(toolUse.id, 'denied', 'Tool execution denied by user');
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
            // Update status and input display (input may not have been available when initially rendered)
            self.updateToolUseStatus(toolUse.id, 'executing', undefined, toolUse.input);
            
            // Show robot tool animation
            if (window.RobotToolAnimation) {
                window.RobotToolAnimation.show(toolUse);
            }
            
            // MCPService uses stored gateway-specific ID tokens for tool calls
            window.MCPService.callTool(toolUse.name, toolUse.input)
                .then(function(result) {
                    var resultText = self.formatToolResult(result);
                    self.updateToolUseStatus(toolUse.id, 'completed', resultText);
                    
                    // Complete robot animation with result
                    if (window.RobotToolAnimation) {
                        window.RobotToolAnimation.complete(result);
                    }
                    
                    toolResults.push({
                        toolUseId: toolUse.id,
                        result: resultText
                    });
                    executeNextTool();
                })
                .catch(function(error) {
                    self.updateToolUseStatus(toolUse.id, 'error', error.message);
                    
                    // Show error in robot animation
                    if (window.RobotToolAnimation) {
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
     * Continue conversation after tool execution (uses BedrockService directly)
     */
    ChatbotComponent.prototype.continueWithToolResults = function(toolResults) {
        var self = this;
        var idToken = this.getIdToken();
        var accessToken = this.getAccessToken();
        var token = idToken || accessToken;
        
        this.setLoadingState(true);
        
        var msgId = this.addMessage('assistant', '', { isStreaming: true });
        var streamingContent = '';
        
        // Use BedrockService directly
        window.BedrockService.continueWithToolResults(toolResults, token, null, {
            onChunk: function(chunk) {
                if (self.shouldStop) return;
                streamingContent += chunk;
                self.updateMessageContent(msgId, streamingContent);
            },
            onToolUse: function(toolUse) {
                if (self.shouldStop) return;
                self.handleToolUse(toolUse, msgId);
            },
            onComplete: function(result) {
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                
                // Update token usage from Bedrock response
                if (result.usage) {
                    self.updateTokenUsage(result.usage);
                }
                
                if (result.toolUses && result.toolUses.length > 0) {
                    // More tools to execute - keep animation running
                    self.executeTools(result.toolUses, msgId);
                } else {
                    // No more tools - stop the animation
                    self.stopStreamAnimation();
                }
            },
            onError: function(error) {
                self.finishStreaming(msgId);
                self.setLoadingState(false);
                self.stopStreamAnimation();
            }
        });
    };

    /**
     * Format tool result for display
     */
    ChatbotComponent.prototype.formatToolResult = function(result) {
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
    ChatbotComponent.prototype.requestToolApproval = function(toolUse) {
        var self = this;
        
        return new Promise(function(resolve) {
            self.state.pendingApproval = {
                toolUse: toolUse,
                resolve: resolve
            };
            
            // Update approval dialog content
            self.elements.approvalContent.innerHTML = '\
                <p>The AI wants to execute the following tool:</p>\
                <div class="tool-approval-info">\
                    <div class="tool-name">🔧 ' + escapeHtml(toolUse.name) + '</div>\
                    <strong>Input:</strong>\
                    <pre>' + escapeHtml(JSON.stringify(toolUse.input || {}, null, 2)) + '</pre>\
                </div>\
                <p>Do you want to allow this tool to execute?</p>';
            
            // Show dialog
            self.elements.approvalOverlay.classList.remove('hidden');
        });
    };

    /**
     * Handle approval dialog response
     */
    ChatbotComponent.prototype.handleApprovalResponse = function(approved, remember) {
        if (this.state.pendingApproval) {
            this.state.pendingApproval.resolve({
                approved: approved,
                remember: remember
            });
            this.state.pendingApproval = null;
        }
        
        // Hide dialog
        this.elements.approvalOverlay.classList.add('hidden');
    };

    /**
     * Get tool approval status
     */
    ChatbotComponent.prototype.getToolApprovalStatus = function(toolName) {
        return this.toolApprovals[toolName] || 'require_approval';
    };

    /**
     * Set tool approval status
     */
    ChatbotComponent.prototype.setToolApprovalStatus = function(toolName, status) {
        this.toolApprovals[toolName] = status;
        this.saveToolApprovals();
    };

    /**
     * Load tool approvals from localStorage
     */
    ChatbotComponent.prototype.loadToolApprovals = function() {
        try {
            var saved = localStorage.getItem('agentic_tool_approvals');
            if (saved) {
                this.toolApprovals = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[Chatbot] Failed to load tool approvals:', e);
        }
    };

    /**
     * Save tool approvals to localStorage
     */
    ChatbotComponent.prototype.saveToolApprovals = function() {
        try {
            localStorage.setItem('agentic_tool_approvals', JSON.stringify(this.toolApprovals));
        } catch (e) {
            console.warn('[Chatbot] Failed to save tool approvals:', e);
        }
    };

    /**
     * Set loading state
     */
    ChatbotComponent.prototype.setLoadingState = function(isLoading) {
        this.state.isLoading = isLoading;
        
        if (isLoading) {
            this.elements.sendBtn.classList.add('hidden');
            this.elements.stopBtn.classList.remove('hidden');
            this.elements.input.disabled = true;
        } else {
            this.elements.sendBtn.classList.remove('hidden');
            this.elements.stopBtn.classList.add('hidden');
            this.elements.input.disabled = false;
            this.elements.input.focus();
        }
    };

    /**
     * Handle stop button
     */
    ChatbotComponent.prototype.handleStop = function() {
        this.shouldStop = true;
        
        // Abort active requests
        if (window.RuntimeService) {
            window.RuntimeService.abortAll();
        }
        if (window.ChatService) {
            window.ChatService.abortAll();
        }
        if (window.MCPService) {
            window.MCPService.abortAll();
        }
        
        this.setLoadingState(false);
        this.hideTypingIndicator();
        this.stopStreamAnimation();
    };

    /**
     * Clear conversation
     */
    ChatbotComponent.prototype.clearConversation = function() {
        this.handleStop();
        this.state.messages = [];
        
        // Clear BedrockService history
        if (window.BedrockService) {
            window.BedrockService.clearHistory();
        }
        
        // Clear chat service history (legacy)
        if (window.ChatService) {
            window.ChatService.clearHistory();
        }
        
        // Reset UI
        this.elements.messages.innerHTML = '\
            <div class="chatbot-welcome">\
                <h4>Welcome to Financial Planning Chat</h4>\
                <p>Use the portfolio-planning gateway to create 16-week synthetic plans, run what-if analysis, and prepare weekly reviews.</p>\
                <p>Start with: create a moderate 16-week plan for my demo portfolio.</p>\
            </div>';
    };

    /**
     * Show error message
     */
    ChatbotComponent.prototype.showError = function(message) {
        // Add error as a system message
        this.addMessage('assistant', '⚠️ ' + message);
    };

    /**
     * Show tools panel
     */
    ChatbotComponent.prototype.showToolsPanel = function() {
        var tools = window.MCPService ? window.MCPService.getAllTools() : [];
        
        if (tools.length === 0) {
            this.elements.toolsPanelContent.innerHTML = '<p class="no-tools">No tools available. Connect to MCP servers first.</p>';
        } else {
            var html = '<div class="tools-panel-list">';
            tools.forEach(function(tool) {
                html += '\
                    <div class="tools-panel-item">\
                        <div class="tools-panel-item-name">' + escapeHtml(tool.name) + '</div>\
                        <div class="tools-panel-item-desc">' + escapeHtml(tool.description || 'No description') + '</div>\
                    </div>';
            });
            html += '</div>';
            this.elements.toolsPanelContent.innerHTML = html;
        }
        
        this.elements.toolsPanel.classList.remove('hidden');
    };

    /**
     * Hide tools panel
     */
    ChatbotComponent.prototype.hideToolsPanel = function() {
        this.elements.toolsPanel.classList.add('hidden');
    };

    /**
     * Show servers panel
     */
    ChatbotComponent.prototype.showServersPanel = function() {
        var self = this;
        var gateways = this.getGatewaysList();
        
        if (gateways.length === 0) {
            this.elements.serversPanelContent.innerHTML = '<p>No MCP servers available.</p>';
        } else {
            var html = '<div class="mcp-servers-section">';
            gateways.forEach(function(gateway) {
                var gatewayUrl = gateway.mcpUrl || gateway.url;
                var isConnected = window.MCPService && window.MCPService.isConnected(gatewayUrl);
                var isLoading = self.state.gatewayLoadingStates && self.state.gatewayLoadingStates[gatewayUrl];
                var loadingStep = isLoading ? self.state.gatewayLoadingStates[gatewayUrl] : null;
                var statusClass = isConnected ? 'connected' : (isLoading ? 'loading' : '');
                var statusIcon = isConnected ? '✅' : (isLoading ? '' : '○');
                var toolCount = 0;
                
                if (isConnected && window.MCPService) {
                    var connection = window.MCPService.connectedGateways.get(gatewayUrl);
                    toolCount = connection ? connection.tools.length : 0;
                }
                
                // Loading spinner HTML (no extra whitespace)
                var loadingSpinner = isLoading ? '<div class="gateway-loading-spinner"><div class="spinner-ring"></div></div>' : '';
                
                // Loading step indicator - includes OAuth steps
                var loadingStepHtml = '';
                if (loadingStep) {
                    var stepInfo = {
                        'oauth_start': { text: 'Starting authentication...', icon: '🔐' },
                        'oauth_popup': { text: 'Sign in via popup...', icon: '🪟' },
                        'exchanging_token': { text: 'Exchanging token...', icon: '🔄' },
                        'token_received': { text: 'Token received', icon: '✅' },
                        'connecting': { text: 'Connecting...', icon: '🔌' },
                        'authenticating': { text: 'Authenticating...', icon: '🔐' },
                        'listing_tools': { text: 'Loading tools...', icon: '🔧' },
                        'finalizing': { text: 'Finalizing...', icon: '⏳' },
                        'complete': { text: 'Complete', icon: '✅' },
                        'error': { text: 'Error', icon: '❌' }
                    }[loadingStep] || { text: 'Loading...', icon: '⏳' };
                    loadingStepHtml = '<div class="mcp-server-loading-step"><span class="loading-step-icon">' + stepInfo.icon + '</span> ' + escapeHtml(stepInfo.text) + '</div>';
                }
                
                html += '\
                    <div class="mcp-server-card ' + statusClass + '" data-gateway-url="' + escapeHtml(gatewayUrl) + '">\
                        <div class="mcp-server-header">\
                            <span class="mcp-server-status">' + (isLoading ? loadingSpinner : statusIcon) + '</span>\
                            <span class="mcp-server-name">' + escapeHtml(gateway.name || 'Unknown Server') + '</span>\
                        </div>\
                        ' + (gateway.description ? '<div class="mcp-server-description">' + escapeHtml(gateway.description) + '</div>' : '') + '\
                        ' + loadingStepHtml + '\
                        ' + (isConnected ? '<div class="mcp-server-tools">🔧 ' + toolCount + ' tool(s)</div>' : '') + '\
                    </div>';
            });
            html += '</div>';
            this.elements.serversPanelContent.innerHTML = html;
            
            // Add click handlers for connecting/disconnecting
            var cards = this.elements.serversPanelContent.querySelectorAll('.mcp-server-card');
            cards.forEach(function(card) {
                card.addEventListener('click', function() {
                    // Prevent clicking while loading
                    if (card.classList.contains('loading')) return;
                    var url = card.getAttribute('data-gateway-url');
                    self.toggleGatewayConnection(url);
                });
            });
        }
        
        this.elements.serversPanel.classList.remove('hidden');
    };

    /**
     * Hide servers panel
     */
    ChatbotComponent.prototype.hideServersPanel = function() {
        this.elements.serversPanel.classList.add('hidden');
    };

    /**
     * Set gateway loading state
     */
    ChatbotComponent.prototype.setGatewayLoadingState = function(gatewayUrl, step) {
        if (!this.state.gatewayLoadingStates) {
            this.state.gatewayLoadingStates = {};
        }
        
        if (step) {
            this.state.gatewayLoadingStates[gatewayUrl] = step;
        } else {
            delete this.state.gatewayLoadingStates[gatewayUrl];
        }
        
        // Update the UI if servers panel is open
        this.updateServersList();
    };

    /**
     * Toggle gateway connection
     */
    ChatbotComponent.prototype.toggleGatewayConnection = function(gatewayUrl) {
        var self = this;
        // Use access token for basic gateway connection
        var accessToken = this.getAccessToken();
        
        if (!accessToken) {
            this.showError('Not authenticated. Please login first.');
            return;
        }
        
        if (window.MCPService.isConnected(gatewayUrl)) {
            // Disconnect
            window.MCPService.disconnect(gatewayUrl);
            this.updateServersList();
            this.updateConnectionStatus();
        } else {
            // Find the gateway object from the list
            var gateways = this.getGatewaysList();
            var gateway = gateways.find(function(g) {
                return g.mcpUrl === gatewayUrl || g.url === gatewayUrl;
            });
            
            if (!gateway) {
                this.showError('Gateway not found');
                return;
            }
            
            // Check if gateway requires its own OAuth
            if (gateway.authDiscoveryUrl && gateway.clientId) {
                // Use connectWithGatewayAuth with progress callback
                this.updateStatus('connecting', 'Authenticating to gateway...');
                this.setGatewayLoadingState(gatewayUrl, 'oauth_start');
                
                var progressCallback = function(step, message) {
                    self.setGatewayLoadingState(gatewayUrl, step);
                    if (step === 'oauth_popup') {
                        self.updateStatus('connecting', 'Please sign in via popup...');
                    } else if (step === 'exchanging_token') {
                        self.updateStatus('connecting', 'Exchanging token...');
                    } else if (step === 'connecting') {
                        self.updateStatus('connecting', 'Connecting to gateway...');
                    } else if (step === 'listing_tools') {
                        self.updateStatus('connecting', 'Loading tools...');
                    }
                };
                
                window.MCPService.connectWithGatewayAuth(gateway, progressCallback)
                    .then(function(tools) {
                        console.log('[Chatbot] Connected to gateway with OAuth, tools:', tools);
                        self.setGatewayLoadingState(gatewayUrl, null);
                        self.updateServersList();
                        self.updateConnectionStatus();
                        
                        // Update chat service with tool specs
                        var allTools = window.MCPService.getAllTools();
                        var toolSpecs = allTools.map(function(tool) {
                            return {
                                toolSpec: {
                                    name: tool.name,
                                    description: tool.description || '',
                                    inputSchema: {
                                        json: tool.inputSchema || { type: 'object', properties: {} }
                                    }
                                }
                            };
                        });
                        window.ChatService.setToolSpecs(toolSpecs);
                    })
                    .catch(function(error) {
                        console.error('[Chatbot] Failed to connect with OAuth:', error);
                        self.setGatewayLoadingState(gatewayUrl, null);
                        self.updateStatus('error', 'Connection failed');
                        self.updateServersList();
                        self.showError('Failed to connect: ' + error.message);
                    });
            } else {
                // Connect with standard token
                this.updateStatus('connecting', 'Connecting to server...');
                this.setGatewayLoadingState(gatewayUrl, 'connecting');
                
                window.MCPService.connect(gatewayUrl, accessToken)
                    .then(function() {
                        self.setGatewayLoadingState(gatewayUrl, 'listing_tools');
                        return window.MCPService.listTools(gatewayUrl, accessToken);
                    })
                    .then(function(tools) {
                        self.setGatewayLoadingState(gatewayUrl, 'finalizing');
                        
                        // Brief delay to show finalizing state
                        return new Promise(function(resolve) {
                            setTimeout(function() {
                                resolve(tools);
                            }, 300);
                        });
                    })
                    .then(function(tools) {
                        console.log('[Chatbot] Connected to gateway, tools:', tools);
                        self.setGatewayLoadingState(gatewayUrl, null);
                        self.updateServersList();
                        self.updateConnectionStatus();
                        
                        // Update chat service with tool specs
                        var allTools = window.MCPService.getAllTools();
                        var toolSpecs = allTools.map(function(tool) {
                            return {
                                toolSpec: {
                                    name: tool.name,
                                    description: tool.description || '',
                                    inputSchema: {
                                        json: tool.inputSchema || { type: 'object', properties: {} }
                                    }
                                }
                            };
                        });
                        window.ChatService.setToolSpecs(toolSpecs);
                    })
                    .catch(function(error) {
                        console.error('[Chatbot] Failed to connect:', error);
                        self.setGatewayLoadingState(gatewayUrl, null);
                        self.updateStatus('error', 'Connection failed');
                        self.updateServersList();
                        self.showError('Failed to connect to server: ' + error.message);
                    });
            }
        }
    };

    /**
     * Update servers list in panel
     */
    ChatbotComponent.prototype.updateServersList = function() {
        // Re-render if panel is open
        if (!this.elements.serversPanel.classList.contains('hidden')) {
            this.showServersPanel();
        }
    };

    /**
     * Update connection status
     */
    ChatbotComponent.prototype.updateConnectionStatus = function() {
        var connectedCount = window.MCPService ? window.MCPService.getConnectedGatewayUrls().length : 0;
        var toolCount = window.MCPService ? window.MCPService.getAllTools().length : 0;
        
        if (connectedCount > 0) {
            this.updateStatus('connected', connectedCount + ' server(s) connected • ' + toolCount + ' tool(s)');
        } else {
            this.updateStatus('disconnected', 'Not connected');
        }
    };

    /**
     * Auto-discover gateways and connect to accessible ones
     * Uses application auth to determine which gateways the user has access to
     * Note: Gateways with their own OAuth config are skipped and require explicit click
     */
    ChatbotComponent.prototype.autoDiscoverGateways = function() {
        var self = this;
        // Use access token for auto-discovery (gateways sharing frontend's User Pool)
        var accessToken = this.getAccessToken();
        var gateways = this.getGatewaysList();
        
        if (!accessToken || gateways.length === 0) {
            return Promise.resolve({ accessible: [], inaccessible: [] });
        }
        
        this.updateStatus('connecting', 'Discovering accessible servers...');
        
        return window.MCPService.autoDiscoverGateways(gateways, accessToken)
            .then(function(results) {
                console.log('[Chatbot] Auto-discover results:', results);
                
                self.updateConnectionStatus();
                
                // Update chat service with tool specs from accessible gateways
                var allTools = window.MCPService.getAllTools();
                var toolSpecs = allTools.map(function(tool) {
                    return {
                        toolSpec: {
                            name: tool.name,
                            description: tool.description || '',
                            inputSchema: {
                                json: tool.inputSchema || { type: 'object', properties: {} }
                            }
                        }
                    };
                });
                window.ChatService.setToolSpecs(toolSpecs);
                
                if (results.accessible.length > 0) {
                    console.log('[Chatbot] Connected to ' + results.accessible.length + ' gateway(s)');
                }
                
                if (results.inaccessible.length > 0) {
                    console.log('[Chatbot] ' + results.inaccessible.length + ' gateway(s) not accessible');
                }
                
                return results;
            })
            .catch(function(error) {
                console.error('[Chatbot] Auto-discover failed:', error);
                self.updateStatus('error', 'Discovery failed');
                return { accessible: [], inaccessible: [] };
            });
    };

    // ============================================================
    // RUNTIME TIMER & PHASE TRACKING
    // ============================================================

    /**
     * Start an elapsed time timer that updates the status bar.
     * Provides users visibility into how long the runtime has been processing.
     */
    ChatbotComponent.prototype._startRuntimeTimer = function() {
        var self = this;
        this._runtimeStartTime = Date.now();
        this._runtimePhase = 'thinking';

        // Update immediately, then every second
        this._updateRuntimeTimerDisplay();
        this._runtimeTimerInterval = setInterval(function() {
            self._updateRuntimeTimerDisplay();
        }, 1000);
    };

    /**
     * Stop the elapsed time timer.
     */
    ChatbotComponent.prototype._stopRuntimeTimer = function() {
        if (this._runtimeTimerInterval) {
            clearInterval(this._runtimeTimerInterval);
            this._runtimeTimerInterval = null;
        }
        this._runtimeStartTime = null;
        this._runtimePhase = null;

        // Restore status to default
        this.updateRuntimeStatus('connected', 'Ready');
    };

    /**
     * Update the runtime timer display in the status bar.
     */
    ChatbotComponent.prototype._updateRuntimeTimerDisplay = function() {
        if (!this._runtimeStartTime) return;

        var elapsed = Math.floor((Date.now() - this._runtimeStartTime) / 1000);
        var minutes = Math.floor(elapsed / 60);
        var seconds = elapsed % 60;
        var timeStr = minutes > 0
            ? minutes + 'm ' + seconds + 's'
            : seconds + 's';

        var phaseLabel = this._getPhaseLabel(this._runtimePhase);
        var statusText = phaseLabel + ' • ' + timeStr;

        this.updateRuntimeStatus('streaming', statusText);
    };

    /**
     * Update the current processing phase (thinking, tool, responding).
     * @param {string|null} phase - 'thinking', 'tool', 'responding', or null
     * @param {string} [toolName] - Optional tool name when phase is 'tool'
     */
    ChatbotComponent.prototype._updateRuntimePhase = function(phase, toolName) {
        this._runtimePhase = phase;
        this._runtimeToolName = toolName || null;

        // Immediately refresh the timer display with the new phase
        if (this._runtimeStartTime) {
            this._updateRuntimeTimerDisplay();
        }

        // Update robot speaker text to match current phase
        var robotText = document.querySelector('.robot-speaker-text');
        if (robotText) {
            var label = this._getPhaseLabel(phase);
            robotText.textContent = label;
        }
    };

    /**
     * Get a human-readable label for a runtime phase.
     */
    ChatbotComponent.prototype._getPhaseLabel = function(phase) {
        switch (phase) {
            case 'thinking':
                return '🧠 Thinking...';
            case 'tool':
                return '🔧 Running ' + (this._runtimeToolName || 'tool') + '...';
            case 'responding':
                return '💬 Responding...';
            default:
                return '⚡ Processing...';
        }
    };

    /**
     * Update the runtime status indicator.
     * Uses a distinct visual style from the MCP status to avoid confusion.
     * @param {string} status - 'connected', 'streaming', 'error'
     * @param {string} text - Status text to display
     */
    ChatbotComponent.prototype.updateRuntimeStatus = function(status, text) {
        var indicator = this.elements.statusIndicator;
        var statusText = this.elements.statusText;

        if (!indicator || !statusText) return;

        // When runtime is active, show a different indicator class
        indicator.className = 'status-indicator runtime-' + status;
        setTextContent(statusText, '⚡ ' + text);
    };

    // Export to global scope
    window.ChatbotComponent = ChatbotComponent;

})();

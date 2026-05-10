/**
 * Chatbot Component - Main chatbot UI controller (Refactored)
 * 
 * Security: OWASP10 compliant - all user inputs are escaped.
 * No external dependencies - pure vanilla JavaScript.
 * Integrates with MCP gateways and supports response streaming.
 * 
 * Uses sub-components:
 * - MessageRenderer: Message rendering and display
 * - ToolExecutor: Tool execution and approval
 * - StreamAnimation: Streaming visual effects
 * - WorkerPanel: Worker side panel for orchestrator mode
 * - OrchestratorUI: Orchestrator mode UI elements
 * - PanelsManager: Tools and servers panels
 * - GatewayManager: Gateway connection management
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;
    var setTextContent = window.ChatbotUtils.setTextContent;
    var MessageRenderer = window.ChatbotUtils.MessageRenderer;
    var ToolExecutor = window.ChatbotUtils.ToolExecutor;
    var StreamAnimation = window.ChatbotUtils.StreamAnimation;
    var WorkerPanel = window.ChatbotUtils.WorkerPanel;
    var MultiWorkerPanel = window.ChatbotUtils.MultiWorkerPanel;
    var OrchestratorUI = window.ChatbotUtils.OrchestratorUI;
    var PanelsManager = window.ChatbotUtils.PanelsManager;
    var GatewayManager = window.ChatbotUtils.GatewayManager;
    var WorkerSettings = window.ChatbotUtils.WorkerSettings;

    /**
     * ChatbotComponent constructor
     */
    function ChatbotComponent(containerId, options) {
        this.containerId = containerId;
        this.options = options || {};
        this.container = null;
        this.elements = {};
        this.state = {
            isLoading: false,
            isStreaming: false,
            mcpStatus: 'disconnected',
            tokenUsage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0
            }
        };
        this.shouldStop = false;
        this.modelsLoaded = false;
        
        // Sub-components (initialized in init())
        this.messageRenderer = null;
        this.toolExecutor = null;
        this.streamAnimation = null;
        this.workerPanel = null;
        this.multiWorkerPanel = null; // New multi-panel system
        this.orchestratorUI = null;
        this.panelsManager = null;
        this.gatewayManager = null;
        this.workerSettings = null;
        
        // Cached models for worker settings
        this.availableModels = [];
        
        // Store worker panel content per worker for revisiting
        this.workerPanelHistory = {};
        
        // Callbacks from options
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
        this.initSubComponents();
        this.bindEvents();
        
        console.log('[Chatbot] Initialized with sub-components');
    };

    /**
     * Render the chatbot HTML structure
     */
    ChatbotComponent.prototype.render = function() {
        this.container.innerHTML = '\
            <div class="chatbot-container">\
                <div class="chatbot-header">\
                    <h3>Financial Planning Chat</h3>\
                    <div class="chatbot-controls">\
                        <div class="orchestrator-toggle" id="orchestrator-toggle" title="Enable multi-agent orchestration mode">\
                            <span class="orchestrator-toggle-label">🎭 Orchestrator</span>\
                            <div class="orchestrator-toggle-switch" id="orchestrator-switch"></div>\
                            <span class="orchestrator-toggle-count" id="orchestrator-count"></span>\
                        </div>\
                        <button class="btn-icon" id="chatbot-tools-btn" title="View MCP Tools">🔧 Tools</button>\
                        <button class="btn-icon" id="chatbot-servers-btn" title="MCP Servers">🌐 Servers</button>\
                        <button class="btn-icon" id="chatbot-trace-btn" title="Token Usage Trace">📊 Trace</button>\
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
                        <button class="orchestrator-settings-btn" id="orchestrator-settings-btn" title="Configure Worker Agents">\
                            <span>⚙️</span>\
                            <span>Settings</span>\
                        </button>\
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
                        <button type="submit" class="chatbot-send-btn" id="chatbot-send-btn" title="Send message"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13V3l11 5-11 5z" fill="currentColor"/></svg></button>\
                        <button type="button" class="chatbot-stop-btn hidden" id="chatbot-stop-btn" title="Stop generating"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect width="12" height="12" rx="2" fill="currentColor"/></svg></button>\
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
            modelSelector: document.getElementById('chatbot-model-selector'),
            chatbotContainer: this.container.querySelector('.chatbot-container')
        };
    };

    /**
     * Initialize sub-components
     */
    ChatbotComponent.prototype.initSubComponents = function() {
        var self = this;
        
        // Message Renderer
        this.messageRenderer = new MessageRenderer(this.elements.messages);
        
        // Tool Executor
        this.toolExecutor = new ToolExecutor({
            onStatusUpdate: function(toolId, status, result, input) {
                self.messageRenderer.updateToolUseStatus(toolId, status, result, input);
                
                // Show inline status message in chat during tool execution
                var statusMsgId = 'tool-status-' + toolId;
                var statusContainer = document.getElementById(statusMsgId);
                
                if (status === 'executing') {
                    // Find the tool name from the tool element
                    var toolEl = self.elements.messages.querySelector('[data-tool-id="' + toolId + '"]');
                    var toolName = toolEl ? (toolEl.querySelector('.tool-use-name') ? toolEl.querySelector('.tool-use-name').textContent : 'tool') : 'tool';
                    // Extract clean display name
                    if (toolName.indexOf('___') !== -1) {
                        toolName = toolName.split('___').pop();
                    }
                    
                    if (!statusContainer) {
                        // Create a streaming message bubble
                        var msgDiv = document.createElement('div');
                        msgDiv.id = statusMsgId;
                        msgDiv.className = 'chat-msg assistant streaming';
                        msgDiv.innerHTML = '<div class="chat-msg-body"><div class="chat-msg-content tool-thinking-stream"></div></div>';
                        self.elements.messages.appendChild(msgDiv);
                        statusContainer = msgDiv;
                        
                        // Word-by-word streaming for natural feel
                        var sentences = [
                            'Let me run ' + toolName + ' to get the information you need.',
                            'Fetching the data from the service now.',
                            'Processing the results — this might take a moment.',
                            'Still working on it, almost there.',
                            'Gathering the final pieces of data.',
                            'Just a moment while I finish up.'
                        ];
                        var allWords = [];
                        sentences.forEach(function(s, i) {
                            var words = s.split(' ');
                            words.forEach(function(w, j) {
                                allWords.push({ word: (j === 0 && i > 0 ? '\n' : '') + (j > 0 ? ' ' : '') + w, pause: i });
                            });
                        });
                        
                        var wordIdx = 0;
                        var streamEl = msgDiv.querySelector('.tool-thinking-stream');
                        var displayText = '';
                        var currentPause = 0;
                        
                        function streamNextWord() {
                            if (!msgDiv._streamActive) return;
                            if (wordIdx >= allWords.length) return; // stop at end
                            
                            var item = allWords[wordIdx];
                            // Add a longer pause between sentences
                            var delay = 60 + Math.random() * 40; // 60-100ms per word
                            if (item.pause > currentPause) {
                                currentPause = item.pause;
                                delay = 1500 + Math.random() * 1000; // 1.5-2.5s pause between sentences
                            }
                            
                            displayText += item.word;
                            streamEl.textContent = displayText;
                            wordIdx++;
                            self.elements.messages.scrollTop = self.elements.messages.scrollHeight;
                            
                            msgDiv._streamTimeout = setTimeout(streamNextWord, delay);
                        }
                        
                        msgDiv._streamActive = true;
                        streamNextWord();
                    }
                } else if (status === 'completed') {
                    if (statusContainer) {
                        statusContainer._streamActive = false;
                        if (statusContainer._streamTimeout) clearTimeout(statusContainer._streamTimeout);
                        // Fade out and remove
                        statusContainer.style.transition = 'opacity 0.4s ease';
                        statusContainer.style.opacity = '0';
                        setTimeout(function() {
                            if (statusContainer.parentNode) statusContainer.parentNode.removeChild(statusContainer);
                        }, 400);
                    }
                } else if (status === 'error') {
                    if (statusContainer) {
                        statusContainer._streamActive = false;
                        if (statusContainer._streamTimeout) clearTimeout(statusContainer._streamTimeout);
                        statusContainer.classList.remove('streaming');
                        var streamEl = statusContainer.querySelector('.tool-thinking-stream');
                        if (streamEl) streamEl.textContent = 'Something went wrong with this step.';
                        setTimeout(function() {
                            if (statusContainer.parentNode) statusContainer.parentNode.removeChild(statusContainer);
                        }, 3000);
                    }
                } else if (status === 'denied') {
                    if (statusContainer) {
                        statusContainer._streamActive = false;
                        if (statusContainer._streamTimeout) clearTimeout(statusContainer._streamTimeout);
                        if (statusContainer.parentNode) statusContainer.parentNode.removeChild(statusContainer);
                    }
                }
            }
        });
        
        this.toolExecutor.setApprovalElements(
            document.getElementById('tool-approval-overlay'),
            document.getElementById('tool-approval-content'),
            {
                approve: document.getElementById('approval-approve'),
                alwaysApprove: document.getElementById('approval-always-approve'),
                deny: document.getElementById('approval-deny'),
                alwaysDeny: document.getElementById('approval-always-deny')
            }
        );
        
        // Stream Animation - disabled (no visual animation needed)
        this.streamAnimation = {
            start: function() {},
            stop: function() {},
            initTextFlowQueue: function() {},
            queueTextFlow: function() {},
            flushTextFlowQueue: function() {},
            animateCommunicationParticle: function() {}
        };
        
        // Worker Panel (legacy single panel)
        this.workerPanel = new WorkerPanel({
            panel: document.getElementById('worker-side-panel'),
            panelName: document.getElementById('worker-panel-name'),
            panelStatus: document.getElementById('worker-panel-status'),
            statusText: document.getElementById('worker-status-text'),
            panelMessages: document.getElementById('worker-panel-messages'),
            closeBtn: document.getElementById('worker-panel-close'),
            chatbotContainer: this.elements.chatbotContainer
        });
        
        // Multi Worker Panel (new simultaneous panels system)
        this.multiWorkerPanel = new MultiWorkerPanel(this.elements.chatbotContainer);
        
        // Orchestrator UI
        this.orchestratorUI = new OrchestratorUI({
            toggle: document.getElementById('orchestrator-toggle'),
            toggleSwitch: document.getElementById('orchestrator-switch'),
            countElement: document.getElementById('orchestrator-count'),
            statusBar: document.getElementById('orchestrator-status-bar'),
            workersList: document.getElementById('orchestrator-workers-list')
        });
        
        this.orchestratorUI.init(function() {
            self.toggleOrchestratorMode();
        }, function(workerId) {
            // Worker chip click handler - reopen panel to view history
            self.handleWorkerChipClick(workerId);
        });
        
        // Panels Manager
        this.panelsManager = new PanelsManager({
            toolsPanel: document.getElementById('tools-panel-overlay'),
            toolsPanelContent: document.getElementById('tools-panel-content'),
            toolsPanelClose: document.getElementById('tools-panel-close'),
            serversPanel: document.getElementById('servers-panel-overlay'),
            serversPanelContent: document.getElementById('servers-panel-content'),
            serversPanelClose: document.getElementById('servers-panel-close')
        });
        
        this.panelsManager.setGatewaysListGetter(function() {
            return self.getGatewaysList();
        });
        
        this.panelsManager.setGatewayToggleCallback(function(url) {
            self.gatewayManager.toggleConnection(url);
        });
        
        // Worker Settings
        this.workerSettings = new WorkerSettings();
        this.workerSettings.init({
            onSave: function() {
                console.log('[Chatbot] Worker settings saved');
            },
            getAvailableModels: function() {
                return self.availableModels;
            }
        });
        
        // Gateway Manager
        this.gatewayManager = new GatewayManager({
            getAccessToken: function() { return self.getAccessToken(); },
            getIdToken: function() { return self.getIdToken(); },
            getGatewaysList: function() { return self.getGatewaysList(); },
            onStatusUpdate: function(status, text) {
                self.updateStatus(status, text);
            },
            onLoadingStateChange: function(gatewayUrl, step) {
                self.panelsManager.setGatewayLoadingState(gatewayUrl, step);
            },
            onConnectionChange: function() {
                self.panelsManager.refreshServersList();
                self.updateConnectionStatus();
                self.orchestratorUI.update();
            },
            onError: function(message) {
                self.showError(message);
            }
        });
        
        // Token Audit Panel
        var TokenAuditPanel = window.ChatbotUtils.TokenAuditPanel;
        this.tokenAuditPanel = new TokenAuditPanel();
        this.tokenAuditPanel.init();
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
            self.panelsManager.showToolsPanel();
        });
        
        // Servers panel
        this.elements.serversBtn.addEventListener('click', function() {
            self.panelsManager.showServersPanel();
        });
        
        // Trace panel
        document.getElementById('chatbot-trace-btn').addEventListener('click', function() {
            self.tokenAuditPanel.show();
        });
        
        // Worker settings button
        var settingsBtn = document.getElementById('orchestrator-settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', function() {
                self.workerSettings.show();
            });
        }
        
        // Model selector (removed from UI - model set in backend)
        if (this.elements.modelSelector) {
            this.elements.modelSelector.addEventListener('change', function() {
                self.handleModelChange(self.elements.modelSelector.value);
            });
        }
    };

    /**
     * Toggle orchestrator mode
     */
    ChatbotComponent.prototype.toggleOrchestratorMode = function() {
        if (!window.OrchestratorService) {
            console.warn('[Chatbot] OrchestratorService not available');
            return;
        }
        
        var currentState = window.OrchestratorService.isEnabled();
        var newState = !currentState;
        
        var connectedCount = window.MCPService ? window.MCPService.getConnectedGatewayUrls().length : 0;
        if (newState && connectedCount === 0) {
            this.showError('Connect to at least one MCP server to enable Orchestrator mode');
            return;
        }
        
        window.OrchestratorService.setEnabled(newState);
        this.orchestratorUI.update();
        
        // Clear worker history when toggling orchestrator mode
        this.workerPanelHistory = {};
        this.orchestratorUI.clearWorkerStates();
        
        this.clearConversation();
    };

    /**
     * Handle worker chip click - show/toggle that worker's panel
     */
    ChatbotComponent.prototype.handleWorkerChipClick = function(workerId) {
        var self = this;
        var worker = window.OrchestratorService ? window.OrchestratorService.getWorkerById(workerId) : null;
        if (!worker) {
            console.warn('[Chatbot] Worker not found:', workerId);
            return;
        }
        
        console.log('[Chatbot] Worker chip clicked:', workerId);
        
        // Use multi-panel system to show/toggle this worker's panel
        if (this.multiWorkerPanel.showWorkerHistory(workerId)) {
            console.log('[Chatbot] Opened panel for worker:', workerId);
        } else {
            console.log('[Chatbot] No history for worker:', workerId, '- creating placeholder');
            // No content for this worker yet - show placeholder message
            var msgId = this.multiWorkerPanel.showWorker(worker, 'No tasks delegated yet');
            this.multiWorkerPanel.updateWorkerStatus(workerId, 'Waiting for tasks...');
        }
    };

    /**
     * Store worker panel content for later revisiting
     */
    ChatbotComponent.prototype.storeWorkerPanelHistory = function(workerId, status) {
        // Save current content to worker panel storage
        this.workerPanel.saveCurrentContent();
        this.workerPanel.updateStatus(status || 'Complete', workerId);
        
        // Mark this worker as having content in the UI
        this.orchestratorUI.setWorkerHasContent(workerId, true);
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
     * Update connection status from gateway manager
     */
    ChatbotComponent.prototype.updateConnectionStatus = function() {
        var status = this.gatewayManager.getConnectionStatus();
        this.updateStatus(status.status, status.text);
    };

    /**
     * Handle sending a message
     */
    ChatbotComponent.prototype.handleSendMessage = function() {
        var message = this.elements.input.value.trim();
        
        if (!message || this.state.isLoading) return;
        
        if (message.length > 4000) {
            this.showError('Message too long. Maximum 4000 characters.');
            return;
        }
        
        this.messageRenderer.addMessage('user', message);
        this.elements.input.value = '';
        this.autoResizeInput();
        this.sendToAI(message);
    };

    /**
     * Update token usage display
     */
    ChatbotComponent.prototype.updateTokenUsage = function(usage) {
        if (!usage) return;
        
        var inputTokens = usage.inputTokens || 0;
        var outputTokens = usage.outputTokens || 0;
        
        // Bedrock usage is cumulative per conversation, use direct assignment
        this.state.tokenUsage.inputTokens = inputTokens;
        this.state.tokenUsage.outputTokens = outputTokens;
        this.state.tokenUsage.totalTokens = inputTokens + outputTokens;
        
        var inputEl = document.getElementById('token-input');
        var outputEl = document.getElementById('token-output');
        var totalEl = document.getElementById('token-total');
        
        if (inputEl) setTextContent(inputEl, this.formatNumber(this.state.tokenUsage.inputTokens));
        if (outputEl) setTextContent(outputEl, this.formatNumber(this.state.tokenUsage.outputTokens));
        if (totalEl) setTextContent(totalEl, this.formatNumber(this.state.tokenUsage.totalTokens));
    };

    /**
     * Format number with commas
     */
    ChatbotComponent.prototype.formatNumber = function(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    /**
     * Configure Bedrock service
     */
    ChatbotComponent.prototype.configureBedrockService = function() {
        var config = window.APP_CONFIG || {};
        var devConfig = window.DEV_CONFIG || {};
        
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
     * Load available foundation models
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
        
        this.configureBedrockService();
        
        return window.BedrockService.getAvailableModels(idToken)
            .then(function(models) {
                self.availableModels = models;
                self.renderModelSelector(models);
                self.modelsLoaded = true;
                return models;
            })
            .catch(function(error) {
                console.error('[Chatbot] Failed to load models:', error);
                if (self.elements.modelSelector) {
                    self.elements.modelSelector.innerHTML = '<option value="backend-default">Error loading models - using default</option>';
                }
                self.modelsLoaded = true;
                return [];
            });
    };

    /**
     * Initialize with authentication
     */
    ChatbotComponent.prototype.initWithAuth = function() {
        this.configureBedrockService();

        var runtimeConfigured = window.RuntimeService && !window.RuntimeService.shouldUseLegacy();
        if (!runtimeConfigured && !this.modelsLoaded) {
            this.loadFoundationModels();
        }
    };

    /**
     * Render the model selector dropdown
     */
    ChatbotComponent.prototype.renderModelSelector = function(models) {
        var selector = this.elements.modelSelector;
        if (!selector) return;
        
        selector.innerHTML = '';
        
        var providers = {};
        models.forEach(function(model) {
            var provider = model.providerName || 'Other';
            if (!providers[provider]) {
                providers[provider] = [];
            }
            providers[provider].push(model);
        });
        
        var currentModelId = window.BedrockService ? window.BedrockService.getModelId() : '';
        
        Object.keys(providers).sort().forEach(function(provider) {
            var group = document.createElement('optgroup');
            group.label = provider;
            
            providers[provider].forEach(function(model) {
                var option = document.createElement('option');
                option.value = model.modelId;
                option.textContent = model.modelName || model.modelId;
                
                if (model.modelId === currentModelId) {
                    option.selected = true;
                }
                
                group.appendChild(option);
            });
            
            selector.appendChild(group);
        });
        
        if (selector.options.length === 0) {
            var defaultOption = document.createElement('option');
            defaultOption.value = 'backend-default';
            defaultOption.textContent = 'Backend default';
            selector.appendChild(defaultOption);
        }
    };

    /**
     * Send message to AI
     */
    ChatbotComponent.prototype.sendToAI = function(message) {
        var self = this;
        var idToken = this.getIdToken();
        var accessToken = this.getAccessToken();
        var token = idToken || accessToken;
        
        if (!token) {
            this.showError('Not authenticated. Please login first.');
            return;
        }
        
        this.configureBedrockService();
        
        var runtimeConfigured = window.RuntimeService && !window.RuntimeService.shouldUseLegacy();

        if (!runtimeConfigured && !this.modelsLoaded) {
            this.modelsLoaded = true;
            this.loadFoundationModels();
        }
        
        // ── Route through AgentCore Runtime proxy when configured ──
        // RuntimeService handles LLM orchestration, tool invocation, and memory
        // server-side — the frontend just streams events back.
        if (runtimeConfigured) {
            this.sendToRuntime(message, token);
            return;
        }

        this.showError('Backend runtime is not configured. Direct browser model invocation is disabled.');
        return;

        // ── Legacy path disabled for deployed stacks ──
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
        this.messageRenderer.showTypingIndicator();
        this.shouldStop = false;
        this.toolExecutor.reset();
        
        this.streamAnimation.start();
        this.streamAnimation.initTextFlowQueue();
        
        var msgId = this.messageRenderer.addMessage('assistant', '', { isStreaming: true });
        this.messageRenderer.hideTypingIndicator();
        
        var streamingContent = '';
        
        window.BedrockService.sendMessageStream(message, token, null, {
            onChunk: function(chunk) {
                if (self.shouldStop) return;
                streamingContent += chunk;
                self.messageRenderer.updateMessageContent(msgId, streamingContent);
                self.streamAnimation.queueTextFlow(chunk, msgId);
            },
            onToolUse: function(toolUse) {
                if (self.shouldStop) return;
                self.messageRenderer.addToolUseToMessage(msgId, toolUse);
            },
            onComplete: function(result) {
                self.streamAnimation.flushTextFlowQueue(msgId);
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.streamAnimation.stop();
                
                if (result.usage) {
                    self.updateTokenUsage(result.usage);
                    var modelId = window.BedrockService ? window.BedrockService.getModelId() : 'unknown';
                    self.tokenAuditPanel.addEntry('Parent', 'parent', modelId, result.usage, result.toolUses ? result.toolUses.length : 0);
                }
                
                if (result.toolUses && result.toolUses.length > 0) {
                    self.streamAnimation.start();
                    self.executeTools(result.toolUses, msgId);
                } else {
                    // No more tool calls — auto-save the conversation
                    self.autoSaveConversation();
                }
            },
            onError: function(error) {
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.streamAnimation.stop();
                self.messageRenderer.updateMessageContent(msgId, 'Error: ' + error.message);
            }
        }).catch(function(error) {
            self.messageRenderer.finishStreaming(msgId);
            self.setLoadingState(false);
            self.streamAnimation.stop();
            self.showError('Failed to send message: ' + error.message);
        });
    };

    /**
     * Send message via AgentCore Runtime proxy (WebSocket streaming with REST fallback).
     *
     * The Runtime handles tool orchestration, memory, and LLM calls server-side.
     * The frontend only streams the final events (text chunks, tool-use indicators,
     * and completion) — no client-side tool execution loop needed.
     *
     * @param {string} message - The user's message text
     * @param {string} token   - Auth token (ID or access)
     */
    ChatbotComponent.prototype.sendToRuntime = function(message, token) {
        var self = this;

        console.log('[Chatbot] Routing through AgentCore Runtime proxy');

        this.setLoadingState(true);
        this.messageRenderer.showTypingIndicator();
        this.shouldStop = false;

        var msgId = this.messageRenderer.addMessage('assistant', '', { isStreaming: true });
        this.messageRenderer.hideTypingIndicator();

        var streamingContent = '';
        var sessionId = this._runtimeSessionId || null;

        // Prefer WebSocket streaming when available, fall back to REST
        var useWebSocket = window.RuntimeService.wsUrl &&
                           window.RuntimeService._isRealValue(window.RuntimeService.wsUrl);

        if (useWebSocket) {
            // ── WebSocket streaming path ──
            window.RuntimeService.invokeStream(message, sessionId, {
                onChunk: function(chunk) {
                    if (self.shouldStop) return;
                    streamingContent += chunk;
                    self.messageRenderer.updateMessageContent(msgId, streamingContent);
                },
                onEvent: function(eventData, index) {
                    if (self.shouldStop) return;
                    // Surface tool-use events from the runtime as inline indicators
                    if (eventData && eventData.toolUse) {
                        self.messageRenderer.addToolUseToMessage(msgId, eventData.toolUse);
                    }
                },
                onSessionStart: function(sid, runtimeArn) {
                    console.log('[Chatbot] Runtime session started:', sid);
                    self._runtimeSessionId = sid;
                },
                onComplete: function(result) {
                    self.messageRenderer.finishStreaming(msgId);
                    self.setLoadingState(false);
                    self.autoSaveConversation();
                    console.log('[Chatbot] Runtime stream complete, chunks:', result.totalChunks);
                },
                onError: function(error) {
                    console.error('[Chatbot] Runtime stream error:', error);
                    self.messageRenderer.finishStreaming(msgId);
                    self.setLoadingState(false);
                    self.messageRenderer.updateMessageContent(msgId, 'Error: ' + error.message);
                }
            }).catch(function(error) {
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.showError('Failed to connect to runtime: ' + error.message);
            });
        } else {
            // ── REST fallback path (synchronous full response) ──
            window.RuntimeService.invokeRest(message, sessionId, {
                onComplete: function(result) {
                    streamingContent = result.response || '';
                    self.messageRenderer.updateMessageContent(msgId, streamingContent);
                    self.messageRenderer.finishStreaming(msgId);
                    self.setLoadingState(false);
                    self.autoSaveConversation();
                    console.log('[Chatbot] Runtime REST response received');
                },
                onError: function(error) {
                    console.error('[Chatbot] Runtime REST error:', error);
                    self.messageRenderer.finishStreaming(msgId);
                    self.setLoadingState(false);
                    self.messageRenderer.updateMessageContent(msgId, 'Error: ' + error.message);
                }
            }).catch(function(error) {
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.showError('Failed to invoke runtime: ' + error.message);
            });
        }
    };

    /**
     * Send message to orchestrator AI
     */
    ChatbotComponent.prototype.sendToOrchestratorAI = function(message, idToken) {
        var self = this;
        
        this.setLoadingState(true);
        this.messageRenderer.showTypingIndicator();
        this.shouldStop = false;
        this.streamAnimation.start();
        
        var msgId = this.messageRenderer.addMessage('assistant', '', { isStreaming: true });
        this.messageRenderer.hideTypingIndicator();
        
        var streamingContent = '';
        var workerMsgIds = {};
        var delegationToolIds = []; // Array to preserve order - each delegation gets index 0, 1, 2...
        var delegationIndex = 0;
        
        // Workers persist throughout the orchestrator session
        // Start new session to track separators between user messages (not parallel delegations)
        this.multiWorkerPanel.startNewSession();
        
        window.OrchestratorService.processMessage(message, idToken, {
            onChunk: function(chunk, source) {
                if (self.shouldStop) return;
                if (source === 'parent') {
                    streamingContent += chunk;
                    self.messageRenderer.updateMessageContent(msgId, streamingContent);
                }
            },
            onToolUse: function(toolUse, source) {
                if (self.shouldStop) return;
                if (source === 'parent' && toolUse.name.indexOf('delegate_to_') === 0) {
                    // Store by index to preserve order (don't key by worker since same worker can be called multiple times)
                    delegationToolIds.push(toolUse.id);
                    self.messageRenderer.addToolUseToMessage(msgId, toolUse);
                    self.messageRenderer.updateToolUseStatus(toolUse.id, 'executing', undefined, toolUse.input);
                }
            },
            onWorkerStart: function(worker, toolUse) {
                self.orchestratorUI.setWorkerActive(worker.id, true);
                var task = toolUse.input ? toolUse.input.task : 'Processing task...';
                
                // Use multi-panel system - shows multiple panels simultaneously
                workerMsgIds[worker.id] = self.multiWorkerPanel.showWorker(worker, task);
                
                // Mark worker as having content
                self.orchestratorUI.setWorkerHasContent(worker.id, true);
            },
            onWorkerChunk: function(worker, chunk) {
                if (!self._workerContent) self._workerContent = {};
                self._workerContent[worker.id] = (self._workerContent[worker.id] || '') + chunk;
                
                // Update this worker's panel (no switching needed - all panels visible)
                if (workerMsgIds[worker.id]) {
                    self.multiWorkerPanel.updateWorkerMessage(worker.id, workerMsgIds[worker.id], self._workerContent[worker.id], true);
                }
            },
            onWorkerToolUse: function(worker, toolUse) {
                // Extract clean tool name for status display
                var displayName = toolUse.name;
                if (displayName && displayName.indexOf('___') !== -1) {
                    displayName = displayName.split('___').pop();
                }
                
                self.multiWorkerPanel.updateWorkerStatus(worker.id, 'Using ' + displayName + '...');
                self.multiWorkerPanel.addWorkerToolUse(worker.id, toolUse);
            },
            onWorkerToolResult: function(worker, toolUse, result) {
                var status = result && result.error ? 'error' : 'completed';
                var resultText = result && result.error ? result.error : 
                    (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
                self.multiWorkerPanel.updateToolUseStatus(worker.id, toolUse.id, status, resultText, toolUse.input);
            },
            onWorkerComplete: function(worker, result) {
                // worker is now a delegationInstance with {id, workerId, name, worker, task}
                var workerId = worker.workerId || worker.id;
                var delegationId = worker.id;
                
                self.orchestratorUI.setWorkerActive(workerId, false);
                
                if (workerMsgIds[delegationId]) {
                    self.multiWorkerPanel.updateWorkerMessage(delegationId, workerMsgIds[delegationId], result, false);
                }
                
                self.streamAnimation.animateCommunicationParticle('to-parent');
                
                // Use the delegation index from the delegationId (delegation_0, delegation_1, etc.)
                // Extract the index to find the matching tool ID
                var delegationNum = parseInt(delegationId.replace('delegation_', ''), 10);
                // Find the tool ID by order (delegations complete in order since they're sequential)
                var delegationToolId = delegationToolIds[delegationIndex];
                if (delegationToolId) {
                    var resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                    self.messageRenderer.updateToolUseStatus(delegationToolId, 'completed', resultText);
                }
                delegationIndex++; // Move to next delegation
                
                // Mark worker as complete (panel stays visible for a bit)
                self.multiWorkerPanel.completeWorker(delegationId, result);
            },
            onParentUsage: function(usage, callIndex, toolCount) {
                var modelId = window.BedrockService ? window.BedrockService.getModelId() : 'unknown';
                self.tokenAuditPanel.addEntry('Parent', 'parent', modelId, usage, toolCount);
            },
            onWorkerUsage: function(worker, usage, toolCount) {
                var workerName = worker.name || worker.workerId || 'Worker';
                var workerModelId = (worker.worker && worker.worker.getModelId) ? worker.worker.getModelId() : 'unknown';
                self.tokenAuditPanel.addEntry(workerName, 'worker', workerModelId, usage, toolCount);
            },
            onComplete: function(result) {
                self._workerContent = {};
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.streamAnimation.stop();
                // Hide all panels after a short delay
                setTimeout(function() {
                    self.multiWorkerPanel.hideAll();
                }, 2500);
                if (result.usage) self.updateTokenUsage(result.usage);
            },
            onError: function(error) {
                self._workerContent = {};
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.streamAnimation.stop();
                self.multiWorkerPanel.hideAll();
                Object.keys(delegationToolIds).forEach(function(workerIndex) {
                    var toolId = delegationToolIds[workerIndex];
                    self.messageRenderer.updateToolUseStatus(toolId, 'error', error.message);
                });
                self.messageRenderer.updateMessageContent(msgId, streamingContent + '\n\nError: ' + error.message);
            }
        }).catch(function(error) {
            self._workerContent = {};
            self.messageRenderer.finishStreaming(msgId);
            self.setLoadingState(false);
            self.streamAnimation.stop();
            self.multiWorkerPanel.hideAll();
            self.showError('Orchestrator error: ' + error.message);
        });
    };

    /**
     * Execute tools
     */
    ChatbotComponent.prototype.executeTools = function(toolUses, msgId) {
        var self = this;
        
        this.toolExecutor.executeTools(toolUses, function(toolResults) {
            if (toolResults.length > 0) {
                self.continueWithToolResults(toolResults);
            } else {
                self.streamAnimation.stop();
            }
        });
    };

    /**
     * Continue conversation after tool execution
     */
    ChatbotComponent.prototype.continueWithToolResults = function(toolResults) {
        var self = this;
        var idToken = this.getIdToken();
        var accessToken = this.getAccessToken();
        var token = idToken || accessToken;
        
        this.setLoadingState(true);
        
        var msgId = this.messageRenderer.addMessage('assistant', '', { isStreaming: true });
        var streamingContent = '';
        
        window.BedrockService.continueWithToolResults(toolResults, token, null, {
            onChunk: function(chunk) {
                if (self.shouldStop) return;
                streamingContent += chunk;
                self.messageRenderer.updateMessageContent(msgId, streamingContent);
            },
            onToolUse: function(toolUse) {
                if (self.shouldStop) return;
                self.messageRenderer.addToolUseToMessage(msgId, toolUse);
            },
            onComplete: function(result) {
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                
                if (result.usage) {
                    self.updateTokenUsage(result.usage);
                    var modelId = window.BedrockService ? window.BedrockService.getModelId() : 'unknown';
                    self.tokenAuditPanel.addEntry('Parent', 'parent', modelId, result.usage, result.toolUses ? result.toolUses.length : 0);
                }
                
                if (result.toolUses && result.toolUses.length > 0) {
                    self.executeTools(result.toolUses, msgId);
                } else {
                    self.streamAnimation.stop();
                    // No more tool calls — auto-save the conversation
                    self.autoSaveConversation();
                }
            },
            onError: function(error) {
                self.messageRenderer.finishStreaming(msgId);
                self.setLoadingState(false);
                self.streamAnimation.stop();
            }
        });
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
        this.toolExecutor.stop();
        
        if (window.ChatService) {
            window.ChatService.abortAll();
        }
        if (window.MCPService) {
            window.MCPService.abortAll();
        }
        if (window.RuntimeService) {
            window.RuntimeService.abortAll();
        }
        
        this.setLoadingState(false);
        this.messageRenderer.hideTypingIndicator();
        this.streamAnimation.stop();
    };

    /**
     * Auto-save the current conversation to the backend
     */
    ChatbotComponent.prototype.autoSaveConversation = function() {
        if (!window.ConversationService || !window.BedrockService) return;
        
        var history = window.BedrockService.getHistory();
        if (!history || history.length === 0) return;
        
        var modelId = window.BedrockService.getModelId();
        window.ConversationService.autoSave(history, modelId);
    };

    /**
     * Clear conversation
     */
    ChatbotComponent.prototype.clearConversation = function() {
        this.handleStop();
        this.messageRenderer.clear();
        
        if (this.tokenAuditPanel) {
            this.tokenAuditPanel.clear();
        }
        
        if (window.BedrockService) {
            window.BedrockService.clearHistory();
        }
        if (window.ChatService) {
            window.ChatService.clearHistory();
        }
    };

    /**
     * Show error message
     */
    ChatbotComponent.prototype.showError = function(message) {
        this.messageRenderer.addMessage('assistant', '⚠️ ' + message);
    };

    /**
     * Auto-discover gateways
     */
    ChatbotComponent.prototype.autoDiscoverGateways = function() {
        return this.gatewayManager.autoDiscoverGateways();
    };

    // Export to global scope
    window.ChatbotComponent = ChatbotComponent;

})();

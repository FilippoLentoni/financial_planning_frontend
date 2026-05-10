/**
 * Panels Manager - Handles tools and servers panels
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;

    /**
     * PanelsManager constructor
     * @param {object} elements - DOM elements
     */
    function PanelsManager(elements) {
        this.toolsPanel = elements.toolsPanel;
        this.toolsPanelContent = elements.toolsPanelContent;
        this.toolsPanelClose = elements.toolsPanelClose;
        this.serversPanel = elements.serversPanel;
        this.serversPanelContent = elements.serversPanelContent;
        this.serversPanelClose = elements.serversPanelClose;
        
        this.gatewayLoadingStates = {};
        this.onGatewayToggle = null;
        this.getGatewaysList = function() { return []; };
        
        this.bindEvents();
    }

    /**
     * Bind event listeners
     */
    PanelsManager.prototype.bindEvents = function() {
        var self = this;
        
        if (this.toolsPanelClose) {
            this.toolsPanelClose.addEventListener('click', function() {
                self.hideToolsPanel();
            });
        }
        
        if (this.toolsPanel) {
            this.toolsPanel.addEventListener('click', function(e) {
                if (e.target === self.toolsPanel) {
                    self.hideToolsPanel();
                }
            });
        }
        
        if (this.serversPanelClose) {
            this.serversPanelClose.addEventListener('click', function() {
                self.hideServersPanel();
            });
        }
        
        if (this.serversPanel) {
            this.serversPanel.addEventListener('click', function(e) {
                if (e.target === self.serversPanel) {
                    self.hideServersPanel();
                }
            });
        }
    };

    /**
     * Set gateway toggle callback
     */
    PanelsManager.prototype.setGatewayToggleCallback = function(callback) {
        this.onGatewayToggle = callback;
    };

    /**
     * Set gateways list getter
     */
    PanelsManager.prototype.setGatewaysListGetter = function(getter) {
        this.getGatewaysList = getter;
    };

    /**
     * Show tools panel
     */
    PanelsManager.prototype.showToolsPanel = function() {
        var tools = window.MCPService ? window.MCPService.getAllTools() : [];
        
        if (tools.length === 0) {
            this.toolsPanelContent.innerHTML = '<p class="no-tools">No tools available. Connect to MCP servers first.</p>';
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
            this.toolsPanelContent.innerHTML = html;
        }
        
        this.toolsPanel.classList.remove('hidden');
    };

    /**
     * Hide tools panel
     */
    PanelsManager.prototype.hideToolsPanel = function() {
        this.toolsPanel.classList.add('hidden');
    };

    /**
     * Show servers panel
     */
    PanelsManager.prototype.showServersPanel = function() {
        var self = this;
        var gateways = this.getGatewaysList();
        
        if (gateways.length === 0) {
            this.serversPanelContent.innerHTML = '<p>No MCP servers available.</p>';
        } else {
            var html = '<div class="mcp-servers-section">';
            gateways.forEach(function(gateway) {
                var gatewayUrl = gateway.mcpUrl || gateway.url;
                var isConnected = window.MCPService && window.MCPService.isConnected(gatewayUrl);
                var isLoading = self.gatewayLoadingStates[gatewayUrl];
                var loadingStep = isLoading ? self.gatewayLoadingStates[gatewayUrl] : null;
                var statusClass = isConnected ? 'connected' : (isLoading ? 'loading' : '');
                var statusIcon = isConnected ? '✅' : (isLoading ? '' : '○');
                var toolCount = 0;
                
                if (isConnected && window.MCPService) {
                    var connection = window.MCPService.connectedGateways.get(gatewayUrl);
                    toolCount = connection ? connection.tools.length : 0;
                }
                
                var loadingSpinner = isLoading ? '<div class="gateway-loading-spinner"><div class="spinner-ring"></div></div>' : '';
                
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
            this.serversPanelContent.innerHTML = html;
            
            // Add click handlers
            var cards = this.serversPanelContent.querySelectorAll('.mcp-server-card');
            cards.forEach(function(card) {
                card.addEventListener('click', function() {
                    if (card.classList.contains('loading')) return;
                    var url = card.getAttribute('data-gateway-url');
                    if (self.onGatewayToggle) {
                        self.onGatewayToggle(url);
                    }
                });
            });
        }
        
        this.serversPanel.classList.remove('hidden');
    };

    /**
     * Hide servers panel
     */
    PanelsManager.prototype.hideServersPanel = function() {
        this.serversPanel.classList.add('hidden');
    };

    /**
     * Set gateway loading state
     */
    PanelsManager.prototype.setGatewayLoadingState = function(gatewayUrl, step) {
        if (step) {
            this.gatewayLoadingStates[gatewayUrl] = step;
        } else {
            delete this.gatewayLoadingStates[gatewayUrl];
        }
        
        // Update UI if servers panel is open
        if (!this.serversPanel.classList.contains('hidden')) {
            this.showServersPanel();
        }
    };

    /**
     * Refresh servers list
     */
    PanelsManager.prototype.refreshServersList = function() {
        if (!this.serversPanel.classList.contains('hidden')) {
            this.showServersPanel();
        }
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.PanelsManager = PanelsManager;

})();
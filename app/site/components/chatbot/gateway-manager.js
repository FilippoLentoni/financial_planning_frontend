/**
 * Gateway Manager - Handles MCP gateway connections
 */

(function() {
    'use strict';

    /**
     * GatewayManager constructor
     * @param {object} options - Configuration options
     */
    function GatewayManager(options) {
        options = options || {};
        this.getAccessToken = options.getAccessToken || function() { return null; };
        this.getIdToken = options.getIdToken || function() { return null; };
        this.getGatewaysList = options.getGatewaysList || function() { return []; };
        
        this.onStatusUpdate = options.onStatusUpdate || function() {};
        this.onLoadingStateChange = options.onLoadingStateChange || function() {};
        this.onConnectionChange = options.onConnectionChange || function() {};
        this.onError = options.onError || function() {};
    }

    /**
     * Toggle gateway connection
     */
    GatewayManager.prototype.toggleConnection = function(gatewayUrl) {
        var self = this;
        var accessToken = this.getAccessToken();
        
        if (!accessToken) {
            this.onError('Not authenticated. Please login first.');
            return;
        }
        
        if (window.MCPService.isConnected(gatewayUrl)) {
            window.MCPService.disconnect(gatewayUrl);
            this.onConnectionChange();
            return;
        }
        
        // Find the gateway object
        var gateways = this.getGatewaysList();
        var gateway = gateways.find(function(g) {
            return g.mcpUrl === gatewayUrl || g.url === gatewayUrl;
        });
        
        if (!gateway) {
            this.onError('Gateway not found');
            return;
        }
        
        // Check if gateway requires its own OAuth
        if (gateway.authDiscoveryUrl && gateway.clientId) {
            this.connectWithGatewayAuth(gateway, gatewayUrl);
        } else {
            this.connectWithStandardAuth(gatewayUrl, accessToken);
        }
    };

    /**
     * Connect with gateway-specific OAuth
     */
    GatewayManager.prototype.connectWithGatewayAuth = function(gateway, gatewayUrl) {
        var self = this;
        
        this.onStatusUpdate('connecting', 'Authenticating to gateway...');
        this.onLoadingStateChange(gatewayUrl, 'oauth_start');
        
        var progressCallback = function(step, message) {
            self.onLoadingStateChange(gatewayUrl, step);
            if (step === 'oauth_popup') {
                self.onStatusUpdate('connecting', 'Please sign in via popup...');
            } else if (step === 'exchanging_token') {
                self.onStatusUpdate('connecting', 'Exchanging token...');
            } else if (step === 'connecting') {
                self.onStatusUpdate('connecting', 'Connecting to gateway...');
            } else if (step === 'listing_tools') {
                self.onStatusUpdate('connecting', 'Loading tools...');
            }
        };
        
        window.MCPService.connectWithGatewayAuth(gateway, progressCallback)
            .then(function(tools) {
                console.log('[GatewayManager] Connected to gateway with OAuth, tools:', tools);
                self.onLoadingStateChange(gatewayUrl, null);
                self.onConnectionChange();
                self.updateToolSpecs();
            })
            .catch(function(error) {
                console.error('[GatewayManager] Failed to connect with OAuth:', error);
                self.onLoadingStateChange(gatewayUrl, null);
                self.onStatusUpdate('error', 'Connection failed');
                self.onError('Failed to connect: ' + error.message);
            });
    };

    /**
     * Connect with standard token authentication
     */
    GatewayManager.prototype.connectWithStandardAuth = function(gatewayUrl, accessToken) {
        var self = this;
        
        this.onStatusUpdate('connecting', 'Connecting to server...');
        this.onLoadingStateChange(gatewayUrl, 'connecting');
        
        window.MCPService.connect(gatewayUrl, accessToken)
            .then(function() {
                self.onLoadingStateChange(gatewayUrl, 'listing_tools');
                return window.MCPService.listTools(gatewayUrl, accessToken);
            })
            .then(function(tools) {
                self.onLoadingStateChange(gatewayUrl, 'finalizing');
                return new Promise(function(resolve) {
                    setTimeout(function() { resolve(tools); }, 300);
                });
            })
            .then(function(tools) {
                console.log('[GatewayManager] Connected to gateway, tools:', tools);
                self.onLoadingStateChange(gatewayUrl, null);
                self.onConnectionChange();
                self.updateToolSpecs();
            })
            .catch(function(error) {
                console.error('[GatewayManager] Failed to connect:', error);
                self.onLoadingStateChange(gatewayUrl, null);
                self.onStatusUpdate('error', 'Connection failed');
                self.onError('Failed to connect to server: ' + error.message);
            });
    };

    /**
     * Auto-discover gateways and connect to accessible ones
     */
    GatewayManager.prototype.autoDiscoverGateways = function() {
        var self = this;
        var accessToken = this.getAccessToken();
        var gateways = this.getGatewaysList();
        
        if (!accessToken || gateways.length === 0) {
            return Promise.resolve({ accessible: [], inaccessible: [] });
        }
        
        this.onStatusUpdate('connecting', 'Discovering accessible servers...');
        
        return window.MCPService.autoDiscoverGateways(gateways, accessToken)
            .then(function(results) {
                console.log('[GatewayManager] Auto-discover results:', results);
                
                self.onConnectionChange();
                self.updateToolSpecs();
                
                if (results.accessible.length > 0) {
                    console.log('[GatewayManager] Connected to ' + results.accessible.length + ' gateway(s)');
                }
                
                if (results.inaccessible.length > 0) {
                    console.log('[GatewayManager] ' + results.inaccessible.length + ' gateway(s) not accessible');
                }
                
                return results;
            })
            .catch(function(error) {
                console.error('[GatewayManager] Auto-discover failed:', error);
                self.onStatusUpdate('error', 'Discovery failed');
                return { accessible: [], inaccessible: [] };
            });
    };

    /**
     * Update tool specs in ChatService
     */
    GatewayManager.prototype.updateToolSpecs = function() {
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
        
        if (window.ChatService) {
            window.ChatService.setToolSpecs(toolSpecs);
        }
        if (window.BedrockService) {
            window.BedrockService.setToolSpecs(toolSpecs);
        }
    };

    /**
     * Get connection status
     */
    GatewayManager.prototype.getConnectionStatus = function() {
        var connectedCount = window.MCPService ? window.MCPService.getConnectedGatewayUrls().length : 0;
        var toolCount = window.MCPService ? window.MCPService.getAllTools().length : 0;
        
        if (connectedCount > 0) {
            return {
                status: 'connected',
                text: connectedCount + ' server(s) connected • ' + toolCount + ' tool(s)'
            };
        }
        
        return {
            status: 'disconnected',
            text: 'Not connected'
        };
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.GatewayManager = GatewayManager;

})();
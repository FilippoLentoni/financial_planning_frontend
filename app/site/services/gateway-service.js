/**
 * Gateway Service Module
 * 
 * Manages MCP gateway discovery, connections, and tool management.
 * Each gateway has its own OAuth configuration (authDiscoveryUrl, clientId).
 */

(function() {
    'use strict';

    /**
     * GatewayService - Manages gateway discovery and connections
     */
    function GatewayService() {
        this.gateways = [];
        this.apiEndpoint = null;
        // Store access tokens per gateway (from gateway-specific OAuth)
        this.gatewayTokens = new Map();
    }

    /**
     * Configure the gateway service
     * @param {string} apiEndpoint - Base API endpoint URL
     */
    GatewayService.prototype.configure = function(apiEndpoint) {
        this.apiEndpoint = apiEndpoint;
    };

    /**
     * Get the API endpoint
     * @returns {string}
     */
    GatewayService.prototype.getApiEndpoint = function() {
        // Check if configured via configure()
        if (this.apiEndpoint) {
            return this.apiEndpoint;
        }
        // Check APP_CONFIG (set by index.html from RAW_CONFIG/DEV_CONFIG merge)
        if (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) {
            return window.APP_CONFIG.apiBaseUrl;
        }
        // Check DEV_CONFIG for local development fallback
        if (window.DEV_CONFIG && window.DEV_CONFIG.apiBaseUrl) {
            return window.DEV_CONFIG.apiBaseUrl;
        }
        return '';
    };

    /**
     * Get all loaded gateways
     * @returns {Array}
     */
    GatewayService.prototype.getGateways = function() {
        return this.gateways;
    };

    /**
     * Get mock gateways for development/fallback (only if API fails)
     * @returns {Array}
     */
    GatewayService.prototype.getMockGateways = function() {
        // Default mock gateways (only used if API fails)
        return [
            {
                id: 'portfolio-planning',
                name: 'Portfolio Planning',
                description: 'Portfolio optimization, what-if analysis, and weekly review tools',
                mcpUrl: 'https://example-gateway.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp'
            }
        ];
    };

    /**
     * Fetch gateways from API (uses SigV4 signed request)
     * Returns gateway config including OAuth details (authDiscoveryUrl, clientId)
     * @returns {Promise<Array>} Promise resolving to gateways array
     */
    GatewayService.prototype.fetchGateways = function() {
        var self = this;
        var apiEndpoint = this.getApiEndpoint();
        
        if (!apiEndpoint) {
            console.warn('[GatewayService] No API endpoint configured, using mock gateways');
            self.gateways = self.getMockGateways();
            return Promise.resolve(self.gateways);
        }
        
        // Use /gateways/iam endpoint which requires IAM (SigV4) authentication
        // This uses AWS credentials from the Cognito Identity Pool
        // Strip trailing slash to avoid double-slash in URL (CDK RestApi.url includes trailing slash)
        var gatewaysUrl = apiEndpoint.replace(/\/+$/, '') + '/gateways/iam';
        console.log('[GatewayService] Fetching gateways from IAM endpoint:', gatewaysUrl);
        
        // Check if BedrockService has AWS credentials
        if (!window.BedrockService || !window.BedrockService.credentials) {
            console.warn('[GatewayService] No AWS credentials available, using mock gateways');
            self.gateways = self.getMockGateways();
            return Promise.resolve(self.gateways);
        }
        
        // Make SigV4-signed request using BedrockService's credentials
        return self.makeSignedRequest(gatewaysUrl)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to fetch gateways: ' + response.status);
                }
                return response.json();
            })
            .then(function(data) {
                self.gateways = data.gateways || [];
                console.log('[GatewayService] Loaded', self.gateways.length, 'gateways from API');
                console.log('[GatewayService] Gateway data:', JSON.stringify(self.gateways, null, 2));
                
                // Note: MCPService uses direct PKCE OAuth flow with Cognito - no API base URL needed
                // The gateway's authDiscoveryUrl and clientId are used directly for OAuth
                
                return self.gateways;
            })
            .catch(function(error) {
                console.error('[GatewayService] Error fetching gateways:', error);
                // Fall back to mock gateways only on error
                self.gateways = self.getMockGateways();
                return self.gateways;
            });
    };

    /**
     * Make a SigV4-signed request to an API Gateway endpoint
     * Uses AWS credentials from BedrockService (Cognito Identity Pool)
     * @param {string} url - The URL to request
     * @returns {Promise<Response>}
     */
    GatewayService.prototype.makeSignedRequest = function(url) {
        var credentials = window.BedrockService.credentials;
        var region = window.BedrockService.region || 'us-east-1';
        
        if (!credentials) {
            return Promise.reject(new Error('No AWS credentials available'));
        }
        
        // Parse the URL
        var urlObj = new URL(url);
        var host = urlObj.host;
        var path = urlObj.pathname;
        var apiRegion = host.match(/^[^.]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
        region = (apiRegion && apiRegion[1]) || region;
        
        // Create the signing parameters
        var method = 'GET';
        var service = 'execute-api';
        var now = new Date();
        var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        var dateStamp = amzDate.substring(0, 8);
        
        // Create canonical request
        var canonicalHeaders = 'host:' + host + '\n' + 'x-amz-date:' + amzDate + '\n';
        var signedHeaders = 'host;x-amz-date';
        
        // Add security token header if present
        if (credentials.sessionToken) {
            canonicalHeaders += 'x-amz-security-token:' + credentials.sessionToken + '\n';
            signedHeaders += ';x-amz-security-token';
        }
        
        var payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // SHA256 of empty string
        
        var canonicalRequest = method + '\n' + 
            path + '\n' + 
            '' + '\n' + // query string (empty)
            canonicalHeaders + '\n' +
            signedHeaders + '\n' +
            payloadHash;
        
        // Create string to sign
        var algorithm = 'AWS4-HMAC-SHA256';
        var credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
        
        return this.sha256(canonicalRequest).then(function(canonicalRequestHash) {
            var stringToSign = algorithm + '\n' +
                amzDate + '\n' +
                credentialScope + '\n' +
                canonicalRequestHash;
            
            // Calculate signature
            return window.GatewayService.getSignatureKey(credentials.secretAccessKey, dateStamp, region, service)
                .then(function(signingKey) {
                    return window.GatewayService.hmacSha256(signingKey, stringToSign);
                })
                .then(function(signature) {
                    var authorizationHeader = algorithm + ' ' +
                        'Credential=' + credentials.accessKeyId + '/' + credentialScope + ', ' +
                        'SignedHeaders=' + signedHeaders + ', ' +
                        'Signature=' + signature;
                    
                    var headers = {
                        'Host': host,
                        'X-Amz-Date': amzDate,
                        'Authorization': authorizationHeader
                    };
                    
                    if (credentials.sessionToken) {
                        headers['X-Amz-Security-Token'] = credentials.sessionToken;
                    }
                    
                    return fetch(url, {
                        method: method,
                        headers: headers
                    });
                });
        });
    };

    /**
     * SHA256 hash
     */
    GatewayService.prototype.sha256 = function(message) {
        var encoder = new TextEncoder();
        var data = encoder.encode(message);
        return crypto.subtle.digest('SHA-256', data).then(function(hash) {
            return Array.from(new Uint8Array(hash))
                .map(function(b) { return b.toString(16).padStart(2, '0'); })
                .join('');
        });
    };

    /**
     * HMAC-SHA256
     */
    GatewayService.prototype.hmacSha256 = function(key, message) {
        var encoder = new TextEncoder();
        var data = encoder.encode(message);
        
        // If key is a string, encode it
        var keyData = typeof key === 'string' ? encoder.encode(key) : key;
        
        return crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        ).then(function(cryptoKey) {
            return crypto.subtle.sign('HMAC', cryptoKey, data);
        }).then(function(signature) {
            return Array.from(new Uint8Array(signature))
                .map(function(b) { return b.toString(16).padStart(2, '0'); })
                .join('');
        });
    };

    /**
     * HMAC-SHA256 returning raw bytes
     */
    GatewayService.prototype.hmacSha256Raw = function(key, message) {
        var encoder = new TextEncoder();
        var data = encoder.encode(message);
        
        // If key is a string, encode it
        var keyData = typeof key === 'string' ? encoder.encode(key) : key;
        
        return crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        ).then(function(cryptoKey) {
            return crypto.subtle.sign('HMAC', cryptoKey, data);
        }).then(function(signature) {
            return new Uint8Array(signature);
        });
    };

    /**
     * Get AWS SigV4 signing key
     */
    GatewayService.prototype.getSignatureKey = function(secretKey, dateStamp, region, service) {
        var self = this;
        var kSecret = new TextEncoder().encode('AWS4' + secretKey);
        
        return self.hmacSha256Raw(kSecret, dateStamp)
            .then(function(kDate) {
                return self.hmacSha256Raw(kDate, region);
            })
            .then(function(kRegion) {
                return self.hmacSha256Raw(kRegion, service);
            })
            .then(function(kService) {
                return self.hmacSha256Raw(kService, 'aws4_request');
            });
    };

    /**
     * Build the MCP URL from gateway ID and region
     * @param {string} gatewayId - The gateway ID
     * @param {string} region - AWS region (default: us-east-1)
     * @returns {string} The MCP URL
     */
    GatewayService.prototype.buildMcpUrl = function(gatewayId, region) {
        region = region || 'us-east-1';
        return 'https://' + gatewayId + '.gateway.bedrock-agentcore.' + region + '.amazonaws.com/mcp';
    };

    /**
     * Connect to a gateway using OAuth Bearer token authentication
     * Uses the gateway's mcpUrl directly and AuthService's access token
     * 
     * @param {Object} gateway - Gateway object with mcpUrl, authDiscoveryUrl, clientId
     * @param {string} accessToken - OAuth access token for authentication
     * @returns {Promise}
     */
    GatewayService.prototype.connect = function(gateway, accessToken) {
        // Use the gateway's mcpUrl directly from config
        var gatewayUrl = gateway.mcpUrl || gateway.url;
        
        // If no direct URL, build it from gatewayId
        if (!gatewayUrl) {
            var gatewayId = gateway.gatewayId || gateway.gateway_id;
            var region = gateway.region || 'us-east-1';
            gatewayUrl = gatewayId ? this.buildMcpUrl(gatewayId, region) : null;
        }
        
        if (!gatewayUrl) {
            return Promise.reject(new Error('No MCP URL available for gateway: ' + gateway.name));
        }
        
        if (!window.MCPService) {
            return Promise.reject(new Error('MCPService not available'));
        }
        
        if (!accessToken) {
            return Promise.reject(new Error('No access token available for MCP connection'));
        }
        
        console.log('[GatewayService] Connecting to:', gateway.name, 'url:', gatewayUrl);
        console.log('[GatewayService] Gateway auth config:', {
            authDiscoveryUrl: gateway.authDiscoveryUrl,
            clientId: gateway.clientId
        });
        
        return window.MCPService.connect(gatewayUrl, accessToken)
            .then(function() {
                return window.MCPService.listTools(gatewayUrl, accessToken);
            })
            .then(function(tools) {
                console.log('[GatewayService] Connected to', gateway.name, 'with', tools.length, 'tools');
                return tools;
            });
    };

    /**
     * Get the MCP URL for a gateway
     * @param {Object} gateway - Gateway object
     * @returns {string} The MCP URL
     */
    GatewayService.prototype.getGatewayUrl = function(gateway) {
        // Use mcpUrl directly from config if available
        if (gateway.mcpUrl) {
            return gateway.mcpUrl;
        }
        
        var gatewayId = gateway.gatewayId || gateway.gateway_id;
        var region = gateway.region || 'us-east-1';
        return gatewayId ? this.buildMcpUrl(gatewayId, region) : (gateway.url || '');
    };

    /**
     * Disconnect from a gateway
     * @param {Object} gateway - Gateway object
     */
    GatewayService.prototype.disconnect = function(gateway) {
        var gatewayUrl = this.getGatewayUrl(gateway);
        
        if (window.MCPService) {
            window.MCPService.disconnect(gatewayUrl);
            console.log('[GatewayService] Disconnected from:', gateway.name);
        }
    };

    /**
     * Check if connected to a gateway
     * @param {Object} gateway - Gateway object
     * @returns {boolean}
     */
    GatewayService.prototype.isConnected = function(gateway) {
        var gatewayUrl = this.getGatewayUrl(gateway);
        return window.MCPService ? window.MCPService.isConnected(gatewayUrl) : false;
    };

    /**
     * Get all connected gateway URLs
     * @returns {Array<string>}
     */
    GatewayService.prototype.getConnectedUrls = function() {
        return window.MCPService ? window.MCPService.getConnectedGatewayUrls() : [];
    };

    /**
     * Get all available tools from connected gateways
     * @returns {Array}
     */
    GatewayService.prototype.getAllTools = function() {
        return window.MCPService ? window.MCPService.getAllTools() : [];
    };

    /**
     * Get tool count for a specific gateway
     * @param {Object} gateway - Gateway object
     * @returns {number}
     */
    GatewayService.prototype.getToolCount = function(gateway) {
        var gatewayUrl = this.getGatewayUrl(gateway);
        
        if (!window.MCPService || !window.MCPService.isConnected(gatewayUrl)) {
            return 0;
        }
        
        var connection = window.MCPService.connectedGateways.get(gatewayUrl);
        return connection ? connection.tools.length : 0;
    };

    /**
     * Update ChatService with tool specs from all connected gateways
     */
    GatewayService.prototype.syncToolsWithChatService = function() {
        var allTools = this.getAllTools();
        
        if (!window.ChatService) {
            console.warn('[GatewayService] ChatService not available');
            return;
        }
        
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
        console.log('[GatewayService] Synced', toolSpecs.length, 'tools with ChatService');
    };

    // Export as singleton
    window.GatewayService = new GatewayService();

})();

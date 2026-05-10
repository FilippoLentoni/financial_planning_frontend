/**
 * MCP Service - Handles communication with MCP gateways
 * 
 * Security: Each gateway has its own Cognito User Pool.
 * Users authenticate to each gateway's user pool via the configured identity provider.
 * OAuth ACCESS tokens from the gateway's user pool are required.
 * (MCP gateways use access tokens for Bearer auth, matching reference impl)
 * 
 * Token exchange is done client-side using PKCE - no backend needed.
 * Gateway User Pools use generateSecret: false to support PKCE.
 */

(function() {
    'use strict';

    /**
     * MCP Service class for managing MCP gateway connections
     */
    function MCPService() {
        // Map of gatewayUrl -> { tools: [], connected: boolean }
        this.connectedGateways = new Map();
        // Map of gatewayUrl -> token data (gateway-specific tokens, uses accessToken for auth)
        this.gatewayTokens = new Map();
        // Active abort controllers for cancellation
        this.activeAbortControllers = new Set();
        // OAuth state storage for OAuth flows with PKCE
        this.pendingOAuthFlows = new Map();
        // Progress callbacks for auth/connection flows
        this.progressCallbacks = new Map();
    }

    /**
     * Set a progress callback for a gateway's auth/connection flow
     * @param {string} gatewayUrl - Gateway URL
     * @param {Function} callback - Function(step, message) to call on progress updates
     */
    MCPService.prototype.setProgressCallback = function(gatewayUrl, callback) {
        if (callback) {
            this.progressCallbacks.set(gatewayUrl, callback);
        } else {
            this.progressCallbacks.delete(gatewayUrl);
        }
    };

    /**
     * Emit progress update for a gateway
     * @param {string} gatewayUrl - Gateway URL
     * @param {string} step - Current step (oauth_start, oauth_popup, exchanging_token, connecting, listing_tools, complete, error)
     * @param {string} [message] - Optional message
     */
    MCPService.prototype.emitProgress = function(gatewayUrl, step, message) {
        var callback = this.progressCallbacks.get(gatewayUrl);
        if (callback) {
            try {
                callback(step, message);
            } catch (e) {
                console.error('[MCP] Progress callback error:', e);
            }
        }
        console.log('[MCP] Progress:', gatewayUrl, step, message || '');
    };

    /**
     * Abort all active requests
     */
    MCPService.prototype.abortAll = function() {
        console.log('[MCP] Aborting ' + this.activeAbortControllers.size + ' active requests');
        this.activeAbortControllers.forEach(function(controller) {
            try {
                controller.abort();
            } catch (err) {
                console.error('[MCP] Error aborting controller:', err);
            }
        });
        this.activeAbortControllers.clear();
    };

    /**
     * Create and register an AbortController
     * @returns {AbortController}
     */
    MCPService.prototype.createAbortController = function() {
        var controller = new AbortController();
        this.activeAbortControllers.add(controller);
        return controller;
    };

    /**
     * Remove an AbortController from tracking
     * @param {AbortController} controller
     */
    MCPService.prototype.removeAbortController = function(controller) {
        this.activeAbortControllers.delete(controller);
    };

    /**
     * Generate a random string for OAuth state
     */
    MCPService.prototype.generateRandomString = function(length) {
        var array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, function(byte) {
            return ('0' + byte.toString(16)).slice(-2);
        }).join('');
    };

    /**
     * Generate PKCE code verifier (43-128 characters, base64url)
     * @returns {string}
     */
    MCPService.prototype.generateCodeVerifier = function() {
        var array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return this.base64UrlEncode(array);
    };

    /**
     * Generate PKCE code challenge from verifier using SHA-256
     * @param {string} verifier - The code verifier
     * @returns {Promise<string>} Code challenge (base64url encoded)
     */
    MCPService.prototype.generateCodeChallenge = function(verifier) {
        var self = this;
        var encoder = new TextEncoder();
        var data = encoder.encode(verifier);
        return crypto.subtle.digest('SHA-256', data).then(function(hash) {
            return self.base64UrlEncode(new Uint8Array(hash));
        });
    };

    /**
     * Base64 URL encode (RFC 4648)
     * @param {Uint8Array} buffer - Buffer to encode
     * @returns {string} Base64 URL encoded string
     */
    MCPService.prototype.base64UrlEncode = function(buffer) {
        var binary = '';
        for (var i = 0; i < buffer.length; i++) {
            binary += String.fromCharCode(buffer[i]);
        }
        var base64 = btoa(binary);
        // Convert to base64url: replace + with -, / with _, remove =
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    /**
     * Start OAuth flow to get gateway-specific tokens
     * Opens a popup window to authenticate with the gateway's user pool via the configured identity provider
     * 
     * @param {Object} gateway - Gateway config with authDiscoveryUrl and clientId
     * @returns {Promise<string>} - Access token for the gateway (used for Bearer auth)
     */
    MCPService.prototype.getGatewayToken = function(gateway) {
        var self = this;
        var gatewayUrl = gateway.mcpUrl;
        
        // Check if we already have a valid token
        if (this.gatewayTokens.has(gatewayUrl)) {
            var tokenData = this.gatewayTokens.get(gatewayUrl);
            if (tokenData.expiresAt > Date.now()) {
                // Use access token for MCP gateway authentication
                return Promise.resolve(tokenData.accessToken);
            }
        }
        
        // Need to get a new token via OAuth
        return this.performGatewayOAuth(gateway);
    };

    /**
     * Perform OAuth flow to get tokens from gateway's user pool
     * Uses Authorization Code flow WITH PKCE for public SPA clients.
     * Token exchange is done client-side directly with Cognito.
     * 
     * @param {Object} gateway - Gateway config
     * @param {Object} [options] - Optional settings for batch auth
     * @param {Object} [options.discovery] - Pre-fetched OIDC discovery (skip fetch)
     * @param {Object} [options.existingPopup] - Reuse this popup instead of opening new
     * @param {number} [options.timeout] - Custom timeout in ms (default: 120000)
     * @returns {Promise<string|Object>} - Access token, or {token, popup} if existingPopup provided
     */
    MCPService.prototype.performGatewayOAuth = function(gateway, options) {
        var self = this;
        var gatewayUrl = gateway.mcpUrl;
        options = options || {};
        
        if (!gateway.authDiscoveryUrl || !gateway.clientId) {
            return Promise.reject(new Error('Gateway missing authDiscoveryUrl or clientId'));
        }
        
        self.emitProgress(gatewayUrl, 'oauth_start', 'Starting authentication...');
        
        // Use pre-fetched discovery or fetch it
        var discoveryPromise = options.discovery 
            ? Promise.resolve(options.discovery)
            : fetch(gateway.authDiscoveryUrl)
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('Failed to fetch OIDC discovery: ' + response.status);
                    }
                    return response.json();
                });
        
        return discoveryPromise
            .then(function(discovery) {
                // Use the authorization endpoint to start OAuth flow
                var authEndpoint = discovery.authorization_endpoint;
                
                // Generate state for CSRF protection
                var state = self.generateRandomString(32);
                
                // Generate PKCE code verifier and challenge
                var codeVerifier = self.generateCodeVerifier();
                
                return self.generateCodeChallenge(codeVerifier).then(function(codeChallenge) {
                    // Store the pending flow with code verifier for PKCE
                    self.pendingOAuthFlows.set(state, {
                        gateway: gateway,
                        authDiscoveryUrl: gateway.authDiscoveryUrl,
                        tokenEndpoint: discovery.token_endpoint,
                        codeVerifier: codeVerifier
                    });
                    
                    // Build authorization URL with PKCE parameters
                    var redirectUri = window.location.origin + '/callback';
                    var params = new URLSearchParams({
                        response_type: 'code',
                        client_id: gateway.clientId,
                        redirect_uri: redirectUri,
                        scope: 'openid',
                        state: state,
                        code_challenge: codeChallenge,
                        code_challenge_method: 'S256'
                    });
                    var authUrl = authEndpoint + '?' + params.toString();
                    
                    console.log('[MCP] Starting gateway OAuth flow with PKCE for:', gateway.name);
                    console.log('[MCP] Auth URL:', authUrl);
                    
                    self.emitProgress(gatewayUrl, 'oauth_popup', 'Please sign in via popup window...');
                    
                    // Use existing popup (batch auth) or open new one (single gateway)
                    if (options.existingPopup !== undefined) {
                        return self.openOAuthPopupWithReuse(authUrl, state, options.existingPopup, options.timeout);
                    } else {
                        return self.openOAuthPopup(authUrl, state);
                    }
                });
            });
    };

    /**
     * Open OAuth popup and wait for callback
     * Polls the popup URL for the authorization code (same-origin only)
     * Falls back to postMessage from callback page
     * 
     * @param {string} authUrl - Authorization URL
     * @param {string} state - OAuth state
     * @returns {Promise<string>} - Access token (used for Bearer auth)
     */
    MCPService.prototype.openOAuthPopup = function(authUrl, state) {
        var self = this;
        
        return new Promise(function(resolve, reject) {
            var width = 500;
            var height = 600;
            var left = (window.screen.width - width) / 2;
            var top = (window.screen.height - height) / 2;
            
            var popup = window.open(
                authUrl,
                'gateway-oauth',
                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top
            );
            
            if (!popup) {
                reject(new Error('Popup blocked. Please allow popups for this site.'));
                return;
            }
            
            // Store the resolve/reject for the callback handler
            var flowData = self.pendingOAuthFlows.get(state);
            if (flowData) {
                flowData.resolve = resolve;
                flowData.reject = reject;
                flowData.popup = popup;
            }
            
            var checkInterval = null;
            var messageHandler = null;
            var resolved = false;
            
            // Handle postMessage from callback page
            messageHandler = function(event) {
                if (event.origin !== window.location.origin) return;
                if (!event.data || event.data.type !== 'gateway-oauth-callback') return;
                
                console.log('[MCP] Received OAuth callback via postMessage');
                
                if (resolved) return;
                resolved = true;
                
                window.removeEventListener('message', messageHandler);
                if (checkInterval) clearInterval(checkInterval);
                
                if (event.data.error) {
                    self.pendingOAuthFlows.delete(state);
                    if (popup && !popup.closed) popup.close();
                    reject(new Error(event.data.error_description || event.data.error));
                    return;
                }
                
                var code = event.data.code;
                var returnedState = event.data.state;
                
                if (returnedState !== state) {
                    self.pendingOAuthFlows.delete(state);
                    if (popup && !popup.closed) popup.close();
                    reject(new Error('OAuth state mismatch'));
                    return;
                }
                
                // Exchange code for token using PKCE
                self.handleOAuthCallback(code, state)
                    .then(function(token) {
                        if (popup && !popup.closed) popup.close();
                    })
                    .catch(function(error) {
                        if (popup && !popup.closed) popup.close();
                    });
            };
            
            window.addEventListener('message', messageHandler);
            
            // Poll for popup URL (works for same-origin redirects)
            checkInterval = setInterval(function() {
                if (resolved) {
                    clearInterval(checkInterval);
                    return;
                }
                
                if (popup.closed) {
                    clearInterval(checkInterval);
                    window.removeEventListener('message', messageHandler);
                    var flowData = self.pendingOAuthFlows.get(state);
                    if (flowData && flowData.reject && !resolved) {
                        self.pendingOAuthFlows.delete(state);
                        reject(new Error('OAuth popup closed by user'));
                    }
                    return;
                }
                
                // Try to read popup URL (only works for same-origin)
                try {
                    var popupUrl = popup.location.href;
                    if (popupUrl && popupUrl.indexOf(window.location.origin + '/callback') === 0) {
                        var urlParams = new URL(popupUrl).searchParams;
                        var code = urlParams.get('code');
                        var returnedState = urlParams.get('state');
                        var error = urlParams.get('error');
                        
                        if (error) {
                            resolved = true;
                            clearInterval(checkInterval);
                            window.removeEventListener('message', messageHandler);
                            self.pendingOAuthFlows.delete(state);
                            popup.close();
                            reject(new Error(urlParams.get('error_description') || error));
                            return;
                        }
                        
                        if (code && returnedState) {
                            if (returnedState !== state) {
                                resolved = true;
                                clearInterval(checkInterval);
                                window.removeEventListener('message', messageHandler);
                                self.pendingOAuthFlows.delete(state);
                                popup.close();
                                reject(new Error('OAuth state mismatch'));
                                return;
                            }
                            
                            resolved = true;
                            clearInterval(checkInterval);
                            window.removeEventListener('message', messageHandler);
                            
                            console.log('[MCP] Captured OAuth callback from popup URL');
                            
                            // Exchange code for token using PKCE
                            self.handleOAuthCallback(code, state)
                                .then(function(token) {
                                    popup.close();
                                })
                                .catch(function(error) {
                                    popup.close();
                                });
                        }
                    }
                } catch (error) {
                    // Cross-origin - can't read URL, wait for postMessage
                }
            }, 200);
            
            // Set timeout for OAuth flow
            setTimeout(function() {
                if (self.pendingOAuthFlows.has(state) && !resolved) {
                    resolved = true;
                    clearInterval(checkInterval);
                    window.removeEventListener('message', messageHandler);
                    self.pendingOAuthFlows.delete(state);
                    if (popup && !popup.closed) {
                        popup.close();
                    }
                    reject(new Error('OAuth flow timed out'));
                }
            }, 120000); // 2 minute timeout
        });
    };

    /**
     * Handle OAuth callback (called from callback page)
     * Exchanges the code for tokens directly with Cognito using PKCE.
     * No backend endpoint needed.
     * 
     * @param {string} code - Authorization code
     * @param {string} state - OAuth state
     * @param {Object} [options] - Optional settings
     * @param {boolean} [options.keepPopupOpen] - If true, don't close the popup (for batch auth)
     * @returns {Promise<string>} - Access token (used for Bearer auth to MCP gateways)
     */
    MCPService.prototype.handleOAuthCallback = function(code, state, options) {
        var self = this;
        options = options || {};
        
        var flowData = this.pendingOAuthFlows.get(state);
        if (!flowData) {
            return Promise.reject(new Error('Unknown OAuth state'));
        }
        
        var gateway = flowData.gateway;
        var tokenEndpoint = flowData.tokenEndpoint;
        var codeVerifier = flowData.codeVerifier;
        var resolve = flowData.resolve;
        var reject = flowData.reject;
        var popup = flowData.popup;
        
        // Remove pending flow
        this.pendingOAuthFlows.delete(state);
        
        // Close popup if still open (unless keepPopupOpen is set for batch auth)
        if (!options.keepPopupOpen && popup && !popup.closed) {
            popup.close();
        }
        
        // Validate we have the code verifier for PKCE
        if (!codeVerifier) {
            var error = new Error('Missing code verifier for PKCE flow');
            if (reject) reject(error);
            return Promise.reject(error);
        }
        
        // Exchange code for tokens directly with Cognito using PKCE
        var redirectUri = window.location.origin + '/callback';
        
        self.emitProgress(gateway.mcpUrl, 'exchanging_token', 'Exchanging authorization code...');
        
        console.log('[MCP] Exchanging code with PKCE directly with Cognito:', tokenEndpoint);
        
        // Build form data for token request (PKCE - no client secret needed)
        var params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('client_id', gateway.clientId);
        params.append('code_verifier', codeVerifier);
        
        return fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('Token exchange failed: ' + response.status + ' - ' + text);
                });
            }
            return response.json();
        })
        .then(function(tokens) {
            console.log('[MCP] Token exchange successful for gateway:', gateway.name);
            console.log('[MCP] Token types received - access_token:', !!tokens.access_token, 'id_token:', !!tokens.id_token);
            
            // Store the tokens - access token is used for MCP gateway Bearer auth
            var gatewayUrl = gateway.mcpUrl;
            var tokenData = {
                accessToken: tokens.access_token,
                idToken: tokens.id_token,
                refreshToken: tokens.refresh_token,
                expiresAt: Date.now() + (tokens.expires_in * 1000)
            };
            self.gatewayTokens.set(gatewayUrl, tokenData);
            
            // Persist to localStorage for auto-connect on page reload
            self._persistGatewayTokens();
            
            self.emitProgress(gatewayUrl, 'token_received', 'Token received');
            
            // Only resolve via flowData if NOT using keepPopupOpen
            // (batch auth handles its own resolution in openOAuthPopupWithReuse)
            if (!options.keepPopupOpen && resolve) {
                resolve(tokens.access_token);
            }
            
            return tokens.access_token;
        })
        .catch(function(error) {
            console.error('[MCP] Token exchange failed:', error);
            self.emitProgress(gateway.mcpUrl, 'error', error.message);
            // Only reject via flowData if NOT using keepPopupOpen
            if (!options.keepPopupOpen && reject) {
                reject(error);
            }
            throw error;
        });
    };

    /**
     * Connect to an MCP gateway and initialize the session
     * Uses Bearer token authentication from gateway's user pool
     * 
     * @param {string} gatewayUrl - The MCP gateway URL
     * @param {string} accessToken - The OAuth access token (used for Bearer auth)
     * @returns {Promise<Object>} - Connection result
     */
    MCPService.prototype.connect = function(gatewayUrl, accessToken) {
        var self = this;
        
        // If already connected, return existing connection
        if (this.connectedGateways.has(gatewayUrl)) {
            console.log('[MCP] Already connected to ' + gatewayUrl);
            return Promise.resolve(this.connectedGateways.get(gatewayUrl));
        }

        var controller = this.createAbortController();
        
        console.log('[MCP] Connecting to:', gatewayUrl);
        console.log('[MCP] Using access token (first 20 chars):', accessToken ? accessToken.substring(0, 20) + '...' : 'null');

        return fetch(gatewayUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {
                        name: 'Financial-Planning-Frontend',
                        version: '1.0.0'
                    }
                }
            }),
            signal: controller.signal
        })
        .then(function(response) {
            self.removeAbortController(controller);
            
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('MCP initialize failed: ' + response.status + ' - ' + text);
                });
            }
            return response.json();
        })
        .then(function(result) {
            console.log('[MCP] Initialize response:', result);
            
            // Store connection info
            self.connectedGateways.set(gatewayUrl, {
                sessionId: result.result ? result.result.sessionId : null,
                tools: [],
                connected: true
            });
            
            return result.result;
        })
        .catch(function(error) {
            self.removeAbortController(controller);
            
            if (error.name === 'AbortError') {
                console.log('[MCP] Connection aborted');
                throw new Error('Connection was aborted');
            }
            
            console.error('[MCP] Error connecting to gateway:', error);
            throw error;
        });
    };

    // ============================================================
    // SigV4-Authenticated Gateway Support
    // ============================================================

    /**
     * Make a SigV4-signed POST request to an MCP gateway.
     * Reuses BedrockService's SigV4 signing infrastructure with a custom service name.
     *
     * @param {string} url - The MCP endpoint URL
     * @param {Object} body - The JSON-RPC request body
     * @param {Object} gateway - Gateway config with sigv4Region and sigv4Service
     * @returns {Promise<Object>} - Parsed JSON response
     */
    MCPService.prototype.sigv4Fetch = function(url, body, gateway) {
        var self = this;
        var bedrockService = window.BedrockService;
        if (!bedrockService) {
            return Promise.reject(new Error('BedrockService not available for SigV4 signing'));
        }

        var idToken = window.AuthService ? window.AuthService.getIdToken() : null;
        if (!idToken) {
            return Promise.reject(new Error('No ID token available for SigV4 credentials'));
        }

        var sigRegion = gateway.sigv4Region || gateway.region || bedrockService.region || 'us-west-2';
        var sigService = gateway.sigv4Service || 'bedrock-agentcore';
        var bodyStr = JSON.stringify(body);
        var controller = self.createAbortController();

        return bedrockService.getCredentials(idToken)
            .then(function(credentials) {
                // Build headers for signing
                var urlObj = new URL(url);
                var headers = {
                    'Content-Type': 'application/json',
                    'host': urlObj.host,
                    'x-amz-date': '', // Will be set by signing
                };

                // SigV4 signing (same algorithm as BedrockService but with custom service)
                var now = new Date();
                var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
                var dateStamp = amzDate.substring(0, 8);

                headers['x-amz-date'] = amzDate;
                if (credentials.sessionToken) {
                    headers['x-amz-security-token'] = credentials.sessionToken;
                }

                // Canonical URI - URI-encode each path segment
                var rawPath = urlObj.pathname || '/';
                var canonicalPath = rawPath.split('/').map(function(segment) {
                    return bedrockService.uriEncode(segment, true);
                }).join('/');

                // Create canonical request
                var sortedHeaderKeys = Object.keys(headers).sort();
                var canonicalHeaders = sortedHeaderKeys.map(function(k) {
                    return k.toLowerCase() + ':' + headers[k].trim();
                }).join('\n') + '\n';
                var signedHeaders = sortedHeaderKeys.map(function(k) {
                    return k.toLowerCase();
                }).join(';');

                return bedrockService.sha256(bodyStr).then(function(payloadHash) {
                    var canonicalRequest = [
                        'POST',
                        canonicalPath,
                        '', // query string (empty for POST)
                        canonicalHeaders,
                        signedHeaders,
                        payloadHash
                    ].join('\n');

                    return bedrockService.sha256(canonicalRequest).then(function(canonicalRequestHash) {
                        var algorithm = 'AWS4-HMAC-SHA256';
                        var credentialScope = dateStamp + '/' + sigRegion + '/' + sigService + '/aws4_request';
                        var stringToSign = [
                            algorithm,
                            amzDate,
                            credentialScope,
                            canonicalRequestHash
                        ].join('\n');

                        return bedrockService.getSigningKey(credentials.secretAccessKey, dateStamp, sigRegion, sigService)
                            .then(function(signingKey) {
                                return bedrockService.hmacSha256(signingKey, stringToSign);
                            })
                            .then(function(signatureBuffer) {
                                var signature = Array.from(new Uint8Array(signatureBuffer))
                                    .map(function(b) { return b.toString(16).padStart(2, '0'); })
                                    .join('');

                                var authorizationHeader = algorithm + ' ' +
                                    'Credential=' + credentials.accessKeyId + '/' + credentialScope + ', ' +
                                    'SignedHeaders=' + signedHeaders + ', ' +
                                    'Signature=' + signature;

                                headers['Authorization'] = authorizationHeader;

                                // Make the request (remove 'host' header since fetch adds it automatically)
                                var fetchHeaders = {};
                                Object.keys(headers).forEach(function(k) {
                                    if (k.toLowerCase() !== 'host') {
                                        fetchHeaders[k] = headers[k];
                                    }
                                });

                                return fetch(url, {
                                    method: 'POST',
                                    headers: fetchHeaders,
                                    body: bodyStr,
                                    signal: controller.signal
                                });
                            });
                    });
                });
            })
            .then(function(response) {
                self.removeAbortController(controller);
                if (!response.ok) {
                    return response.text().then(function(text) {
                        throw new Error('MCP SigV4 request failed: ' + response.status + ' - ' + text);
                    });
                }
                return response.json();
            })
            .catch(function(error) {
                self.removeAbortController(controller);
                if (error.name === 'AbortError') {
                    throw new Error('Request was aborted');
                }
                throw error;
            });
    };

    /**
     * Connect to a SigV4-authenticated MCP gateway (initialize + list tools)
     *
     * @param {Object} gateway - Gateway config with authType='sigv4'
     * @param {Function} [progressCallback] - Optional progress callback(step, message)
     * @returns {Promise<Array>} - List of tools
     */
    MCPService.prototype.connectWithSigV4 = function(gateway, progressCallback) {
        var self = this;
        var gatewayUrl = gateway.mcpUrl;

        if (progressCallback) {
            this.setProgressCallback(gatewayUrl, progressCallback);
        }

        console.log('[MCP] Connecting with SigV4 auth:', gateway.name);
        self.emitProgress(gatewayUrl, 'connecting', 'Signing request with AWS credentials...');

        // Step 1: Initialize
        var initBody = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'Financial-Planning-Frontend',
                    version: '1.0.0'
                }
            }
        };

        return self.sigv4Fetch(gatewayUrl, initBody, gateway)
            .then(function(result) {
                console.log('[MCP] SigV4 Initialize response:', result);
                self.connectedGateways.set(gatewayUrl, {
                    sessionId: result.result ? result.result.sessionId : null,
                    tools: [],
                    connected: true,
                    authType: 'sigv4',
                    gateway: gateway
                });

                // Step 2: List tools
                self.emitProgress(gatewayUrl, 'listing_tools', 'Loading tools...');
                var listBody = {
                    jsonrpc: '2.0',
                    id: 'tools-list-' + Date.now(),
                    method: 'tools/list',
                    params: {}
                };
                return self.sigv4Fetch(gatewayUrl, listBody, gateway);
            })
            .then(function(result) {
                console.log('[MCP] SigV4 tools/list response:', result);
                var tools = (result.result && result.result.tools) ? result.result.tools : [];

                var connection = self.connectedGateways.get(gatewayUrl);
                if (connection) {
                    connection.tools = tools;
                }

                self.emitProgress(gatewayUrl, 'complete', 'Connected with ' + tools.length + ' tools');
                self.progressCallbacks.delete(gatewayUrl);
                return tools;
            })
            .catch(function(error) {
                console.error('[MCP] SigV4 connection failed:', error);
                self.emitProgress(gatewayUrl, 'error', error.message);
                self.progressCallbacks.delete(gatewayUrl);
                throw error;
});
    };

    /**
     * Make a proxied MCP request through the API Gateway proxy endpoint.
     * Browser → API Gateway (SigV4) → Lambda (SigV4) → External MCP endpoint.
     * This avoids CORS issues with external MCP servers.
     *
     * @param {string} targetUrl - The actual MCP endpoint URL
     * @param {Object} mcpBody - The MCP JSON-RPC body to send
     * @param {Object} gateway - Gateway config with sigv4Region, sigv4Service
     * @returns {Promise<Object>} The MCP JSON-RPC response
     */
    MCPService.prototype.proxyFetch = function(targetUrl, mcpBody, gateway) {
        var self = this;
        var bedrockService = window.BedrockService;
        if (!bedrockService) {
            return Promise.reject(new Error('BedrockService not available for proxy signing'));
        }

        var idToken = window.AuthService ? window.AuthService.getIdToken() : null;
        if (!idToken) {
            return Promise.reject(new Error('No ID token available for proxy credentials'));
        }

        // Build the proxy URL from the API base URL
        var apiBaseUrl = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || '';
        if (!apiBaseUrl) {
            return Promise.reject(new Error('No API base URL configured for proxy'));
        }
        var proxyUrl = apiBaseUrl.replace(/\/+$/, '') + '/mcp/proxy';

        var proxyBodyObj = {
            targetUrl: targetUrl,
            mcpBody: mcpBody,
            sigv4Region: gateway.sigv4Region || 'us-west-2',
            sigv4Service: gateway.sigv4Service || 'bedrock-agentcore'
        };
        var bodyStr = JSON.stringify(proxyBodyObj);

        console.log('[MCP] Proxy fetch to:', targetUrl, 'via:', proxyUrl);

        var urlObj = new URL(proxyUrl);
        var host = urlObj.host;
        var path = urlObj.pathname;
        var region = bedrockService.region || 'us-east-1';
        var apiRegion = host.match(/^[^.]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
        region = (apiRegion && apiRegion[1]) || region;
        var service = 'execute-api';

        return bedrockService.getCredentials(idToken)
            .then(function(credentials) {
                var now = new Date();
                var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
                var dateStamp = amzDate.substring(0, 8);

                var headers = {
                    'content-type': 'application/json',
                    'host': host,
                    'x-amz-date': amzDate
                };
                if (credentials.sessionToken) {
                    headers['x-amz-security-token'] = credentials.sessionToken;
                }

                var sortedHeaderKeys = Object.keys(headers).sort();
                var canonicalHeaders = sortedHeaderKeys.map(function(k) {
                    return k + ':' + headers[k].trim();
                }).join('\n') + '\n';
                var signedHeaders = sortedHeaderKeys.join(';');

                return bedrockService.sha256(bodyStr).then(function(payloadHash) {
                    var canonicalRequest = [
                        'POST', path, '', canonicalHeaders, signedHeaders, payloadHash
                    ].join('\n');

                    return bedrockService.sha256(canonicalRequest).then(function(canonicalRequestHash) {
                        var credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
                        var stringToSign = [
                            'AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash
                        ].join('\n');

                        return bedrockService.getSigningKey(credentials.secretAccessKey, dateStamp, region, service)
                            .then(function(signingKey) {
                                return bedrockService.hmacSha256(signingKey, stringToSign);
                            })
                            .then(function(signatureBuffer) {
                                var signature = Array.from(new Uint8Array(signatureBuffer))
                                    .map(function(b) { return b.toString(16).padStart(2, '0'); })
                                    .join('');

                                var authHeader = 'AWS4-HMAC-SHA256 Credential=' + credentials.accessKeyId + '/' +
                                    credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

                                var fetchHeaders = {
                                    'Content-Type': 'application/json',
                                    'X-Amz-Date': amzDate,
                                    'Authorization': authHeader
                                };
                                if (credentials.sessionToken) {
                                    fetchHeaders['X-Amz-Security-Token'] = credentials.sessionToken;
                                }

                                return fetch(proxyUrl, {
                                    method: 'POST',
                                    headers: fetchHeaders,
                                    body: bodyStr
                                });
                            });
                    });
                });
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        throw new Error('Proxy error ' + response.status + ': ' + text);
                    });
                }
                return response.json();
            });
    };

    /**
     * Connect to a gateway through the backend proxy (for non-CORS endpoints).
     * Uses IAM-authenticated API Gateway → Lambda → SigV4-signed upstream request.
     *
     * @param {Object} gateway - Gateway config with mcpUrl, name, sigv4Region, sigv4Service
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Promise<Array>} - Connected tools list
     */
    MCPService.prototype.connectWithProxy = function(gateway, progressCallback) {
        var self = this;
        var gatewayUrl = gateway.mcpUrl;

        if (progressCallback) {
            this.setProgressCallback(gatewayUrl, progressCallback);
        }

        console.log('[MCP] Connecting via proxy:', gateway.name);
        self.emitProgress(gatewayUrl, 'connecting', 'Connecting via backend proxy...');

        var initBody = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'Financial-Planning-Frontend',
                    version: '1.0.0'
                }
            }
        };

        return self.proxyFetch(gatewayUrl, initBody, gateway)
            .then(function(result) {
                console.log('[MCP] Proxy Initialize response:', result);
                self.connectedGateways.set(gatewayUrl, {
                    sessionId: result.result ? result.result.sessionId : null,
                    tools: [],
                    connected: true,
                    authType: 'proxy',
                    gateway: gateway
                });

                self.emitProgress(gatewayUrl, 'listing_tools', 'Loading tools...');
                var listBody = {
                    jsonrpc: '2.0',
                    id: 'tools-list-' + Date.now(),
                    method: 'tools/list',
                    params: {}
                };
                return self.proxyFetch(gatewayUrl, listBody, gateway);
            })
            .then(function(result) {
                console.log('[MCP] Proxy tools/list response:', result);
                var tools = (result.result && result.result.tools) ? result.result.tools : [];

                var connection = self.connectedGateways.get(gatewayUrl);
                if (connection) {
                    connection.tools = tools;
                }

                self.emitProgress(gatewayUrl, 'complete', 'Connected with ' + tools.length + ' tools');
                self.progressCallbacks.delete(gatewayUrl);
                return tools;
            })
            .catch(function(error) {
                console.error('[MCP] Proxy connection failed:', error);
                self.emitProgress(gatewayUrl, 'error', error.message);
                self.progressCallbacks.delete(gatewayUrl);
                throw error;
            });
    };

    /**
     * List available tools from a specific MCP gateway
     * 
     * @param {string} gatewayUrl - The MCP gateway URL
     * @param {string} accessToken - The OAuth access token (used for Bearer auth)
     * @returns {Promise<Array>} - List of available tools
     */
    MCPService.prototype.listTools = function(gatewayUrl, accessToken) {
        var self = this;
        
        if (!this.connectedGateways.has(gatewayUrl)) {
            return Promise.reject(new Error('Not connected to ' + gatewayUrl + '. Call connect() first.'));
        }

        var controller = this.createAbortController();

        return fetch(gatewayUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'tools-list-' + Date.now(),
                method: 'tools/list',
                params: {}
            }),
            signal: controller.signal
        })
        .then(function(response) {
            self.removeAbortController(controller);
            
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('MCP tools/list failed: ' + response.status + ' - ' + text);
                });
            }
            return response.json();
        })
        .then(function(result) {
            console.log('[MCP] tools/list response:', result);
            
            var tools = (result.result && result.result.tools) ? result.result.tools : [];
            
            // Update stored tools for this gateway
            var connection = self.connectedGateways.get(gatewayUrl);
            if (connection) {
                connection.tools = tools;
            }
            
            return tools;
        })
        .catch(function(error) {
            self.removeAbortController(controller);
            
            if (error.name === 'AbortError') {
                console.log('[MCP] tools/list aborted');
                throw new Error('tools/list was aborted');
            }
            
            console.error('[MCP] Error listing tools:', error);
            throw error;
        });
    };

    /**
     * Connect to a gateway with automatic token acquisition
     * Uses the gateway's OAuth configuration to get tokens
     * 
     * @param {Object} gateway - Gateway config object
     * @param {Function} [progressCallback] - Optional progress callback(step, message)
     * @returns {Promise<Array>} - List of tools
     */
    MCPService.prototype.connectWithGatewayAuth = function(gateway, progressCallback) {
        var self = this;
        var gatewayUrl = gateway.mcpUrl;
        
        // Set progress callback if provided
        if (progressCallback) {
            this.setProgressCallback(gatewayUrl, progressCallback);
        }
        
        console.log('[MCP] Connecting with gateway-specific auth:', gateway.name);
        
        return this.getGatewayToken(gateway)
            .then(function(accessToken) {
                self.emitProgress(gatewayUrl, 'connecting', 'Connecting to gateway...');
                return self.connect(gatewayUrl, accessToken);
            })
            .then(function() {
                self.emitProgress(gatewayUrl, 'listing_tools', 'Loading tools...');
                var tokenData = self.gatewayTokens.get(gatewayUrl);
                // Use access token for MCP gateway authentication
                var accessToken = tokenData ? tokenData.accessToken : null;
                return self.listTools(gatewayUrl, accessToken);
            })
            .then(function(tools) {
                self.emitProgress(gatewayUrl, 'complete', 'Connected with ' + tools.length + ' tools');
                // Clear callback after completion
                self.progressCallbacks.delete(gatewayUrl);
                return tools;
            })
            .catch(function(error) {
                self.emitProgress(gatewayUrl, 'error', error.message);
                self.progressCallbacks.delete(gatewayUrl);
                throw error;
            });
    };

    /**
     * Normalize a tool name to get the display name portion
     * MCP tools use format "target___name", we extract just the name part
     * 
     * @param {string} fullName - The full MCP tool name
     * @returns {string} - The display name portion
     */
    MCPService.prototype.getDisplayToolName = function(fullName) {
        if (fullName && fullName.indexOf('___') !== -1) {
            // Return the part after ___
            return fullName.split('___').pop();
        }
        return fullName;
    };

    /**
     * Find a tool by name, handling both full MCP names and display names
     * Searches for exact match first, then tries matching by display name portion
     * 
     * @param {string} toolName - The tool name to search for (can be full or display name)
     * @returns {Object|null} - Object with gatewayUrl and fullToolName, or null if not found
     */
    MCPService.prototype.findToolByName = function(toolName) {
        var result = null;
        var displayNameToFind = this.getDisplayToolName(toolName);
        
        this.connectedGateways.forEach(function(connection, gatewayUrl) {
            if (result) return;
            
            // First try exact match
            var exactMatch = connection.tools.find(function(tool) {
                return tool.name === toolName;
            });
            
            if (exactMatch) {
                result = { gatewayUrl: gatewayUrl, fullToolName: exactMatch.name };
                return;
            }
            
            // Try matching by display name portion
            var displayMatch = connection.tools.find(function(tool) {
                var toolDisplayName = tool.name.indexOf('___') !== -1 
                    ? tool.name.split('___').pop() 
                    : tool.name;
                return toolDisplayName === displayNameToFind;
            });
            
            if (displayMatch) {
                result = { gatewayUrl: gatewayUrl, fullToolName: displayMatch.name };
            }
        });
        
        return result;
    };

    /**
     * Call a tool - automatically routes to the correct gateway
     * Handles both full MCP names (target___name) and display names (name)
     * 
     * @param {string} toolName - The name of the tool to call (can be full or display name)
     * @param {Object} args - The arguments to pass to the tool
     * @param {string} [accessToken] - Optional access token (will use stored token if not provided)
     * @returns {Promise<Object>} - Tool execution result
     */
    MCPService.prototype.callTool = function(toolName, args, accessToken) {
        var self = this;
        
        // Find which gateway has this tool (handles both full and display names)
        var toolInfo = this.findToolByName(toolName);
        var targetGateway = toolInfo ? toolInfo.gatewayUrl : null;
        var fullToolName = toolInfo ? toolInfo.fullToolName : toolName;

        if (!targetGateway) {
            return Promise.reject(new Error("Tool '" + toolName + "' not found in any connected gateway."));
        }

        console.log('[MCP] Calling tool:', fullToolName, '(requested as:', toolName, ')');

        // Check if this gateway uses SigV4 or proxy auth
        var connection = this.connectedGateways.get(targetGateway);
        if (connection && (connection.authType === 'sigv4' || connection.authType === 'proxy') && connection.gateway) {
            var callBody = {
                jsonrpc: '2.0',
                id: 'tool-call-' + Date.now(),
                method: 'tools/call',
                params: {
                    name: fullToolName,
                    arguments: args || {}
                }
            };
            var fetchFn = connection.authType === 'proxy'
                ? self.proxyFetch.bind(self, targetGateway, callBody, connection.gateway)
                : self.sigv4Fetch.bind(self, targetGateway, callBody, connection.gateway);
            return fetchFn()
                .then(function(result) {
                    console.log('[MCP] ' + connection.authType + ' tools/call response:', result);
                    // Check for JSON-RPC error response
                    if (result.error) {
                        var errMsg = result.error.message || JSON.stringify(result.error);
                        throw new Error('MCP tool error: ' + errMsg);
                    }
                    return result.result;
                });
        }

        // Use stored access token if not provided (Bearer auth flow)
        if (!accessToken) {
            var tokenData = this.gatewayTokens.get(targetGateway);
            accessToken = tokenData ? tokenData.accessToken : null;
        }

        if (!accessToken) {
            return Promise.reject(new Error('No access token available for gateway'));
        }

        var controller = this.createAbortController();
        
        return fetch(targetGateway, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'tool-call-' + Date.now(),
                method: 'tools/call',
                params: {
                    name: fullToolName,
                    arguments: args || {}
                }
            }),
            signal: controller.signal
        })
        .then(function(response) {
            self.removeAbortController(controller);
            
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('MCP tools/call failed: ' + response.status + ' - ' + text);
                });
            }
            return response.json();
        })
        .then(function(result) {
            console.log('[MCP] tools/call response:', result);
            // Check for JSON-RPC error response
            if (result.error) {
                var errMsg = result.error.message || JSON.stringify(result.error);
                throw new Error('MCP tool error: ' + errMsg);
            }
            return result.result;
        })
        .catch(function(error) {
            self.removeAbortController(controller);
            
            if (error.name === 'AbortError') {
                console.log('[MCP] Tool call aborted');
                throw new Error('Tool call was aborted');
            }
            
            console.error('[MCP] Error calling tool:', error);
            throw error;
        });
    };

    /**
     * Get all tools from all connected gateways
     * @returns {Array}
     */
    MCPService.prototype.getAllTools = function() {
        var allTools = [];
        this.connectedGateways.forEach(function(connection) {
            allTools = allTools.concat(connection.tools);
        });
        return allTools;
    };

    /**
     * Disconnect from a specific MCP gateway or all gateways
     * @param {string} [gatewayUrl] - Optional specific gateway to disconnect
     */
    MCPService.prototype.disconnect = function(gatewayUrl) {
        if (gatewayUrl) {
            this.connectedGateways.delete(gatewayUrl);
            this.gatewayTokens.delete(gatewayUrl);
        } else {
            this.connectedGateways.clear();
            this.gatewayTokens.clear();
        }
    };

    /**
     * Check if connected to a specific gateway
     * @param {string} gatewayUrl
     * @returns {boolean}
     */
    MCPService.prototype.isConnected = function(gatewayUrl) {
        return this.connectedGateways.has(gatewayUrl);
    };

    /**
     * Check if a valid (non-expired) token exists for a gateway
     * @param {string} gatewayUrl
     * @returns {boolean}
     */
    MCPService.prototype.hasValidToken = function(gatewayUrl) {
        var tokenData = this.gatewayTokens.get(gatewayUrl);
        return !!tokenData && tokenData.expiresAt > Date.now();
    };

    /**
     * Get list of connected gateway URLs
     * @returns {Array<string>}
     */
    MCPService.prototype.getConnectedGatewayUrls = function() {
        return Array.from(this.connectedGateways.keys());
    };

    /**
     * Auto-discover accessible gateways
     * Attempts connection to each gateway and records which ones succeed
     * Gateways with their own OAuth config (authDiscoveryUrl) are skipped - they require explicit user click
     * 
     * @param {Array<Object>} gateways - Array of gateway objects
     * @param {string} [fallbackToken] - Optional fallback access token (frontend access token)
     * @returns {Promise<Object>} - Result with accessible and inaccessible gateways
     */
    MCPService.prototype.autoDiscoverGateways = function(gateways, fallbackToken) {
        var self = this;
        var results = {
            accessible: [],
            inaccessible: [],
            needsAuth: []
        };

        var promises = gateways.map(function(gateway) {
            var gatewayUrl = gateway.mcpUrl;
            
            // Gateways with their own OAuth config require explicit user authentication
            // Do NOT try to auto-connect with frontend's token
            if (gateway.authDiscoveryUrl && gateway.clientId) {
                console.log('[MCP] Gateway has own OAuth config, skipping auto-discovery:', gateway.name);
                results.needsAuth.push({
                    gateway: gateway,
                    error: 'Requires gateway-specific authentication (click to connect)'
                });
                return Promise.resolve();
            }
            
            // Try with fallback token for gateways sharing the frontend's User Pool
            if (fallbackToken) {
                return self.connect(gatewayUrl, fallbackToken)
                    .then(function() {
                        return self.listTools(gatewayUrl, fallbackToken);
                    })
                    .then(function(tools) {
                        self.gatewayTokens.set(gatewayUrl, {
                            accessToken: fallbackToken,
                            expiresAt: Date.now() + 3600000 // 1 hour estimate
                        });
                        results.accessible.push({
                            gateway: gateway,
                            tools: tools
                        });
                    })
                    .catch(function(error) {
                        // Check if it's an auth error
                        if (error.message && error.message.indexOf('401') !== -1) {
                            console.log('[MCP] Gateway requires gateway-specific auth:', gateway.name);
                            results.needsAuth.push({
                                gateway: gateway,
                                error: 'Requires gateway-specific authentication'
                            });
                        } else {
                            console.log('[MCP] Gateway not accessible:', gateway.name, error.message);
                            results.inaccessible.push({
                                gateway: gateway,
                                error: error.message
                            });
                        }
                    });
            } else {
                // No fallback token, mark as needs auth
                results.needsAuth.push({
                    gateway: gateway,
                    error: 'No token available'
                });
                return Promise.resolve();
            }
        });

        return Promise.all(promises).then(function() {
            return results;
        });
    };

    /**
     * Authenticate multiple gateways sequentially using a SINGLE popup.
     * After external identity provider SSO is established with the first gateway, subsequent gateways
     * auto-complete without user interaction (SSO session is shared).
     * 
     
     * @param {Array<Object>} gateways - Array of OAuth gateway configs (pre-filtered by caller)
     * @param {Function} [onProgress] - Optional callback(gatewayName, gateway, index, total, status)
     * @returns {Promise<Object>} - Results: { success: [], failed: [] }
     */
    MCPService.prototype.authenticateAllGatewaysSequentially = function(gateways, onProgress) {
        var self = this;
        var results = { success: [], failed: [] };
        var startTime = Date.now();
        
        if (!gateways || gateways.length === 0) {
            return Promise.resolve(results);
        }
        

        
        // Pre-fetch ALL discovery documents in parallel for speed
        var discoveryPromises = gateways.map(function(gateway) {
            return fetch(gateway.authDiscoveryUrl)
                .then(function(response) { return response.ok ? response.json() : Promise.reject(new Error('Discovery failed')); })
                .then(function(discovery) { return { gateway: gateway, discovery: discovery }; })
                .catch(function(error) { return { gateway: gateway, error: error.message }; });
        });
        
        return Promise.all(discoveryPromises).then(function(discoveryResults) {
            var validGateways = discoveryResults.filter(function(result) { return !result.error; });
            discoveryResults.filter(function(result) { return result.error; }).forEach(function(result) {
                results.failed.push({ gateway: result.gateway, error: result.error });
                if (onProgress) onProgress(result.gateway.name, result.gateway, gateways.indexOf(result.gateway), gateways.length, 'failed');
            });
            
            if (validGateways.length === 0) {
                return results;
            }
            
            // Process gateways sequentially, reusing the same popup
            var sharedPopup = null;
            var currentIndex = 0;
            
            function processNext() {
                if (currentIndex >= validGateways.length) {
                    // All done - close popup
                    if (sharedPopup && !sharedPopup.closed) sharedPopup.close();
                    var totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    console.log('[MCP] Sequential auth complete:', results.success.length, 'success,', results.failed.length, 'failed, total time:', totalTime + 's');
                    return Promise.resolve(results);
                }
                
                var item = validGateways[currentIndex];
                var isFirstGateway = (currentIndex === 0);
                var timeout = isFirstGateway ? 5000 : 4000; // 5s for interactive login, 4s for SSO auto-complete
                
                if (onProgress) onProgress(item.gateway.name, item.gateway, currentIndex, gateways.length, 'authenticating');
                
                return self.performGatewayOAuth(item.gateway, {
                    discovery: item.discovery,
                    existingPopup: sharedPopup,
                    timeout: timeout
                })
                    .then(function(result) {
                        sharedPopup = result.popup; // Keep popup for next gateway
                        results.success.push({ gateway: item.gateway, token: result.token });
                        if (onProgress) onProgress(item.gateway.name, item.gateway, currentIndex, gateways.length, 'success');
                        currentIndex++;
                        return processNext();
                    })
                    .catch(function(error) {
                        // Preserve popup reference from error for reuse
                        if (error.popup) sharedPopup = error.popup;
                        console.warn('[MCP] Auth failed for', item.gateway.name, ':', error.message);
                        results.failed.push({ gateway: item.gateway, error: error.message });
                        if (onProgress) onProgress(item.gateway.name, item.gateway, currentIndex, gateways.length, 'failed');
                        currentIndex++;
                        // Continue with next gateway even if one fails
                        return processNext();
                    });
            }
            return processNext();
        });
    };

    /**
     * Open OAuth popup with reuse support for batch/sequential authentication.
     * Unlike openOAuthPopup, this keeps the popup open and returns it for reuse.
     * @param {string} authUrl - Authorization URL
     * @param {string} state - OAuth state
     * @param {Window} existingPopup - Existing popup to reuse (or null to open new)
     * @param {number} timeout - Timeout in ms
     * @returns {Promise<{token: string, popup: Window}>} - Token and popup for reuse
     */
    MCPService.prototype.openOAuthPopupWithReuse = function(authUrl, state, existingPopup, timeout) {
        var self = this;
        timeout = timeout || 60000;
        
        return new Promise(function(resolve, reject) {
            var popup = existingPopup;
            var previousCallbackUrl = null;
            
            // Open new popup if none exists or it was closed
            if (!popup || popup.closed) {
                var width = 500, height = 600;
                var left = (window.screen.width - width) / 2;
                var top = (window.screen.height - height) / 2;
                popup = window.open(authUrl, 'gateway-oauth-seq',
                    'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top);
                if (!popup) {
                    reject(new Error('Popup blocked'));
                    return;
                }
            } else {
                // Check if popup is currently on a callback URL (from previous auth)
                try {
                    var currentUrl = popup.location.href;
                    if (currentUrl && currentUrl.indexOf(window.location.origin + '/callback') === 0) {
                        previousCallbackUrl = currentUrl;
                    }
                } catch (urlError) { /* cross-origin, that's fine */ }
                
                // Navigate existing popup to new auth URL
                popup.location.href = authUrl;
            }
            
            var flowData = self.pendingOAuthFlows.get(state);
            if (flowData) {
                flowData.popup = popup;
            }
            
            var resolved = false;
            var checkInterval = null;
            var messageHandler = null;
            
            var cleanup = function() {
                if (checkInterval) clearInterval(checkInterval);
                if (messageHandler) window.removeEventListener('message', messageHandler);
            };
            
            messageHandler = function(event) {
                if (event.origin !== window.location.origin) return;
                if (!event.data || event.data.type !== 'gateway-oauth-callback') return;
                if (event.data.state !== state) return;
                if (resolved) return;
                
                resolved = true;
                cleanup();
                
                if (event.data.error) {
                    self.pendingOAuthFlows.delete(state);
                    var messageError = new Error(event.data.error_description || event.data.error);
                    messageError.popup = popup;
                    reject(messageError);
                    return;
                }
                
                self.handleOAuthCallback(event.data.code, state, { keepPopupOpen: true })
                    .then(function(token) { resolve({ token: token, popup: popup }); })
                    .catch(function(error) { error.popup = popup; reject(error); });
            };
            
            window.addEventListener('message', messageHandler);
            
            // Fast polling for same-origin URL detection (50ms intervals)
            var lastSameOriginTime = Date.now();
            var crossOriginTimeout = 2000; // If stuck cross-origin for 2 sec
            
            checkInterval = setInterval(function() {
                if (resolved) { clearInterval(checkInterval); return; }
                if (popup.closed) {
                    clearInterval(checkInterval);
                    window.removeEventListener('message', messageHandler);
                    if (!resolved) {
                        self.pendingOAuthFlows.delete(state);
                        reject(new Error('Popup closed'));
                    }
                    return;
                }
                try {
                    var popupUrl = popup.location.href;
                    
                    // We can read the URL, so it's same-origin
                    lastSameOriginTime = Date.now();
                    
                    // Skip if popup is still on the previous callback URL (hasn't navigated yet)
                    if (previousCallbackUrl && popupUrl === previousCallbackUrl) {
                        return; // Wait for popup to navigate away
                    }
                    
                    // Clear previousCallbackUrl once popup has navigated away
                    if (previousCallbackUrl && popupUrl !== previousCallbackUrl) {
                        previousCallbackUrl = null;
                    }
                    
                    if (popupUrl && popupUrl.indexOf(window.location.origin + '/callback') === 0) {
                        var urlParams = new URL(popupUrl).searchParams;
                        var code = urlParams.get('code');
                        var returnedState = urlParams.get('state');
                        var error = urlParams.get('error');
                        
                        // Handle errors with state validation (consistent with success path)
                        if (error && returnedState === state && !resolved) {
                            resolved = true;
                            cleanup();
                            self.pendingOAuthFlows.delete(state);
                            var callbackError = new Error(urlParams.get('error_description') || error);
                            callbackError.popup = popup;
                            reject(callbackError);
                            return;
                        }
                        
                        if (code && returnedState === state && !resolved) {
                            resolved = true;
                            cleanup();
                            self.handleOAuthCallback(code, state, { keepPopupOpen: true })
                                .then(function(token) { resolve({ token: token, popup: popup }); })
                                .catch(function(error) { error.popup = popup; reject(error); });
                        }
                    }
                } catch (urlError) {
                    // Cross-origin - can't read URL
                    // Check if we've been stuck cross-origin too long (likely error page)
                    if (Date.now() - lastSameOriginTime > crossOriginTimeout && !resolved) {
                        resolved = true;
                        cleanup();
                        self.pendingOAuthFlows.delete(state);
                        var crossOriginError = new Error('Authentication failed - no access or error page');
                        crossOriginError.popup = popup;
                        reject(crossOriginError);
                    }
                }
            }, 50); // Fast 50ms polling
            
            // Timeout
            setTimeout(function() {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    self.pendingOAuthFlows.delete(state);
                    var timeoutError = new Error('Auth timeout');
                    timeoutError.popup = popup;
                    reject(timeoutError);
                }
            }, timeout);
        });
    };

    /**
     * Persist gateway tokens to localStorage for auto-connect on reload
     */
    MCPService.prototype._persistGatewayTokens = function() {
        try {
            var tokensObj = {};
            this.gatewayTokens.forEach(function(tokenData, gatewayUrl) {
                tokensObj[gatewayUrl] = {
                    accessToken: tokenData.accessToken,
                    idToken: tokenData.idToken,
                    refreshToken: tokenData.refreshToken,
                    expiresAt: tokenData.expiresAt
                };
            });
            localStorage.setItem('agentic_gateway_tokens', JSON.stringify(tokensObj));
            console.log('[MCP] Persisted', Object.keys(tokensObj).length, 'gateway token(s) to localStorage');
        } catch (e) {
            console.warn('[MCP] Failed to persist gateway tokens:', e);
        }
    };

    /**
     * Restore gateway tokens from localStorage
     * Only restores tokens that haven't expired
     */
    MCPService.prototype._restoreGatewayTokens = function() {
        try {
            var stored = localStorage.getItem('agentic_gateway_tokens');
            if (!stored) return;
            
            var tokensObj = JSON.parse(stored);
            var now = Date.now();
            var restored = 0;
            
            for (var gatewayUrl in tokensObj) {
                if (tokensObj.hasOwnProperty(gatewayUrl)) {
                    var tokenData = tokensObj[gatewayUrl];
                    // Only restore if token hasn't expired (with 60s buffer)
                    if (tokenData.expiresAt > now + 60000) {
                        this.gatewayTokens.set(gatewayUrl, tokenData);
                        restored++;
                    }
                }
            }
            
            if (restored > 0) {
                console.log('[MCP] Restored', restored, 'gateway token(s) from localStorage');
            }
        } catch (e) {
            console.warn('[MCP] Failed to restore gateway tokens:', e);
        }
    };

    // Export as singleton and restore cached tokens
    var instance = new MCPService();
    instance._restoreGatewayTokens();
    window.MCPService = instance;

})();

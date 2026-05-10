/**
 * Bedrock Service - Direct Bedrock API calls using Cognito Identity credentials
 * 
 * Implements AWS SigV4 signing in vanilla JavaScript (no SDK dependencies).
 * Uses Cognito Identity Pool to get temporary AWS credentials.
 */

(function() {
    'use strict';

    /**
     * Bedrock Service class
     */
    function BedrockService() {
        this.identityPoolId = null;
        this.region = null;
        this.userPoolId = null;
        this.credentials = null;
        this.credentialsExpiration = null;
        this.toolSpecs = [];
        this.conversationHistory = [];
        this.systemPrompt = '';
        this.activeAbortControllers = new Set();
    }

    // ============================================================
    // Configuration
    // ============================================================

    /**
     * Configure the Bedrock service
     */
    BedrockService.prototype.configure = function(identityPoolId, region, userPoolId) {
        this.identityPoolId = identityPoolId;
        this.region = region;
        this.userPoolId = userPoolId;
        console.log('[Bedrock] Configured with region:', region);
    };

    /**
     * Set tool specifications
     * Note: This REPLACES existing tools, it does not append
     */
    BedrockService.prototype.setToolSpecs = function(tools) {
        this.toolSpecs = tools || [];
        
        // Check for duplicate tool names (which would indicate a bug)
        var toolNames = this.toolSpecs.map(function(t) {
            return t.toolSpec ? t.toolSpec.name : 'unknown';
        });
        var uniqueNames = new Set(toolNames);
        if (uniqueNames.size !== toolNames.length) {
            console.warn('[Bedrock] WARNING: Duplicate tool names detected!');
            console.warn('[Bedrock] Total tools:', toolNames.length, 'Unique:', uniqueNames.size);
            // Log duplicates
            var counts = {};
            toolNames.forEach(function(name) {
                counts[name] = (counts[name] || 0) + 1;
            });
            Object.keys(counts).forEach(function(name) {
                if (counts[name] > 1) {
                    console.warn('[Bedrock]   Duplicate:', name, 'appears', counts[name], 'times');
                }
            });
        } else {
            console.log('[Bedrock] Tool specs set:', this.toolSpecs.length, 'tools (no duplicates)');
        }
    };

    /**
     * Get tool specifications
     */
    BedrockService.prototype.getToolSpecs = function() {
        return this.toolSpecs;
    };

    /**
     * Set system prompt
     */
    BedrockService.prototype.setSystemPrompt = function(prompt) {
        this.systemPrompt = prompt;
    };

    /**
     * Clear conversation history
     */
    BedrockService.prototype.clearHistory = function() {
        this.conversationHistory = [];
    };

    /**
     * Get conversation history
     */
    BedrockService.prototype.getHistory = function() {
        return this.conversationHistory;
    };

    // ============================================================
    // Abort Controller Management
    // ============================================================

    BedrockService.prototype.abortAll = function() {
        console.log('[Bedrock] Aborting ' + this.activeAbortControllers.size + ' active requests');
        this.activeAbortControllers.forEach(function(controller) {
            try {
                controller.abort();
            } catch (err) {
                console.error('[Bedrock] Error aborting:', err);
            }
        });
        this.activeAbortControllers.clear();
    };

    BedrockService.prototype.createAbortController = function() {
        var controller = new AbortController();
        this.activeAbortControllers.add(controller);
        return controller;
    };

    BedrockService.prototype.removeAbortController = function(controller) {
        this.activeAbortControllers.delete(controller);
    };

    // ============================================================
    // AWS Credential Management
    // ============================================================

    /**
     * Clear cached credentials (call when token expires)
     */
    BedrockService.prototype.clearCredentials = function() {
        this.credentials = null;
        this.credentialsExpiration = null;
    };

    /**
     * Get Cognito Identity credentials using the ID token
     */
    BedrockService.prototype.getCredentials = function(idToken) {
        var self = this;

        // Check if we have valid cached credentials
        if (this.credentials && this.credentialsExpiration) {
            var now = new Date();
            var fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
            if (this.credentialsExpiration > fiveMinutesFromNow) {
                return Promise.resolve(this.credentials);
            }
        }

        if (!this.identityPoolId) {
            return Promise.reject(new Error('Bedrock service not configured'));
        }

        // Step 1: Get Identity ID
        var getIdUrl = 'https://cognito-identity.' + this.region + '.amazonaws.com/';
        var getIdBody = {
            IdentityPoolId: this.identityPoolId,
            Logins: {}
        };
        getIdBody.Logins['cognito-idp.' + this.region + '.amazonaws.com/' + this.userPoolId] = idToken;

        return fetch(getIdUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityService.GetId'
            },
            body: JSON.stringify(getIdBody)
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(text) {
                    // Clear cached credentials on auth failure
                    self.clearCredentials();
                    
                    // Check if this is a token expiration error
                    if (text.includes('Token expired') || text.includes('NotAuthorizedException')) {
                        throw new Error('Session expired. Please log out and log back in to continue.');
                    }
                    throw new Error('GetId failed: ' + text);
                });
            }
            return response.json();
        })
        .then(function(data) {
            var identityId = data.IdentityId;
            console.log('[Bedrock] Got Identity ID:', identityId);

            // Step 2: Get credentials for identity
            var getCredsBody = {
                IdentityId: identityId,
                Logins: {}
            };
            getCredsBody.Logins['cognito-idp.' + self.region + '.amazonaws.com/' + self.userPoolId] = idToken;

            return fetch(getIdUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'X-Amz-Target': 'AWSCognitoIdentityService.GetCredentialsForIdentity'
                },
                body: JSON.stringify(getCredsBody)
            });
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('GetCredentialsForIdentity failed: ' + text);
                });
            }
            return response.json();
        })
        .then(function(data) {
            var creds = data.Credentials;
            self.credentials = {
                accessKeyId: creds.AccessKeyId,
                secretAccessKey: creds.SecretKey,
                sessionToken: creds.SessionToken
            };
            self.credentialsExpiration = new Date(creds.Expiration * 1000);
            console.log('[Bedrock] Got temporary credentials, expires:', self.credentialsExpiration);
            return self.credentials;
        });
    };

    // ============================================================
    // AWS SigV4 Signing (Vanilla JS implementation)
    // ============================================================

    /**
     * SHA-256 hash function using SubtleCrypto
     */
    BedrockService.prototype.sha256 = function(message) {
        var encoder = new TextEncoder();
        var data = encoder.encode(message);
        return crypto.subtle.digest('SHA-256', data).then(function(hash) {
            return Array.from(new Uint8Array(hash))
                .map(function(b) { return b.toString(16).padStart(2, '0'); })
                .join('');
        });
    };

    /**
     * HMAC-SHA256 function
     */
    BedrockService.prototype.hmacSha256 = function(key, message) {
        var encoder = new TextEncoder();
        var keyData = typeof key === 'string' ? encoder.encode(key) : key;
        var messageData = encoder.encode(message);

        return crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        ).then(function(cryptoKey) {
            return crypto.subtle.sign('HMAC', cryptoKey, messageData);
        });
    };

    /**
     * Get signing key for AWS SigV4
     */
    BedrockService.prototype.getSigningKey = function(secretKey, dateStamp, regionName, serviceName) {
        var self = this;
        var encoder = new TextEncoder();

        return self.hmacSha256(encoder.encode('AWS4' + secretKey), dateStamp)
            .then(function(kDate) {
                return self.hmacSha256(kDate, regionName);
            })
            .then(function(kRegion) {
                return self.hmacSha256(kRegion, serviceName);
            })
            .then(function(kService) {
                return self.hmacSha256(kService, 'aws4_request');
            });
    };

    /**
     * URI-encode a string per AWS SigV4 spec (RFC 3986)
     */
    BedrockService.prototype.uriEncode = function(str, encodeSlash) {
        if (str === null || str === undefined) return '';
        
        var result = '';
        for (var i = 0; i < str.length; i++) {
            var ch = str.charAt(i);
            if ((ch >= 'A' && ch <= 'Z') || 
                (ch >= 'a' && ch <= 'z') || 
                (ch >= '0' && ch <= '9') || 
                ch === '_' || ch === '-' || ch === '~' || ch === '.') {
                result += ch;
            } else if (ch === '/' && !encodeSlash) {
                result += ch;
            } else {
                result += '%' + str.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0');
            }
        }
        return result;
    };

    /**
     * Sign a request using AWS SigV4
     */
    BedrockService.prototype.signRequest = function(method, url, headers, body, credentials) {
        var self = this;
        var urlObj = new URL(url);
        var host = urlObj.host;
        
        // Extract path from URL string directly
        // For SigV4, the canonical URI must be URI-encoded
        // If the path already has encoded chars (like %3A), those % chars must be encoded as %25
        var urlWithoutProtocol = url.replace(/^https?:\/\/[^\/]+/, '');
        var pathAndQuery = urlWithoutProtocol.split('?');
        var rawPath = pathAndQuery[0] || '/';
        
        // URI-encode each path segment WITHOUT decoding first
        // This means %3A becomes %253A (the % gets encoded)
        var canonicalPath = rawPath.split('/').map(function(segment) {
            // Encode the segment as-is (don't decode first)
            // This will encode % as %25, so %3A becomes %253A
            return self.uriEncode(segment, true);
        }).join('/');
        
        var service = 'bedrock';

        var now = new Date();
        var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        var dateStamp = amzDate.substring(0, 8);

        // Add required headers
        headers['host'] = host;
        headers['x-amz-date'] = amzDate;
        if (credentials.sessionToken) {
            headers['x-amz-security-token'] = credentials.sessionToken;
        }

        // Create canonical request
        var sortedHeaderKeys = Object.keys(headers).sort();
        var canonicalHeaders = sortedHeaderKeys.map(function(k) {
            return k.toLowerCase() + ':' + headers[k].trim();
        }).join('\n') + '\n';
        var signedHeaders = sortedHeaderKeys.map(function(k) {
            return k.toLowerCase();
        }).join(';');

        return self.sha256(body || '').then(function(payloadHash) {
            var canonicalRequest = [
                method,
                canonicalPath,
                '', // query string (empty for POST)
                canonicalHeaders,
                signedHeaders,
                payloadHash
            ].join('\n');

            return self.sha256(canonicalRequest).then(function(canonicalRequestHash) {
                // Create string to sign
                var algorithm = 'AWS4-HMAC-SHA256';
                var credentialScope = dateStamp + '/' + self.region + '/' + service + '/aws4_request';
                var stringToSign = [
                    algorithm,
                    amzDate,
                    credentialScope,
                    canonicalRequestHash
                ].join('\n');

                // Get signing key and sign
                return self.getSigningKey(credentials.secretAccessKey, dateStamp, self.region, service)
                    .then(function(signingKey) {
                        return self.hmacSha256(signingKey, stringToSign);
                    })
                    .then(function(signatureBuffer) {
                        var signature = Array.from(new Uint8Array(signatureBuffer))
                            .map(function(b) { return b.toString(16).padStart(2, '0'); })
                            .join('');

                        // Create authorization header
                        var authorizationHeader = algorithm + ' ' +
                            'Credential=' + credentials.accessKeyId + '/' + credentialScope + ', ' +
                            'SignedHeaders=' + signedHeaders + ', ' +
                            'Signature=' + signature;

                        headers['Authorization'] = authorizationHeader;
                        return headers;
                    });
            });
        });
    };

    // ============================================================
    // AWS Event Stream Parser
    // ============================================================

    /**
     * Parse AWS Event Stream format (binary protocol)
     * Each message has: prelude (12 bytes) + headers + payload + message CRC (4 bytes)
     * 
     * Prelude format:
     * - Total byte length (4 bytes, big-endian uint32)
     * - Headers byte length (4 bytes, big-endian uint32)
     * - Prelude CRC (4 bytes, CRC32)
     */
    BedrockService.prototype.parseEventStreamMessage = function(dataView, offset, totalBytes) {
        // Need at least 16 bytes for prelude (12) + message CRC (4)
        if (totalBytes - offset < 16) {
            return null;
        }

        // Read prelude
        var totalLength = dataView.getUint32(offset, false); // big-endian
        var headersLength = dataView.getUint32(offset + 4, false);
        // Prelude CRC at offset + 8 (4 bytes) - we skip validation
        
        // Check if we have the full message
        if (totalBytes - offset < totalLength) {
            return null; // Incomplete message
        }

        // Calculate payload position
        var headersStart = offset + 12;
        var payloadStart = headersStart + headersLength;
        var payloadLength = totalLength - 12 - headersLength - 4; // subtract prelude and message CRC

        // Parse headers to get event type (simplified - we just extract payload)
        // Full header parsing would need to handle all header types
        var eventType = null;

        // Extract payload
        var payload = null;
        if (payloadLength > 0) {
            // Note: payloadStart is relative to the DataView's view, so we need to add dataView.byteOffset
            // when accessing the underlying buffer
            var payloadBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + payloadStart, payloadLength);
            var payloadText = new TextDecoder('utf-8').decode(payloadBytes);
            
            try {
                payload = JSON.parse(payloadText);
            } catch (e) {
                // Not JSON, might be error or other format
                console.log('[Bedrock] Event type:', eventType, 'Raw payload:', payloadText.substring(0, 200));
            }
        }

        return {
            bytesConsumed: totalLength,
            eventType: eventType,
            payload: payload
        };
    };

    /**
     * Parse all complete messages from a Uint8Array
     */
    BedrockService.prototype.parseEventStream = function(uint8Array) {
        var messages = [];
        var offset = 0;
        var dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
        var totalBytes = uint8Array.byteLength;

        while (offset < totalBytes) {
            var result = this.parseEventStreamMessage(dataView, offset, totalBytes);
            if (result === null) {
                break; // Incomplete message
            }
            if (result.payload) {
                messages.push(result.payload);
            }
            offset += result.bytesConsumed;
        }

        // Return remaining bytes as new Uint8Array
        var remaining = null;
        if (offset < totalBytes) {
            remaining = uint8Array.slice(offset);
        }

        return {
            messages: messages,
            remaining: remaining
        };
    };

    // ============================================================
    // Bedrock API Methods
    // ============================================================

    /**
     * List available foundation models from Bedrock
     * @param {string} idToken - The Cognito ID token
     * @param {Object} filters - Optional filters (byProvider, byOutputModality, byInferenceType)
     * @returns {Promise<Array>} - List of available models
     */
    BedrockService.prototype.listFoundationModels = function(idToken, filters) {
        var self = this;
        filters = filters || {};

        return this.getCredentials(idToken)
            .then(function(credentials) {
                // Build URL with optional query parameters
                var baseUrl = 'https://bedrock.' + self.region + '.amazonaws.com/foundation-models';
                var queryParams = [];
                
                if (filters.byProvider) {
                    queryParams.push('byProvider=' + encodeURIComponent(filters.byProvider));
                }
                if (filters.byOutputModality) {
                    queryParams.push('byOutputModality=' + encodeURIComponent(filters.byOutputModality));
                }
                if (filters.byInferenceType) {
                    queryParams.push('byInferenceType=' + encodeURIComponent(filters.byInferenceType));
                }
                
                var queryString = queryParams.length > 0 ? queryParams.join('&') : '';
                var url = queryString ? baseUrl + '?' + queryString : baseUrl;

                var headers = {
                    'Content-Type': 'application/json'
                };

                // Use signed request with query string support
                return self.signRequestWithQuery('GET', baseUrl, queryString, headers, '', credentials)
                    .then(function(signedHeaders) {
                        return fetch(url, {
                            method: 'GET',
                            headers: signedHeaders
                        });
                    });
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        console.error('[Bedrock] ListFoundationModels failed:', response.status, text);
                        throw new Error('ListFoundationModels failed: ' + response.status + ' - ' + text);
                    });
                }
                return response.json();
            })
            .then(function(data) {
                console.log('[Bedrock] ListFoundationModels response:', data);
                
                // Filter to only models that support converse/streaming
                var models = (data.modelSummaries || []).filter(function(model) {
                    // Check if model supports on-demand inference and TEXT output
                    var hasOnDemand = model.inferenceTypesSupported && 
                        model.inferenceTypesSupported.includes('ON_DEMAND');
                    var hasTextOutput = model.outputModalities && 
                        model.outputModalities.includes('TEXT');
                    var hasTextInput = model.inputModalities && 
                        model.inputModalities.includes('TEXT');
                    
                    return hasOnDemand && hasTextOutput && hasTextInput;
                });
                
                // Sort by provider then model name
                models.sort(function(a, b) {
                    var providerCmp = (a.providerName || '').localeCompare(b.providerName || '');
                    if (providerCmp !== 0) return providerCmp;
                    return (a.modelName || '').localeCompare(b.modelName || '');
                });
                
                return models;
            });
    };

    /**
     * Sign a request with query string support (for GET requests)
     * This properly handles the canonical query string in SigV4
     */
    BedrockService.prototype.signRequestWithQuery = function(method, url, queryString, headers, body, credentials) {
        var self = this;
        var urlObj = new URL(url);
        var host = urlObj.host;
        var canonicalPath = urlObj.pathname || '/';
        var service = 'bedrock';

        var now = new Date();
        var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        var dateStamp = amzDate.substring(0, 8);

        // Add required headers
        headers['host'] = host;
        headers['x-amz-date'] = amzDate;
        if (credentials.sessionToken) {
            headers['x-amz-security-token'] = credentials.sessionToken;
        }

        // Create canonical query string (must be sorted)
        var canonicalQueryString = '';
        if (queryString) {
            var params = queryString.split('&').map(function(param) {
                var parts = param.split('=');
                return {
                    key: parts[0],
                    value: parts[1] || ''
                };
            });
            params.sort(function(a, b) {
                return a.key.localeCompare(b.key);
            });
            canonicalQueryString = params.map(function(p) {
                return p.key + '=' + p.value;
            }).join('&');
        }

        // Create canonical request
        var sortedHeaderKeys = Object.keys(headers).sort();
        var canonicalHeaders = sortedHeaderKeys.map(function(k) {
            return k.toLowerCase() + ':' + headers[k].trim();
        }).join('\n') + '\n';
        var signedHeaders = sortedHeaderKeys.map(function(k) {
            return k.toLowerCase();
        }).join(';');

        return self.sha256(body || '').then(function(payloadHash) {
            var canonicalRequest = [
                method,
                canonicalPath,
                canonicalQueryString,
                canonicalHeaders,
                signedHeaders,
                payloadHash
            ].join('\n');

            console.log('[Bedrock] Canonical request for ListFoundationModels:', canonicalRequest.substring(0, 500));

            return self.sha256(canonicalRequest).then(function(canonicalRequestHash) {
                // Create string to sign
                var algorithm = 'AWS4-HMAC-SHA256';
                var credentialScope = dateStamp + '/' + self.region + '/' + service + '/aws4_request';
                var stringToSign = [
                    algorithm,
                    amzDate,
                    credentialScope,
                    canonicalRequestHash
                ].join('\n');

                // Get signing key and sign
                return self.getSigningKey(credentials.secretAccessKey, dateStamp, self.region, service)
                    .then(function(signingKey) {
                        return self.hmacSha256(signingKey, stringToSign);
                    })
                    .then(function(signatureBuffer) {
                        var signature = Array.from(new Uint8Array(signatureBuffer))
                            .map(function(b) { return b.toString(16).padStart(2, '0'); })
                            .join('');

                        // Create authorization header
                        var authorizationHeader = algorithm + ' ' +
                            'Credential=' + credentials.accessKeyId + '/' + credentialScope + ', ' +
                            'SignedHeaders=' + signedHeaders + ', ' +
                            'Signature=' + signature;

                        headers['Authorization'] = authorizationHeader;
                        return headers;
                    });
            });
        });
    };

    /**
     * Get cached or fetch foundation models
     * @param {string} idToken - The Cognito ID token  
     * @returns {Promise<Array>} - List of available models
     */
    BedrockService.prototype.getAvailableModels = function(idToken) {
        var self = this;
        
        // Return cached models if available and not expired (cache for 5 minutes)
        if (this.cachedModels && this.modelsCacheExpiry && Date.now() < this.modelsCacheExpiry) {
            return Promise.resolve(this.cachedModels);
        }
        
        // Also fetch inference profiles (includes cross-region inference profiles like Claude 4)
        var modelsPromise = this.listFoundationModels(idToken, {})
            .catch(function(error) {
                console.error('[Bedrock] Error listing foundation models:', error);
                return [];
            });
        
        var profilesPromise = this.listInferenceProfiles(idToken)
            .catch(function(error) {
                console.error('[Bedrock] Error listing inference profiles:', error);
                return [];
            });
        
        return Promise.all([modelsPromise, profilesPromise])
            .then(function(results) {
                var foundationModels = results[0] || [];
                var inferenceProfiles = results[1] || [];
                
                // Combine both lists, preference to inference profiles
                var profileIds = new Set(inferenceProfiles.map(function(p) { return p.modelId; }));
                var combinedModels = inferenceProfiles.slice();
                
                // Add foundation models that don't have a corresponding inference profile
                foundationModels.forEach(function(model) {
                    if (!profileIds.has(model.modelId)) {
                        combinedModels.push(model);
                    }
                });
                
                console.log('[Bedrock] Combined models:', combinedModels.length, 
                    '(foundation:', foundationModels.length, ', profiles:', inferenceProfiles.length, ')');
                
                self.cachedModels = combinedModels;
                self.modelsCacheExpiry = Date.now() + (5 * 60 * 1000); // 5 minute cache
                return combinedModels;
            });
    };

    /**
     * List inference profiles from Bedrock
     * @param {string} idToken - The Cognito ID token
     * @returns {Promise<Array>} - List of inference profiles
     */
    BedrockService.prototype.listInferenceProfiles = function(idToken) {
        var self = this;

        return this.getCredentials(idToken)
            .then(function(credentials) {
                var url = 'https://bedrock.' + self.region + '.amazonaws.com/inference-profiles';

                var headers = {
                    'Content-Type': 'application/json'
                };

                return self.signRequestWithQuery('GET', url, '', headers, '', credentials)
                    .then(function(signedHeaders) {
                        return fetch(url, {
                            method: 'GET',
                            headers: signedHeaders
                        });
                    });
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        console.error('[Bedrock] ListInferenceProfiles failed:', response.status, text);
                        throw new Error('ListInferenceProfiles failed: ' + response.status);
                    });
                }
                return response.json();
            })
            .then(function(data) {
                console.log('[Bedrock] ListInferenceProfiles response:', data);
                
                // Map inference profiles to model-like structure
                var profiles = (data.inferenceProfileSummaries || []).map(function(profile) {
                    return {
                        modelId: profile.inferenceProfileArn || profile.inferenceProfileId,
                        modelName: profile.inferenceProfileName || profile.inferenceProfileId,
                        providerName: 'Inference Profile',
                        inferenceTypesSupported: ['ON_DEMAND'],
                        inputModalities: ['TEXT'],
                        outputModalities: ['TEXT'],
                        isInferenceProfile: true
                    };
                });
                
                return profiles;
            });
    };

    /**
     * Set the current model ID
     * @param {string} modelId - The model ID to use
     */
    BedrockService.prototype.setModelId = function(modelId) {
        this.currentModelId = modelId;
        console.log('[Bedrock] Model set to:', modelId);
    };

    /**
     * Get the current model ID
     * @returns {string} - Current model ID or default
     */
    BedrockService.prototype.getModelId = function() {
        return this.currentModelId || 'backend-default';
    };

    /**
     * Send a message to Bedrock using Converse API with streaming
     */
    BedrockService.prototype.sendMessageStream = function(message, idToken, modelId, callbacks) {
        callbacks = callbacks || {};
        var error = new Error('Direct browser Bedrock model invocation is disabled. The frontend must call the AgentCore backend runtime.');
        if (callbacks.onError) callbacks.onError(error);
        return Promise.reject(error);
    };

    BedrockService.prototype._disabledSendMessageStream = function(message, idToken, modelId, callbacks) {
        var self = this;
        var controller = this.createAbortController();
        
        callbacks = callbacks || {};
        var onChunk = callbacks.onChunk || function() {};
        var onToolUse = callbacks.onToolUse || function() {};
        var onComplete = callbacks.onComplete || function() {};
        var onError = callbacks.onError || function() {};

        modelId = modelId || this.getModelId();

        // Build messages
        var messages = this.conversationHistory.slice();
        if (message !== null) {
            messages.push({
                role: 'user',
                content: [{ text: message }]
            });
        }

        // Build request body
        var requestBody = {
            modelId: modelId,
            messages: messages
        };

        // Add system prompt
        var systemPrompt = this.getSystemPromptWithDate();
        if (systemPrompt) {
            requestBody.system = [{ text: systemPrompt }];
        }

        // Add tools if available
        if (this.toolSpecs && this.toolSpecs.length > 0) {
            requestBody.toolConfig = {
                tools: this.toolSpecs
            };
        }

        var url = 'direct-browser-bedrock-disabled';

        // Log the complete message block being sent to the agent
        console.log('[Bedrock] === COMPLETE MESSAGE BLOCK SENT TO AGENT ===');
        console.log('[Bedrock] Model:', modelId);
        console.log('[Bedrock] System Prompt:', requestBody.system ? requestBody.system[0].text.substring(0, 500) + '...' : 'None');
        console.log('[Bedrock] Messages (' + requestBody.messages.length + ' total):');
        requestBody.messages.forEach(function(msg, index) {
            console.log('[Bedrock]   [' + index + '] Role: ' + msg.role);
            if (msg.content) {
                msg.content.forEach(function(contentBlock, cIndex) {
                    if (contentBlock.text) {
                        var textPreview = contentBlock.text.length > 200 ? 
                            contentBlock.text.substring(0, 200) + '... (' + contentBlock.text.length + ' chars)' : 
                            contentBlock.text;
                        console.log('[Bedrock]       [' + cIndex + '] text: ' + textPreview);
                    }
                    if (contentBlock.toolUse) {
                        console.log('[Bedrock]       [' + cIndex + '] toolUse: ' + contentBlock.toolUse.name + ' (id: ' + contentBlock.toolUse.toolUseId + ')');
                        console.log('[Bedrock]         input: ' + JSON.stringify(contentBlock.toolUse.input).substring(0, 200));
                    }
                    if (contentBlock.toolResult) {
                        var resultPreview = JSON.stringify(contentBlock.toolResult.content).substring(0, 200);
                        console.log('[Bedrock]       [' + cIndex + '] toolResult: id=' + contentBlock.toolResult.toolUseId + ', result=' + resultPreview);
                    }
                });
            }
        });
        if (requestBody.toolConfig) {
            console.log('[Bedrock] Tools configured: ' + requestBody.toolConfig.tools.length);
        }
        console.log('[Bedrock] === END MESSAGE BLOCK ===');

        return this.getCredentials(idToken)
            .then(function(credentials) {
                var headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.amazon.eventstream'
                };
                var body = JSON.stringify(requestBody);

                return self.signRequest('POST', url, headers, body, credentials)
                    .then(function(signedHeaders) {
                        return fetch(url, {
                            method: 'POST',
                            headers: signedHeaders,
                            body: body,
                            signal: controller.signal
                        });
                    });
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        throw new Error('Bedrock request failed: ' + response.status + ' - ' + text);
                    });
                }

                // Process AWS Event Stream (binary format)
                var reader = response.body.getReader();
                var fullResponse = '';
                var assistantContent = [];
                var toolUses = [];
                var stopReason = null;
                var bufferArray = null; // ArrayBuffer for incomplete messages
                var currentToolInput = '';
                var currentToolUseId = null;
                var currentContentBlockIndex = -1; // Track which content block we're in
                var contentBlockTexts = {}; // Track text per content block index
                var usage = null;
                var metrics = null;

                function processEvents(events) {
                    console.log('[Bedrock] Processing', events.length, 'events');
                    events.forEach(function(event) {
                        console.log('[Bedrock] Event:', JSON.stringify(event).substring(0, 200));
                        
                        // Handle Bedrock ConverseStream event format
                        // The actual format has delta/start/stopReason at top level, not nested
                        
                        // Content block delta (text streaming)
                        // Format: {"contentBlockIndex":0,"delta":{"text":"Hello"},"p":"..."}
                        if (event.delta) {
                            // Track content block index
                            var blockIndex = event.contentBlockIndex !== undefined ? event.contentBlockIndex : currentContentBlockIndex;
                            
                            if (event.delta.text) {
                                // Initialize content block text tracking if needed
                                if (!contentBlockTexts[blockIndex]) {
                                    contentBlockTexts[blockIndex] = { type: 'text', content: '' };
                                }
                                // Only append text if this is a text block (not tool input)
                                if (contentBlockTexts[blockIndex].type === 'text') {
                                    contentBlockTexts[blockIndex].content += event.delta.text;
                                    fullResponse += event.delta.text;
                                    onChunk(event.delta.text);
                                }
                            }
                            // Tool input JSON streaming - accumulate on the toolUse object directly
                            if (event.delta.toolUse && event.delta.toolUse.input !== undefined) {
                                // Find the last tool use in the array and accumulate input there
                                var lastToolUse = toolUses[toolUses.length - 1];
                                if (lastToolUse) {
                                    if (!lastToolUse.inputJson) {
                                        lastToolUse.inputJson = '';
                                    }
                                    lastToolUse.inputJson += event.delta.toolUse.input;
                                }
                            }
                        }
                        
                        // Legacy format support (contentBlockDelta wrapper)
                        if (event.contentBlockDelta && event.contentBlockDelta.delta) {
                            var delta = event.contentBlockDelta.delta;
                            var legacyBlockIndex = event.contentBlockDelta.contentBlockIndex !== undefined ? 
                                event.contentBlockDelta.contentBlockIndex : currentContentBlockIndex;
                            
                            if (delta.text) {
                                if (!contentBlockTexts[legacyBlockIndex]) {
                                    contentBlockTexts[legacyBlockIndex] = { type: 'text', content: '' };
                                }
                                if (contentBlockTexts[legacyBlockIndex].type === 'text') {
                                    contentBlockTexts[legacyBlockIndex].content += delta.text;
                                    fullResponse += delta.text;
                                    onChunk(delta.text);
                                }
                            }
                            if (delta.toolUse && delta.toolUse.input) {
                                currentToolInput += delta.toolUse.input;
                            }
                        }

                        // Content block start (tool use beginning)
                        // Format: {"contentBlockIndex":0,"start":{"toolUse":{"name":"...", "toolUseId":"..."}},"p":"..."}
                        if (event.start) {
                            // Update current content block index
                            if (event.contentBlockIndex !== undefined) {
                                currentContentBlockIndex = event.contentBlockIndex;
                            }
                            
                            if (event.start.toolUse) {
                                // Mark this content block as a tool use block
                                contentBlockTexts[currentContentBlockIndex] = { type: 'toolUse', content: '' };
                                
                                currentToolUseId = event.start.toolUse.toolUseId;
                                currentToolInput = '';
                                var tu = {
                                    id: event.start.toolUse.toolUseId,
                                    name: event.start.toolUse.name,
                                    input: {},
                                    status: 'pending'
                                };
                                toolUses.push(tu);
                                onToolUse(tu);
                            }
                        }
                        
                        // Legacy format support
                        if (event.contentBlockStart) {
                            if (event.contentBlockStart.contentBlockIndex !== undefined) {
                                currentContentBlockIndex = event.contentBlockStart.contentBlockIndex;
                            }
                            
                            if (event.contentBlockStart.start && event.contentBlockStart.start.toolUse) {
                                contentBlockTexts[currentContentBlockIndex] = { type: 'toolUse', content: '' };
                                
                                var start = event.contentBlockStart.start;
                                currentToolUseId = start.toolUse.toolUseId;
                                currentToolInput = '';
                                var tu2 = {
                                    id: start.toolUse.toolUseId,
                                    name: start.toolUse.name,
                                    input: {},
                                    status: 'pending'
                                };
                                toolUses.push(tu2);
                                onToolUse(tu2);
                            }
                        }

                        // Content block stop
                        // Format: {"contentBlockIndex":0,"p":"..."}  (just has contentBlockIndex, no delta)
                        if (event.contentBlockIndex !== undefined && !event.delta && !event.start) {
                            // Parse tool use input if present (accumulated as inputJson)
                            var lastToolUse = toolUses[toolUses.length - 1];
                            if (lastToolUse && lastToolUse.inputJson) {
                                try {
                                    lastToolUse.input = JSON.parse(lastToolUse.inputJson);
                                    console.log('[Bedrock] Parsed tool input:', lastToolUse.input);
                                } catch (e) {
                                    console.warn('[Bedrock] Failed to parse tool input:', lastToolUse.inputJson);
                                    lastToolUse.input = {};
                                }
                                delete lastToolUse.inputJson;
                            }
                            // Add text content to assistant content
                            if (fullResponse) {
                                var hasText = assistantContent.some(function(c) { return c.text; });
                                if (!hasText) {
                                    assistantContent.push({ text: fullResponse });
                                }
                            }
                        }

                        // Message stop
                        // Format: {"p":"...","stopReason":"end_turn"}
                        if (event.stopReason) {
                            stopReason = event.stopReason;
                        }
                        
                        // Legacy format
                        if (event.messageStop && event.messageStop.stopReason) {
                            stopReason = event.messageStop.stopReason;
                        }

                        // Message start (role info)
                        // Format: {"p":"...","role":"assistant"}
                        if (event.role) {
                            // Role info - typically "assistant"
                        }

                        // Metadata (usage info)
                        // Format: {"metrics":{...},"p":"...","usage":{...}}
                        if (event.usage) {
                            usage = event.usage;
                            console.log('[Bedrock] Usage data:', usage);
                        }
                        if (event.metrics) {
                            metrics = event.metrics;
                            console.log('[Bedrock] Metrics data:', metrics);
                        }
                        
                        // Also check amazon-bedrock-invocationMetrics wrapper (some models)
                        if (event['amazon-bedrock-invocationMetrics']) {
                            metrics = event['amazon-bedrock-invocationMetrics'];
                            console.log('[Bedrock] Invocation metrics:', metrics);
                        }
                    });
                }

                function processStream() {
                    return reader.read().then(function(result) {
                        if (result.done) {
                            // Finalize
                            if (message !== null) {
                                self.conversationHistory.push({
                                    role: 'user',
                                    content: [{ text: message }]
                                });
                            }
                            
                            // Build assistant content for history
                            var historyContent = [];
                            if (fullResponse) {
                                historyContent.push({ text: fullResponse });
                            }
                            toolUses.forEach(function(tu) {
                                historyContent.push({
                                    toolUse: {
                                        toolUseId: tu.id,
                                        name: tu.name,
                                        input: tu.input
                                    }
                                });
                            });
                            
                            if (historyContent.length > 0) {
                                self.conversationHistory.push({
                                    role: 'assistant',
                                    content: historyContent
                                });
                            }

                            self.removeAbortController(controller);

                            var completionResult = {
                                response: fullResponse,
                                stopReason: stopReason,
                                toolUses: toolUses,
                                conversationHistory: self.conversationHistory,
                                usage: usage,
                                metrics: metrics
                            };
                            onComplete(completionResult);
                            return completionResult;
                        }

                        // Combine with any remaining buffer from previous read
                        var newData = result.value;
                        var combined;
                        if (bufferArray) {
                            combined = new Uint8Array(bufferArray.byteLength + newData.byteLength);
                            combined.set(bufferArray, 0);
                            combined.set(newData, bufferArray.byteLength);
                        } else {
                            combined = newData;
                        }

                        // Parse event stream messages
                        var parseResult = self.parseEventStream(combined);
                        processEvents(parseResult.messages);
                        bufferArray = parseResult.remaining;

                        return processStream();
                    });
                }

                return processStream();
            })
            .catch(function(error) {
                self.removeAbortController(controller);
                
                if (error.name === 'AbortError') {
                    console.log('[Bedrock] Request aborted');
                    onError(new Error('Request was aborted'));
                    return { response: '', aborted: true };
                }

                console.error('[Bedrock] Error:', error);
                onError(error);
                throw error;
            });
    };

    /**
     * Get system prompt with current date and default instructions
     */
    BedrockService.prototype.getSystemPromptWithDate = function() {
        var now = new Date();
        var dateString = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        var timeString = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        
        var dateInfo = 'Current date and time: ' + dateString + ' at ' + timeString;
        
        // Agent identity
        var identity = '\n\nYou are Hank, a helpful AI assistant. Always refer to yourself as Hank when introducing yourself or when asked your name. ' +
            'Be friendly, helpful, and professional. You have access to various tools through MCP servers to help accomplish tasks.';
        
        // Default instructions for tool usage
        var toolInstructions = '\n\nIMPORTANT: When calling tools, you MUST use the exact tool name as provided by the MCP server. ' +
            'Tool names may contain special characters like underscores (e.g., "tool___toolname", "module__function"). ' +
            'Do NOT modify, simplify, or rename tools - call them exactly as they appear in the tool list. ' +
            'The tool name format (including any prefixes, separators, or suffixes) is intentional and required for proper routing.';
        
        var planningInstructions = '\n\n## PUBLIC PLANNING TOOLS\n\n' +
            'Use the public synthetic portfolio-planning gateway tools when the user asks about portfolio workflows.\n' +
            '- For portfolio setup: list-portfolios, get-portfolio-snapshot, get-market-context.\n' +
            '- For planning: run-portfolio-optimization, get-simulation-status, get-simulation-results, explain-trade-plan.\n' +
            '- For weekly review: run-what-if-analysis, record-weekly-review, generate-weekly-plan-report.\n' +
            '- Always use the exact tool names returned by the gateway. Use only synthetic data returned by the tools.\n' +
            '- Always state that current output is synthetic and not financial advice.';
        
        if (this.systemPrompt && this.systemPrompt.trim()) {
            return dateInfo + identity + toolInstructions + planningInstructions + '\n\n' + this.systemPrompt;
        }
        
        return dateInfo + identity + toolInstructions + planningInstructions;
    };

    /**
     * Maximum characters per tool result to prevent exceeding Bedrock's context window.
     * ~4 chars per token, 200k token limit, leave room for system prompt + history.
     * 100k chars ≈ 25k tokens is a safe limit per individual tool result.
     */
    BedrockService.MAX_TOOL_RESULT_CHARS = 100000;

    /**
     * Truncate a tool result string if it exceeds the maximum allowed size.
     * Preserves the beginning and end of the result for context, and adds
     * a truncation notice in the middle.
     */
    BedrockService.prototype.truncateToolResult = function(resultText) {
        var maxChars = BedrockService.MAX_TOOL_RESULT_CHARS;
        if (!resultText || resultText.length <= maxChars) {
            return resultText;
        }

        var originalLength = resultText.length;
        var keepChars = Math.floor((maxChars - 200) / 2); // Split between head and tail, minus notice
        var head = resultText.substring(0, keepChars);
        var tail = resultText.substring(originalLength - keepChars);
        var truncationNotice = '\n\n... [TRUNCATED: Result was ' + originalLength + ' chars, ' +
            'exceeding ' + maxChars + ' char limit. ' +
            (originalLength - maxChars) + ' chars omitted from middle. ' +
            'Ask the user to narrow their query for complete data.] ...\n\n';

        console.warn('[Bedrock] Tool result truncated from ' + originalLength + ' to ~' + maxChars + ' chars');
        return head + truncationNotice + tail;
    };

    /**
     * Continue conversation with tool results
     */
    BedrockService.prototype.continueWithToolResults = function(toolResults, idToken, modelId, callbacks) {
        callbacks = callbacks || {};
        var error = new Error('Direct browser Bedrock model invocation is disabled. The frontend must call the AgentCore backend runtime.');
        if (callbacks.onError) callbacks.onError(error);
        return Promise.reject(error);
    };

    BedrockService.prototype._disabledContinueWithToolResults = function(toolResults, idToken, modelId, callbacks) {
        var self = this;

        // Add tool results to history (with truncation for oversized results)
        this.conversationHistory.push({
            role: 'user',
            content: toolResults.map(function(tr) {
                var resultText = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
                resultText = self.truncateToolResult(resultText);
                return {
                    toolResult: {
                        toolUseId: tr.toolUseId,
                        content: [{ text: resultText }]
                    }
                };
            })
        });

        // Continue with null message
        return this.sendMessageStream(null, idToken, modelId, callbacks);
    };

    // Export as singleton
    window.BedrockService = new BedrockService();

})();

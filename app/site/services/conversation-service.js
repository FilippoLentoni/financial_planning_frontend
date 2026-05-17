/**
 * Conversation Service - Manages conversation persistence via API Gateway
 * 
 * Uses SigV4-signed requests to the conversations API endpoints.
 * Handles saving, listing, loading, and deleting conversations.
 * Auto-saves conversation state after each AI response.
 */

(function() {
    'use strict';

    function ConversationService() {
        this.currentConversationId = null;
        this.saveInProgress = false;
        this.saveQueue = null; // Queued save while one is in progress
        this.listeners = []; // onChange listeners
        this.remoteAvailable = true;
    }

    // ============================================================
    // Configuration
    // ============================================================

    /**
     * Get the API base URL for conversations endpoint
     */
    ConversationService.prototype.getApiBaseUrl = function() {
        var config = window.APP_CONFIG || {};
        var apiBaseUrl = config.apiBaseUrl || '';
        return apiBaseUrl.replace(/\/+$/, '');
    };

    /**
     * Get the current conversation ID
     */
    ConversationService.prototype.getCurrentConversationId = function() {
        return this.currentConversationId;
    };

    /**
     * Set the current conversation ID
     */
    ConversationService.prototype.setCurrentConversationId = function(id) {
        this.currentConversationId = id;
    };

    /**
     * Clear the current conversation (start fresh)
     */
    ConversationService.prototype.clearCurrentConversation = function() {
        this.currentConversationId = null;
        this._notifyListeners();
    };

    // ============================================================
    // Event Listeners
    // ============================================================

    /**
     * Register a listener for conversation changes
     * @param {Function} callback - Called when conversation list changes
     */
    ConversationService.prototype.onChange = function(callback) {
        this.listeners.push(callback);
    };

    /**
     * Remove a listener
     */
    ConversationService.prototype.removeListener = function(callback) {
        this.listeners = this.listeners.filter(function(cb) { return cb !== callback; });
    };

    /**
     * Notify all listeners of a change
     */
    ConversationService.prototype._notifyListeners = function() {
        this.listeners.forEach(function(cb) {
            try { cb(); } catch (e) { console.error('[Conversations] Listener error:', e); }
        });
    };

    // ============================================================
    // SigV4-Signed API Calls
    // ============================================================

    /**
     * Make a SigV4-signed request to the conversations API
     * Reuses BedrockService's credential management and signing
     *
     * @param {string} method - HTTP method (GET, POST, DELETE)
     * @param {string} path - API path (e.g., '/conversations')
     * @param {string} queryString - Optional query string
     * @param {Object|null} body - Request body for POST
     * @returns {Promise<Object>} - Parsed JSON response
     */
    ConversationService.prototype._apiRequest = function(method, apiPath, queryString, body) {
        var self = this;
        var bedrockService = window.BedrockService;
        
        if (!bedrockService) {
            return Promise.reject(new Error('BedrockService not available'));
        }

        var idToken = window.AuthService ? window.AuthService.getIdToken() : null;
        if (!idToken) {
            return Promise.reject(new Error('No ID token available'));
        }

        var baseUrl = this.getApiBaseUrl();
        if (!baseUrl) {
            return Promise.reject(new Error('API base URL not configured'));
        }

        var url = baseUrl + apiPath;
        if (queryString) {
            url += '?' + queryString;
        }

        var bodyStr = body ? JSON.stringify(body) : '';
        var region = bedrockService.region || 'us-east-1';
        var service = 'execute-api';

        return bedrockService.getCredentials(idToken)
            .then(function(credentials) {
                var urlObj = new URL(url);
                var host = urlObj.host;
                var path = urlObj.pathname;

                var now = new Date();
                var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
                var dateStamp = amzDate.substring(0, 8);

                var headers = {
                    'host': host,
                    'x-amz-date': amzDate
                };

                if (body) {
                    headers['content-type'] = 'application/json';
                }

                if (credentials.sessionToken) {
                    headers['x-amz-security-token'] = credentials.sessionToken;
                }

                var sortedHeaderKeys = Object.keys(headers).sort();
                var canonicalHeaders = sortedHeaderKeys.map(function(k) {
                    return k + ':' + headers[k].trim();
                }).join('\n') + '\n';
                var signedHeaders = sortedHeaderKeys.join(';');

                // Build canonical query string
                var canonicalQueryString = '';
                if (queryString) {
                    var params = queryString.split('&').map(function(param) {
                        var parts = param.split('=');
                        return { key: parts[0], value: parts[1] || '' };
                    });
                    params.sort(function(a, b) { return a.key.localeCompare(b.key); });
                    canonicalQueryString = params.map(function(p) { return p.key + '=' + p.value; }).join('&');
                }

                return bedrockService.sha256(bodyStr).then(function(payloadHash) {
                    var canonicalRequest = [
                        method, path, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash
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

                                // Build fetch headers (exclude 'host' as fetch adds it)
                                var fetchHeaders = {
                                    'X-Amz-Date': amzDate,
                                    'Authorization': authHeader
                                };
                                if (body) {
                                    fetchHeaders['Content-Type'] = 'application/json';
                                }
                                if (credentials.sessionToken) {
                                    fetchHeaders['X-Amz-Security-Token'] = credentials.sessionToken;
                                }

                                var fetchOptions = {
                                    method: method,
                                    headers: fetchHeaders
                                };
                                if (body) {
                                    fetchOptions.body = bodyStr;
                                }

                                return fetch(url, fetchOptions);
                            });
                    });
                });
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        var error = new Error('Conversations API error ' + response.status + ': ' + text);
                        if (response.status === 403 || response.status === 404) {
                            self.remoteAvailable = false;
                            error.conversationApiUnavailable = true;
                        }
                        throw error;
                    });
                }
                return response.json();
            });
    };

    // ============================================================
    // CRUD Operations
    // ============================================================

    /**
     * List conversations for the current user
     * @param {number} limit - Max conversations to return (default 50)
     * @returns {Promise<Object>} - { conversations: [...], nextToken?: string }
     */
    ConversationService.prototype.listConversations = function(limit) {
        if (!this.remoteAvailable) {
            return Promise.resolve({ conversations: [] });
        }
        var queryString = 'limit=' + (limit || 50);
        return this._apiRequest('GET', '/conversations', queryString, null)
            .catch(function(error) {
                if (error && error.conversationApiUnavailable) {
                    return { conversations: [] };
                }
                throw error;
            });
    };

    /**
     * Get a single conversation with full message history
     * @param {string} conversationId - The conversation ID
     * @returns {Promise<Object>} - Full conversation object with messages
     */
    ConversationService.prototype.getConversation = function(conversationId) {
        return this._apiRequest('GET', '/conversations/' + encodeURIComponent(conversationId), '', null);
    };

    /**
     * Save a conversation (create or update)
     * @param {Object} data - { conversationId?, title?, messages, modelId? }
     * @returns {Promise<Object>} - { conversationId, title, updatedAt, isNew }
     */
    ConversationService.prototype.saveConversation = function(data) {
        var self = this;
        if (!this.remoteAvailable) {
            return Promise.resolve({
                conversationId: this.currentConversationId,
                messageCount: data && data.messages ? data.messages.length : 0,
                isNew: false
            });
        }
        return this._apiRequest('POST', '/conversations', '', data)
            .then(function(result) {
                // Update current conversation ID if this was a new conversation
                if (result.isNew || !self.currentConversationId) {
                    self.currentConversationId = result.conversationId;
                }
                self._notifyListeners();
                return result;
            });
    };

    /**
     * Delete a conversation
     * @param {string} conversationId - The conversation ID
     * @returns {Promise<Object>} - { deleted: true, conversationId }
     */
    ConversationService.prototype.deleteConversation = function(conversationId) {
        var self = this;
        return this._apiRequest('DELETE', '/conversations/' + encodeURIComponent(conversationId), '', null)
            .then(function(result) {
                // If we deleted the current conversation, clear it
                if (self.currentConversationId === conversationId) {
                    self.currentConversationId = null;
                }
                self._notifyListeners();
                return result;
            });
    };

    // ============================================================
    // Auto-Save Logic
    // ============================================================

    /**
     * Auto-save the current conversation after an AI response completes.
     * Debounces saves to avoid excessive API calls.
     *
     * @param {Array} messages - The Bedrock Converse messages array
     * @param {string} modelId - The model ID used
     */
    ConversationService.prototype.autoSave = function(messages, modelId) {
        var self = this;

        if (!messages || messages.length === 0) return;

        var data = {
            messages: messages,
            modelId: modelId || undefined
        };

        // Include conversationId if we're updating an existing conversation
        if (this.currentConversationId) {
            data.conversationId = this.currentConversationId;
        }

        // If a save is in progress, queue this save
        if (this.saveInProgress) {
            this.saveQueue = data;
            return;
        }

        this.saveInProgress = true;

        this.saveConversation(data)
            .then(function(result) {
                console.log('[Conversations] Auto-saved:', result.conversationId, '(' + result.messageCount + ' messages)');
                self.saveInProgress = false;

                // Process queued save if any
                if (self.saveQueue) {
                    var queued = self.saveQueue;
                    self.saveQueue = null;
                    // Use the updated conversationId
                    if (!queued.conversationId && self.currentConversationId) {
                        queued.conversationId = self.currentConversationId;
                    }
                    self.autoSave(queued.messages, queued.modelId);
                }
            })
            .catch(function(error) {
                console.error('[Conversations] Auto-save failed:', error);
                self.saveInProgress = false;
                self.saveQueue = null;
            });
    };

    // ============================================================
    // Utility
    // ============================================================

    /**
     * Format a relative time string from an ISO date
     * @param {string} isoDate - ISO 8601 date string
     * @returns {string} - Relative time (e.g., "5 min ago", "2 hours ago", "Jan 15")
     */
    ConversationService.prototype.formatRelativeTime = function(isoDate) {
        if (!isoDate) return '';

        var now = new Date();
        var date = new Date(isoDate);
        var diffMs = now - date;
        var diffSec = Math.floor(diffMs / 1000);
        var diffMin = Math.floor(diffSec / 60);
        var diffHour = Math.floor(diffMin / 60);
        var diffDay = Math.floor(diffHour / 24);

        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return diffMin + ' min ago';
        if (diffHour < 24) return diffHour + 'h ago';
        if (diffDay < 7) return diffDay + 'd ago';

        // Older than a week - show date
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[date.getMonth()] + ' ' + date.getDate();
    };

    // Export as singleton
    window.ConversationService = new ConversationService();

})();

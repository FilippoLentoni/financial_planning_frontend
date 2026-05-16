/**
 * Runtime Service - Communicates with AgentCore Runtime via API Gateway proxy
 *
 * Replaces direct Bedrock Converse API calls. The AgentCore Runtime handles:
 * - LLM orchestration (Bedrock calls, tool routing, memory management)
 * - MCP tool invocation (server-side, no browser CORS issues)
 * - Session/conversation management
 *
 * Two transport tiers:
 *   1. REST proxy  — POST /runtime/invoke (synchronous, full response)
 *   2. WebSocket   — wss:// RuntimeStream API (real-time streaming)
 *
 * Both use SigV4 auth via Cognito Identity Pool credentials (BedrockService).
 */

(function() {
    'use strict';

    function RuntimeService() {
        // Configuration
        this.restUrl = null;       // e.g. https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/runtime/invoke
        this.wsUrl = null;         // e.g. wss://{ws-api-id}.execute-api.{region}.amazonaws.com/{stage}
        this.runtimeArn = null;    // e.g. arn:aws:bedrock-agentcore:{region}:{account}:runtime/financial_planning_...
        this.region = null;

        // WebSocket state
        this.ws = null;
        this.connected = false;
        this.reconnectTimeout = null;
        this.heartbeatInterval = null;

        // Active invocations keyed by sessionId
        this._pendingInvocations = new Map();

        // Abort controllers for REST requests
        this._activeAbortControllers = new Set();

        // Fallback: if true, use legacy direct-Bedrock path (for gradual rollout)
        this.useLegacyMode = false;
    }

    // ================================================================
    // Configuration
    // ================================================================

    /**
     * Configure the runtime service.
     * @param {Object} config
     * @param {string} config.apiBaseUrl       - REST API base URL (trailing slash stripped)
     * @param {string} config.runtimeWsUrl     - WebSocket URL for streaming
     * @param {string} config.runtimeEndpoint  - AgentCore Runtime invoke URL
     *        (e.g. https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{name}/endpoints/default/invoke)
     * @param {string} config.runtimeArn       - (optional) Direct ARN override
     * @param {string} config.region           - AWS region
     */
    RuntimeService.prototype.configure = function(config) {
        config = config || {};
        var apiBaseUrl = this._cleanConfigValue(config.apiBaseUrl).replace(/\/+$/, '');
        this.restUrl = apiBaseUrl ? apiBaseUrl + '/runtime/invoke' : null;
        this.wsUrl = this._cleanConfigValue(config.runtimeWsUrl) || null;
        this.region = this._cleanConfigValue(config.region) || 'us-east-1';

        // Use runtimeArn directly when provided (preferred — exact ARN from CDK CfnOutput).
        // Falls back to extracting the runtime name from the endpoint URL, but that approach
        // can't resolve the CDK-generated suffix (e.g. financial_planning_beta-2SqAABFAi3).
        this.runtimeArn = null;
        this._runtimeEndpoint = this._cleanConfigValue(config.runtimeEndpoint) || null;
        this._runtimeName = null;

        var cleanedRuntimeArn = this._cleanConfigValue(config.runtimeArn);
        if (cleanedRuntimeArn && this._isRealValue(cleanedRuntimeArn)) {
            this.runtimeArn = cleanedRuntimeArn;
            // Also extract the runtime name for validation/logging
            var arnMatch = cleanedRuntimeArn.match(/runtime\/(.+)$/);
            if (arnMatch) this._runtimeName = arnMatch[1];
            console.log('[RuntimeService] Using injected runtimeArn:', this.runtimeArn);
        } else if (this._runtimeEndpoint && this._isRealValue(this._runtimeEndpoint)) {
            // Fallback: extract runtime name from endpoint URL
            var match = this._runtimeEndpoint.match(/\/runtimes\/([^\/]+)\//);
            if (match) {
                this._runtimeName = match[1];
                console.log('[RuntimeService] Extracted runtime name from endpoint:', this._runtimeName);
            }
        }

        if (!this._runtimeEndpoint && this.runtimeArn) {
            var arnParts = this.runtimeArn.match(/^arn:aws:bedrock-agentcore:([^:]+):[^:]+:runtime\/(.+)$/);
            if (arnParts) {
                this._runtimeEndpoint =
                    'https://bedrock-agentcore.' + arnParts[1] + '.amazonaws.com/runtimes/' +
                    arnParts[2] + '/endpoints/default/invoke';
                this._runtimeName = arnParts[2];
                console.log('[RuntimeService] Built runtime endpoint from ARN:', this._runtimeEndpoint);
            }
        }

        console.log('[RuntimeService] Configured:', {
            restUrl: this.restUrl,
            wsUrl: this.wsUrl ? this.wsUrl.substring(0, 60) + '...' : null,
            runtimeName: this._runtimeName,
            runtimeArn: this.runtimeArn,
            region: this.region
        });

        // Pre-connect WebSocket eagerly to eliminate connection latency on first message.
        // This runs in the background — if it fails, invokeStream will retry on demand.
        if (this.wsUrl && !this.connected) {
            var self = this;
            setTimeout(function() {
                if (!self.connected && self.wsUrl) {
                    console.log('[RuntimeService] Pre-connecting WebSocket...');
                    self.connectWebSocket().then(function() {
                        console.log('[RuntimeService] WebSocket pre-connected (ready for instant streaming)');
                    }).catch(function(err) {
                        console.debug('[RuntimeService] Pre-connect failed (will retry on invoke):', err.message);
                    });
                }
            }, 100); // Small delay to let credentials settle
        }
    };

    /**
     * Build the full runtime ARN from credentials + extracted runtime name.
     * Called lazily at invoke time so we have the AWS account ID from credentials.
     * @returns {string|null} The full ARN or null
     */
    RuntimeService.prototype._buildRuntimeArn = function() {
        if (this.runtimeArn && this._isRealValue(this.runtimeArn)) return this.runtimeArn;
        if (!this._runtimeName) return null;

        // Get account ID from BedrockService credentials
        var bedrockService = window.BedrockService;
        var creds = bedrockService && bedrockService.credentials;
        if (creds && creds.identityId) {
            // identityId format: {region}:{uuid} — extract region, but we need account
            // The account is embedded in the Identity Pool ARN or we can derive from credentials
        }

        // Fallback: construct ARN using region + a wildcard-friendly pattern
        // The REST proxy Lambda only extracts the runtime name from rsplit("/", 1)[-1]
        // So any value ending in /{runtime_name} will work
        var region = this.region || 'us-east-1';
        return 'arn:aws:bedrock-agentcore:' + region + ':000000000000:runtime/' + this._runtimeName;
    };

    /**
     * Check if a value is a real config value (not empty and not an unresolved placeholder).
     * Placeholders look like "##_SOME_KEY_##" when the CloudFront variable injector hasn't replaced them.
     * @param {string} val
     * @returns {boolean}
     */
    RuntimeService.prototype._isRealValue = function(val) {
        if (!val || typeof val !== 'string') return false;
        // Detect unresolved CloudFront variable injection placeholders
        if (val.indexOf('##_') === 0 && val.indexOf('_##') === val.length - 3) return false;
        if (val.indexOf('##_') !== -1) return false; // partial placeholder
        return val.trim().length > 0;
    };

    RuntimeService.prototype._cleanConfigValue = function(val) {
        if (!val || typeof val !== 'string') return '';
        var trimmed = val.trim();
        if (!this._isRealValue(trimmed)) return '';
        return trimmed;
    };

    /**
     * Check if the runtime service is configured and ready.
     * @returns {boolean}
     */
    RuntimeService.prototype.isConfigured = function() {
        var hasRuntime = this._isRealValue(this.runtimeArn) || !!this._runtimeName;
        var hasTransport =
            this._isRealValue(this.restUrl) ||
            this._isRealValue(this.wsUrl) ||
            this._isRealValue(this._runtimeEndpoint);
        return hasRuntime && hasTransport;
    };

    /**
     * Check if we should use legacy (direct Bedrock) mode.
     * Returns true when runtime is not configured or explicitly set to legacy.
     */
    RuntimeService.prototype.shouldUseLegacy = function() {
        return this.useLegacyMode || !this.isConfigured();
    };

    // ================================================================
    // REST Proxy — synchronous invoke
    // ================================================================

    /**
     * Invoke the runtime via REST proxy (synchronous full response).
     *
     * @param {string} userMessage - The user's message text
     * @param {string} [sessionId] - Optional session ID for conversation continuity
     * @param {Object} [callbacks] - { onComplete, onError }
     * @returns {Promise<Object>} - The full runtime response
     */
    RuntimeService.prototype.invokeRest = function(userMessage, sessionId, callbacks) {
        var self = this;
        callbacks = callbacks || {};

        var resolvedArn = this._buildRuntimeArn();
        if ((!this.restUrl && !this._runtimeEndpoint) || !resolvedArn) {
            var err = new Error('RuntimeService not configured (transport URL or runtimeArn missing)');
            if (callbacks.onError) callbacks.onError(err);
            return Promise.reject(err);
        }
        var isDirectRuntimeEndpoint = !this.restUrl && this._isRealValue(this._runtimeEndpoint);
        if (isDirectRuntimeEndpoint && !/^https:\/\/bedrock-agentcore\.[a-z0-9-]+\.amazonaws\.com\/runtimes\/[^/]+\/endpoints\/[^/]+\/invoke$/.test(this._runtimeEndpoint)) {
            var endpointErr = new Error('RuntimeService has invalid AgentCore endpoint: ' + this._runtimeEndpoint);
            if (callbacks.onError) callbacks.onError(endpointErr);
            return Promise.reject(endpointErr);
        }

        var bedrockService = window.BedrockService;
        if (!bedrockService) {
            var err2 = new Error('BedrockService not available for SigV4 signing');
            if (callbacks.onError) callbacks.onError(err2);
            return Promise.reject(err2);
        }

        var idToken = window.AuthService ? window.AuthService.getIdToken() : null;
        if (!idToken) {
            var err3 = new Error('No ID token available');
            if (callbacks.onError) callbacks.onError(err3);
            return Promise.reject(err3);
        }

        // Build runtime payload — the runtime expects { prompt: "..." }
        var runtimePayload = {
            prompt: userMessage
        };

        var requestBody = isDirectRuntimeEndpoint
            ? runtimePayload
            : {
                runtimeArn: resolvedArn,
                payload: runtimePayload,
                sessionId: sessionId || ''
            };

        var bodyStr = JSON.stringify(requestBody);
        var url = isDirectRuntimeEndpoint ? this._runtimeEndpoint : this.restUrl;
        var signingService = isDirectRuntimeEndpoint ? 'bedrock-agentcore' : 'execute-api';
        var controller = new AbortController();
        self._activeAbortControllers.add(controller);

        return bedrockService.getCredentials(idToken)
            .then(function(credentials) {
                return self._sigv4SignedFetch('POST', url, bodyStr, credentials, controller.signal, signingService);
            })
            .then(function(response) {
                self._activeAbortControllers.delete(controller);
                if (!response.ok) {
                    return response.text().then(function(text) {
                        throw new Error('Runtime invoke failed: ' + response.status + ' - ' + text);
                    });
                }
                return response.text().then(function(text) {
                    try {
                        return JSON.parse(text);
                    } catch (e) {
                        return text;
                    }
                });
            })
            .then(function(data) {
                console.log('[RuntimeService] REST response received');

                // Parse the runtime response
                var result = self._parseRuntimeResponse(data);
                if (callbacks.onComplete) callbacks.onComplete(result);
                return result;
            })
            .catch(function(error) {
                self._activeAbortControllers.delete(controller);
                if (error.name === 'AbortError') {
                    var abortErr = new Error('Request aborted');
                    if (callbacks.onError) callbacks.onError(abortErr);
                    throw abortErr;
                }
                console.error('[RuntimeService] REST invoke error:', error);
                if (callbacks.onError) callbacks.onError(error);
                throw error;
            });
    };

    /**
     * Invoke an IAM-protected backend API route that shares the Runtime API base URL.
     * Used for non-chat application metadata such as model-run summaries.
     */
    RuntimeService.prototype.invokeBackendApi = function(method, path, body) {
        var self = this;
        if (!this.restUrl) {
            return Promise.reject(new Error('RuntimeService REST API base URL is not configured'));
        }
        var baseUrl = this.restUrl.replace(/\/runtime\/invoke$/, '');
        var normalizedPath = path.charAt(0) === '/' ? path : '/' + path;
        var url = baseUrl + normalizedPath;
        var idToken = window.AuthService ? window.AuthService.getIdToken() : null;
        if (!idToken) {
            return Promise.reject(new Error('No ID token available'));
        }
        var bedrockService = window.BedrockService;
        if (!bedrockService) {
            return Promise.reject(new Error('BedrockService not available for SigV4 signing'));
        }
        var upperMethod = (method || 'GET').toUpperCase();
        var bodyStr = body ? JSON.stringify(body) : '';
        return bedrockService.getCredentials(idToken)
            .then(function(credentials) {
                return self._sigv4SignedFetch(upperMethod, url, bodyStr, credentials, null, 'execute-api');
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        throw new Error('Backend API failed: ' + response.status + ' - ' + text);
                    });
                }
                return response.json();
            });
    };

    // ================================================================
    // WebSocket Streaming — real-time token-by-token
    // ================================================================

    /**
     * Connect to the WebSocket streaming API.
     * Uses SigV4 presigned URL (same pattern as WorkflowSocketService).
     *
     * @returns {Promise<void>}
     */
    RuntimeService.prototype.connectWebSocket = function() {
        var self = this;

        if (!this.wsUrl) {
            return Promise.reject(new Error('WebSocket URL not configured'));
        }

        if (this.ws && this.connected) {
            return Promise.resolve();
        }

        return this._signWebSocketUrl(this.wsUrl).then(function(signedUrl) {
            return new Promise(function(resolve, reject) {
                self.ws = new WebSocket(signedUrl);

                self.ws.onopen = function() {
                    console.log('[RuntimeService] WebSocket connected');
                    self.connected = true;
                    self._startHeartbeat();
                    resolve();
                };

                self.ws.onmessage = function(event) {
                    try {
                        var data = JSON.parse(event.data);
                        self._handleWsMessage(data);
                    } catch (e) {
                        console.warn('[RuntimeService] Non-JSON WS message:', event.data);
                    }
                };

                self.ws.onclose = function() {
                    console.log('[RuntimeService] WebSocket disconnected');
                    self.connected = false;
                    self._stopHeartbeat();
                    // Auto-reconnect after 5s
                    self.reconnectTimeout = setTimeout(function() {
                        if (self.wsUrl) self.connectWebSocket();
                    }, 5000);
                };

                self.ws.onerror = function(err) {
                    console.error('[RuntimeService] WebSocket error:', err);
                    reject(err);
                };
            });
        });
    };

    /**
     * Disconnect the WebSocket.
     */
    RuntimeService.prototype.disconnectWebSocket = function() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
        this._stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    };

    /**
     * Invoke the runtime via WebSocket for streaming.
     *
     * @param {string} userMessage - The user's message text
     * @param {string} [sessionId] - Optional session ID
     * @param {Object} callbacks - { onChunk, onEvent, onSessionStart, onComplete, onError }
     * @returns {Promise<void>}
     */
    RuntimeService.prototype.invokeStream = function(userMessage, sessionId, callbacks) {
        var self = this;
        callbacks = callbacks || {};

        var resolvedArn = this._buildRuntimeArn();
        if (!resolvedArn) {
            var err = new Error('RuntimeService not configured (runtimeArn missing)');
            if (callbacks.onError) callbacks.onError(err);
            return Promise.reject(err);
        }

        // Ensure WebSocket is connected
        var connectPromise = this.connected ? Promise.resolve() : this.connectWebSocket();

        return connectPromise.then(function() {
            // Build the payload — the runtime expects { prompt: "..." }
            var runtimePayload = {
                prompt: userMessage
            };

            // Register callbacks for this invocation (keyed by a temp ID until session_start arrives)
            var tempId = '_pending_' + Date.now();
            self._pendingInvocations.set(tempId, {
                callbacks: callbacks,
                tempId: tempId,
                sessionId: null,
                fullResponse: '',
                events: []
            });

            // Send invoke action
            var msg = {
                action: 'invoke',
                runtimeArn: resolvedArn,
                payload: runtimePayload
            };
            if (sessionId) {
                msg.sessionId = sessionId;
            }

            self.ws.send(JSON.stringify(msg));
            console.log('[RuntimeService] Sent invoke via WebSocket');
        }).catch(function(error) {
            console.error('[RuntimeService] WebSocket invoke error:', error);
            if (callbacks.onError) callbacks.onError(error);
            throw error;
        });
    };

    /**
     * Handle incoming WebSocket messages from the streaming proxy.
     * Message types: session_start, event, chunk, complete, error, pong
     */
    RuntimeService.prototype._handleWsMessage = function(data) {
        var type = data.type;

        if (type === 'pong') return;

        // Handle API Gateway internal messages (no type field)
        if (!type) {
            // APIGW may send {"message":"...", "connectionId":"...", "requestId":"..."}
            if (data.message && !data.sessionId) {
                console.debug('[RuntimeService] APIGW message (no type):', data.message);
                return;
            }
        }

        if (type === 'session_start') {
            // Map the real sessionId to the pending invocation
            var pending = this._findPendingInvocation();
            if (pending) {
                pending.sessionId = data.sessionId;
                // Re-key by sessionId
                this._pendingInvocations.delete(pending.tempId);
                this._pendingInvocations.set(data.sessionId, pending);
                if (pending.callbacks.onSessionStart) {
                    pending.callbacks.onSessionStart(data.sessionId, data.runtimeArn);
                }
            }
            return;
        }

        // Find the invocation by sessionId
        var invocation = data.sessionId ? this._pendingInvocations.get(data.sessionId) : this._findPendingInvocation();
        if (!invocation) {
            console.warn('[RuntimeService] Received message for unknown session:', data.sessionId);
            return;
        }

        var callbacks = invocation.callbacks;

        if (type === 'event') {
            invocation.events.push(data.data);
            if (callbacks.onEvent) callbacks.onEvent(data.data, data.index);

            // Track whether this event is a streaming delta (to avoid duplication
            // when the final message envelope arrives with the same text)
            var isDelta = !!(
                (data.data && data.data.contentBlockDelta) ||
                (data.data && data.data.delta) ||
                (data.data && data.data.event && data.data.event.contentBlockDelta)
            );
            if (isDelta) {
                invocation._receivedDeltas = true;
            }

            // Track message envelope events (skip if deltas already provided the text)
            var isMessageEnvelope = !!(
                data.data && data.data.message && typeof data.data.message === 'object' && data.data.message.content
            );

            // Try to extract text content from the event for streaming display
            var textChunk = null;
            if (isMessageEnvelope && invocation._receivedDeltas) {
                // Skip — the message envelope duplicates text already received via deltas
                textChunk = null;
            } else {
                textChunk = this._extractTextFromEvent(data.data);
            }

            if (textChunk && callbacks.onChunk) {
                invocation.fullResponse += textChunk;
                callbacks.onChunk(textChunk);
            }
        } else if (type === 'chunk') {
            // Raw text chunk
            invocation.fullResponse += (data.content || '');
            if (callbacks.onChunk) callbacks.onChunk(data.content || '');
        } else if (type === 'complete') {
            console.log('[RuntimeService] Stream complete: session=' + data.sessionId + ', chunks=' + data.totalChunks);
            this._pendingInvocations.delete(data.sessionId);
            if (callbacks.onComplete) {
                callbacks.onComplete({
                    sessionId: data.sessionId,
                    response: invocation.fullResponse,
                    events: invocation.events,
                    totalChunks: data.totalChunks
                });
            }
        } else if (type === 'error') {
            console.error('[RuntimeService] Stream error:', data.message);
            if (data.sessionId) this._pendingInvocations.delete(data.sessionId);
            if (callbacks.onError) callbacks.onError(new Error(data.message || 'Runtime streaming error'));
        }
    };

    /**
     * Find the first pending invocation (before session_start maps it).
     * Falls back to returning ANY active invocation if no _pending_ entry exists.
     */
    RuntimeService.prototype._findPendingInvocation = function() {
        var found = null;
        // First, look for an invocation still keyed by temp ID
        this._pendingInvocations.forEach(function(inv, key) {
            if (!found && key.indexOf('_pending_') === 0) {
                found = inv;
            }
        });
        // Fallback: if there's exactly one active invocation (already re-keyed), use it.
        // This handles messages that arrive without a sessionId field.
        if (!found && this._pendingInvocations.size === 1) {
            this._pendingInvocations.forEach(function(inv) {
                found = inv;
            });
        }
        return found;
    };

    /**
     * Extract text from a runtime event (NDJSON event from AgentCore).
     * The runtime may emit events in various formats; this handles common patterns.
     *
     * Strands Agent SDK emits events like:
     *   - { contentBlockDelta: { delta: { text: "..." } } }   — text chunk
     *   - { contentBlockStart: { toolUse: { name, toolUseId } } } — tool start (no text)
     *   - { contentBlockStop: {} }                             — block end
     *   - { messageStart: { role: "assistant" } }             — turn start
     *   - { messageStop: { stopReason: "..." } }              — turn end
     *   - { message: { role: "assistant", content: [{text: "..."}] } } — full message (post-tool turn)
     */
    RuntimeService.prototype._extractTextFromEvent = function(eventData) {
        if (!eventData) return null;

        // AgentCore runtime may return different event formats:
        // 1. { text: "..." } — direct text output
        if (typeof eventData.text === 'string') return eventData.text;

        // 2. { delta: { text: "..." } } — streaming delta (Bedrock Converse format forwarded)
        if (eventData.delta && typeof eventData.delta.text === 'string') return eventData.delta.text;

        // 3. Strands contentBlockDelta at the top level
        //    { contentBlockDelta: { delta: { text: "..." } } }
        if (eventData.contentBlockDelta && eventData.contentBlockDelta.delta &&
            typeof eventData.contentBlockDelta.delta.text === 'string') {
            return eventData.contentBlockDelta.delta.text;
        }

        // 4. { event: { contentBlockDelta: { delta: { text: "..." } } } } — wrapped SSE
        if (eventData.event) {
            var evt = eventData.event;
            if (evt.contentBlockDelta && evt.contentBlockDelta.delta &&
                typeof evt.contentBlockDelta.delta.text === 'string') {
                return evt.contentBlockDelta.delta.text;
            }
        }

        // 5. { message: { content: [{ text: "..." }] } } — full message envelope
        //    Strands SDK emits this after tool execution when the agent's final response
        //    is delivered as a complete message rather than individual deltas.
        //    Extract the text content from the message content blocks.
        if (eventData.message && typeof eventData.message === 'object' && eventData.message.content) {
            var content = eventData.message.content;
            if (Array.isArray(content)) {
                var textParts = [];
                for (var i = 0; i < content.length; i++) {
                    if (content[i] && typeof content[i].text === 'string') {
                        textParts.push(content[i].text);
                    }
                }
                if (textParts.length > 0) return textParts.join('');
            }
        }

        // 6. { content: "..." } — generic content
        if (typeof eventData.content === 'string') return eventData.content;

        // 7. { content: [{text: "..."}] } — content array at top level (alternative format)
        if (Array.isArray(eventData.content)) {
            var parts = [];
            for (var j = 0; j < eventData.content.length; j++) {
                if (eventData.content[j] && typeof eventData.content[j].text === 'string') {
                    parts.push(eventData.content[j].text);
                }
            }
            if (parts.length > 0) return parts.join('');
        }

        // 8. { message: "..." } — message wrapper (string), but NOT API Gateway internal messages
        //    APIGW sends { message: "Forbidden" } etc — skip those
        if (typeof eventData.message === 'string' && !eventData.connectionId && !eventData.requestId) {
            return eventData.message;
        }

        // 9. { output: { text: "..." } } — tool/action output
        if (eventData.output && typeof eventData.output.text === 'string') return eventData.output.text;

        // 10. { output: { message: { content: [{text: "..."}] } } } — nested output.message format
        if (eventData.output && eventData.output.message && eventData.output.message.content) {
            var outputContent = eventData.output.message.content;
            if (Array.isArray(outputContent)) {
                var outputParts = [];
                for (var k = 0; k < outputContent.length; k++) {
                    if (outputContent[k] && typeof outputContent[k].text === 'string') {
                        outputParts.push(outputContent[k].text);
                    }
                }
                if (outputParts.length > 0) return outputParts.join('');
            }
        }

        // Skip non-text events (contentBlockStart, contentBlockStop, messageStart, messageStop)
        // These are handled by the chatbot's onEvent callback for UX updates.
        return null;
    };

    /**
     * Parse the REST proxy response into a normalized result.
     */
    RuntimeService.prototype._parseRuntimeResponse = function(data) {
        // The REST proxy returns the raw response from invoke_agent_runtime
        // which is already read and returned as a string/JSON body
        var responseText = '';

        if (typeof data === 'string') {
            responseText = data;
        } else if (data && typeof data === 'object') {
            // Could be JSON with nested content
            if (data.response) {
                responseText = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
            } else if (data.output) {
                responseText = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
            } else if (data.text) {
                responseText = data.text;
            } else {
                responseText = JSON.stringify(data);
            }
        }

        if (responseText.indexOf('data:') !== -1) {
            return this._parseSseResponse(responseText);
        }

        // Try to parse NDJSON (newline-delimited JSON) from the runtime
        var events = [];
        var textParts = [];
        var lines = responseText.split('\n');
        lines.forEach(function(line) {
            line = line.trim();
            if (!line) return;
            try {
                var parsed = JSON.parse(line);
                events.push(parsed);
                // Extract text
                if (parsed.text) textParts.push(parsed.text);
                else if (parsed.delta && parsed.delta.text) textParts.push(parsed.delta.text);
                else if (parsed.content) textParts.push(parsed.content);
            } catch (e) {
                // Not JSON — treat as plain text
                textParts.push(line);
            }
        });

        return {
            response: textParts.join(''),
            events: events,
            rawResponse: responseText
        };
    };

    RuntimeService.prototype._parseSseResponse = function(responseText) {
        var events = [];
        var textParts = [];
        var self = this;
        responseText.split('\n').forEach(function(line) {
            line = line.trim();
            if (line.indexOf('data:') !== 0) return;
            var raw = line.substring(5).trim();
            if (!raw || raw === '[DONE]') return;
            try {
                var parsed = JSON.parse(raw);
                events.push(parsed);
                var text = self._extractTextFromEvent(parsed);
                if (text) textParts.push(text);
            } catch (e) {
                textParts.push(raw);
            }
        });
        return {
            response: textParts.length > 0 ? textParts.join('') : responseText,
            events: events,
            rawResponse: responseText
        };
    };

    // ================================================================
    // SigV4 Signing Helpers
    // ================================================================

    /**
     * Make a SigV4-signed fetch request to the API Gateway REST endpoint.
     * Reuses BedrockService's signing infrastructure.
     */
    RuntimeService.prototype._sigv4SignedFetch = function(method, url, bodyStr, credentials, signal, signingService) {
        var bedrockService = window.BedrockService;
        var urlObj = new URL(url);
        var host = urlObj.host;
        var path = urlObj.pathname;
        var service = signingService || 'execute-api';
        var region = this.region || bedrockService.region || 'us-east-1';
        if (service === 'execute-api') {
            var apiRegion = host.match(/^[^.]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
            region = (apiRegion && apiRegion[1]) || region;
        } else if (service === 'bedrock-agentcore') {
            var endpointRegion = host.match(/^bedrock-agentcore\.([a-z0-9-]+)\.amazonaws\.com$/);
            var arnRegion = this.runtimeArn && this.runtimeArn.match(/^arn:aws:bedrock-agentcore:([^:]+):/);
            region = (endpointRegion && endpointRegion[1]) || (arnRegion && arnRegion[1]) || region;
        }

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

        var sortedKeys = Object.keys(headers).sort();
        var canonicalHeaders = sortedKeys.map(function(k) { return k + ':' + headers[k].trim(); }).join('\n') + '\n';
        var signedHeaders = sortedKeys.join(';');

        return bedrockService.sha256(bodyStr).then(function(payloadHash) {
            var canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

            return bedrockService.sha256(canonicalRequest).then(function(canonicalRequestHash) {
                var credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
                var stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');

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

                        var fetchOptions = {
                            method: method,
                            headers: fetchHeaders,
                            signal: signal
                        };
                        if (method !== 'GET' && method !== 'HEAD') {
                            fetchOptions.body = bodyStr;
                        }
                        return fetch(url, fetchOptions);
                    });
            });
        });
    };

    /**
     * Sign a WebSocket URL with SigV4 query parameters.
     * Same pattern as WorkflowSocketService._signUrl.
     */
    RuntimeService.prototype._signWebSocketUrl = function(wsUrl) {
        var bedrockService = window.BedrockService;
        var credentials = bedrockService && bedrockService.credentials;
        if (!credentials) return Promise.reject(new Error('No AWS credentials'));

        var gs = window.GatewayService;
        if (!gs) return Promise.reject(new Error('GatewayService not available for signing helpers'));

        var region = this.region || bedrockService.region || 'us-east-1';
        var parsedUrl = new URL(wsUrl.replace(/^wss:\/\//, 'https://'));
        var host = parsedUrl.host;
        var path = parsedUrl.pathname || '/';
        var apiRegion = host.match(/^[^.]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
        region = (apiRegion && apiRegion[1]) || region;

        var now = new Date();
        var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        var dateStamp = amzDate.substring(0, 8);
        var credentialScope = dateStamp + '/' + region + '/execute-api/aws4_request';

        var queryParams = {
            'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
            'X-Amz-Credential': credentials.accessKeyId + '/' + credentialScope,
            'X-Amz-Date': amzDate,
            'X-Amz-SignedHeaders': 'host'
        };
        if (credentials.sessionToken) {
            queryParams['X-Amz-Security-Token'] = credentials.sessionToken;
        }

        var sortedKeys = Object.keys(queryParams).sort();
        var canonicalQs = sortedKeys.map(function(k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
        }).join('&');

        var canonicalRequest = [
            'GET', path, canonicalQs,
            'host:' + host + '\n',
            'host',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        ].join('\n');

        return gs.sha256(canonicalRequest).then(function(hash) {
            var stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + hash;
            return gs.getSignatureKey(credentials.secretAccessKey, dateStamp, region, 'execute-api')
                .then(function(signingKey) {
                    return gs.hmacSha256(signingKey, stringToSign);
                });
        }).then(function(signature) {
            queryParams['X-Amz-Signature'] = signature;
            var finalQs = Object.keys(queryParams).sort().map(function(k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
            }).join('&');
            return 'wss://' + host + path + '?' + finalQs;
        });
    };

    // ================================================================
    // Lifecycle
    // ================================================================

    RuntimeService.prototype._startHeartbeat = function() {
        var self = this;
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(function() {
            if (self.ws && self.connected) {
                self.ws.send(JSON.stringify({ action: 'ping' }));
            }
        }, 5 * 60 * 1000);
    };

    RuntimeService.prototype._stopHeartbeat = function() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    };

    /**
     * Abort all active REST requests.
     */
    RuntimeService.prototype.abortAll = function() {
        this._activeAbortControllers.forEach(function(controller) {
            try { controller.abort(); } catch (e) {}
        });
        this._activeAbortControllers.clear();
        this._pendingInvocations.clear();
    };

    // Export as singleton
    window.RuntimeService = new RuntimeService();

})();

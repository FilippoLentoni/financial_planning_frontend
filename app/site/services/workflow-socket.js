/**
 * Workflow WebSocket Service
 *
 * SigV4-authenticated WebSocket client for real-time collaborative workflow editing.
 * Uses AWS credentials from BedrockService (Cognito Identity Pool) — same pattern
 * as the existing GatewayService SigV4 signing.
 *
 * Protocol:
 *   → { action: "join_workflow", workflow_id, user_name }
 *   → { action: "leave_workflow", workflow_id }
 *   → { action: "broadcast", workflow_id, op, data }
 *   → { action: "workflow_crud", crud_action, ... }
 *   → { action: "heartbeat" }
 *   ← { type: "workflow_state", workflow, users }
 *   ← { type: "op", user_id, user_name, color, op, data }
 *   ← { type: "user_joined" | "user_left", ... }
 *   ← { type: "workflow_list" | "workflow_created" | ... }
 */

(function() {
    'use strict';

    function WorkflowSocketService() {
        this.ws = null;
        this.wsUrl = null;
        this.connected = false;
        this.heartbeatInterval = null;
        this.reconnectTimeout = null;
        this.currentWorkflowId = null;
        this.listeners = {};  // event type → [callback]
        this._throttleTimers = {};
    }

    // ------------------------------------------------------------------
    // Event system
    // ------------------------------------------------------------------

    WorkflowSocketService.prototype.on = function(type, callback) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(callback);
    };

    WorkflowSocketService.prototype.off = function(type, callback) {
        if (!this.listeners[type]) return;
        this.listeners[type] = this.listeners[type].filter(function(cb) { return cb !== callback; });
    };

    WorkflowSocketService.prototype._emit = function(type, data) {
        var cbs = this.listeners[type] || [];
        for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](data); } catch (e) { console.error('[WorkflowSocket] Listener error:', e); }
        }
    };

    // ------------------------------------------------------------------
    // SigV4 WebSocket URL signing (reuses GatewayService crypto helpers)
    // ------------------------------------------------------------------

    WorkflowSocketService.prototype._signUrl = function(url) {
        var credentials = window.BedrockService && window.BedrockService.credentials;
        if (!credentials) return Promise.reject(new Error('No AWS credentials'));

        var region = window.BedrockService.region || 'us-east-1';
        var parsedUrl = new URL(url.replace(/^wss:\/\//, 'https://'));
        var host = parsedUrl.host;
        var path = parsedUrl.pathname || '/';

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

        var gs = window.GatewayService;
        return gs.sha256(canonicalRequest).then(function(hash) {
            var stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + hash;
            return gs.getSignatureKey(credentials.secretAccessKey, dateStamp, region, 'execute-api');
        }).then(function(signingKey) {
            var stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n';
            // Recompute — need the hash again
            return gs.sha256(canonicalRequest).then(function(hash) {
                var sts = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + hash;
                return gs.hmacSha256(signingKey, sts);
            });
        }).then(function(signature) {
            queryParams['X-Amz-Signature'] = signature;
            var finalQs = Object.keys(queryParams).sort().map(function(k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
            }).join('&');
            return 'wss://' + host + path + '?' + finalQs;
        });
    };

    // ------------------------------------------------------------------
    // Connection lifecycle
    // ------------------------------------------------------------------

    WorkflowSocketService.prototype.connect = function(wsUrl) {
        var self = this;
        this.wsUrl = wsUrl;

        return this._signUrl(wsUrl).then(function(signedUrl) {
            return new Promise(function(resolve, reject) {
                self.ws = new WebSocket(signedUrl);

                self.ws.onopen = function() {
                    console.log('[WorkflowSocket] Connected');
                    self.connected = true;
                    self._startHeartbeat();
                    self._emit('connected', {});
                    resolve();
                };

                self.ws.onmessage = function(event) {
                    try {
                        var data = JSON.parse(event.data);
                        self._emit(data.type || 'message', data);
                    } catch (e) {
                        console.warn('[WorkflowSocket] Non-JSON message:', event.data);
                    }
                };

                self.ws.onclose = function() {
                    console.log('[WorkflowSocket] Disconnected');
                    self.connected = false;
                    self._stopHeartbeat();
                    self._emit('disconnected', {});
                    // Auto-reconnect after 5s
                    self.reconnectTimeout = setTimeout(function() {
                        if (self.wsUrl) self.connect(self.wsUrl);
                    }, 5000);
                };

                self.ws.onerror = function(err) {
                    console.error('[WorkflowSocket] Error:', err);
                    self._emit('error', err);
                    reject(err);
                };
            });
        });
    };

    WorkflowSocketService.prototype.disconnect = function() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
        this.wsUrl = null;
        if (this.ws) this.ws.close();
        this._stopHeartbeat();
    };

    WorkflowSocketService.prototype._send = function(msg) {
        if (this.ws && this.connected) {
            this.ws.send(JSON.stringify(msg));
        }
    };

    WorkflowSocketService.prototype._startHeartbeat = function() {
        var self = this;
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(function() {
            self._send({ action: 'heartbeat' });
        }, 5 * 60 * 1000);
    };

    WorkflowSocketService.prototype._stopHeartbeat = function() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    };

    // ------------------------------------------------------------------
    // Room management
    // ------------------------------------------------------------------

    WorkflowSocketService.prototype.joinWorkflow = function(workflowId, userName) {
        this.currentWorkflowId = workflowId;
        this._send({ action: 'join_workflow', workflow_id: workflowId, user_name: userName });
    };

    WorkflowSocketService.prototype.leaveWorkflow = function(workflowId) {
        this._send({ action: 'leave_workflow', workflow_id: workflowId || this.currentWorkflowId });
        this.currentWorkflowId = null;
    };

    // ------------------------------------------------------------------
    // Broadcast operations (collaborative edits)
    // ------------------------------------------------------------------

    WorkflowSocketService.prototype.broadcast = function(op, data) {
        if (!this.currentWorkflowId) return;
        this._send({
            action: 'broadcast',
            workflow_id: this.currentWorkflowId,
            op: op,
            data: data,
        });
    };

    /** Throttled broadcast — for high-frequency ops like cursor_move */
    WorkflowSocketService.prototype.broadcastThrottled = function(op, data, ms) {
        var self = this;
        if (this._throttleTimers[op]) return;
        this.broadcast(op, data);
        this._throttleTimers[op] = setTimeout(function() {
            delete self._throttleTimers[op];
        }, ms || 50);
    };

    /** Debounced broadcast — for typing */
    WorkflowSocketService.prototype.broadcastDebounced = function(op, data, ms) {
        var self = this;
        if (this._throttleTimers[op]) clearTimeout(this._throttleTimers[op]);
        this._throttleTimers[op] = setTimeout(function() {
            delete self._throttleTimers[op];
            self.broadcast(op, data);
        }, ms || 150);
    };

    // ------------------------------------------------------------------
    // CRUD (response comes back as typed messages)
    // ------------------------------------------------------------------

    WorkflowSocketService.prototype.listWorkflows = function() {
        this._send({ action: 'workflow_crud', crud_action: 'list' });
    };

    WorkflowSocketService.prototype.createWorkflow = function(payload) {
        this._send({ action: 'workflow_crud', crud_action: 'create', payload: payload });
    };

    WorkflowSocketService.prototype.deleteWorkflow = function(workflowId) {
        this._send({ action: 'workflow_crud', crud_action: 'delete', workflow_id: workflowId });
    };

    WorkflowSocketService.prototype.executeWorkflow = function(workflowId) {
        this._send({ action: 'workflow_crud', crud_action: 'execute', workflow_id: workflowId });
    };

    // ------------------------------------------------------------------
    // Expose globally
    // ------------------------------------------------------------------

    window.WorkflowSocketService = new WorkflowSocketService();

})();

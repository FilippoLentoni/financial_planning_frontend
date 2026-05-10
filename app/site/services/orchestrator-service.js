/**
 * Orchestrator Service - Multi-agent orchestration with worker agents
 * 
 * Implements a parent-child agent architecture where:
 * - Parent Agent (Orchestrator): Coordinates tasks and delegates to workers
 * - Worker Agents: 1:1 mapping with MCP servers, each has isolated context
 * 
 * The parent agent has access to "delegate_to_worker_X" tools for each worker.
 * Workers only have access to their specific MCP server's tools.
 */

(function() {
    'use strict';

    /**
     * Worker Agent class - represents a single worker tied to one MCP gateway
     */
    function WorkerAgent(id, name, gatewayUrl, tools) {
        this.id = id;
        this.name = name;
        this.gatewayUrl = gatewayUrl;
        this.tools = tools || [];
        this.conversationHistory = [];
        this.isProcessing = false;
        this.modelId = null; // Per-worker model override (null = use global default)
        this.maxConcurrency = 1; // Max concurrent tool calls for this worker
        this.activeTasks = 0; // Current active task count
    }

    /**
     * Get the model ID for this worker (or global default)
     */
    WorkerAgent.prototype.getModelId = function() {
        if (this.modelId) {
            return this.modelId;
        }
        return window.BedrockService ? window.BedrockService.getModelId() : 'backend-default';
    };

    /**
     * Set the model ID for this worker
     */
    WorkerAgent.prototype.setModelId = function(modelId) {
        this.modelId = modelId;
    };

    /**
     * Set max concurrency for this worker
     */
    WorkerAgent.prototype.setMaxConcurrency = function(max) {
        this.maxConcurrency = Math.max(1, max);
    };

    /**
     * Clear worker's conversation history
     */
    WorkerAgent.prototype.clearHistory = function() {
        this.conversationHistory = [];
    };

    /**
     * Get tool specs formatted for Bedrock
     */
    WorkerAgent.prototype.getToolSpecs = function() {
        return this.tools.map(function(tool) {
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
    };

    /**
     * Orchestrator Service class
     */
    function OrchestratorService() {
        this.enabled = false;
        this.workers = new Map(); // gatewayUrl -> WorkerAgent
        this.parentConversationHistory = [];
        this.activeWorkerProcessing = null;
        this.onWorkerUpdate = null; // Callback for UI updates
        this.onParentUpdate = null; // Callback for parent agent updates
        this.delegationCounter = 0; // Counter for unique delegation instance IDs
        this.parentCallIndex = 0; // Counter for parent Bedrock API calls
    }

    /**
     * Enable or disable orchestrator mode
     */
    OrchestratorService.prototype.setEnabled = function(enabled) {
        this.enabled = enabled;
        console.log('[Orchestrator] Mode ' + (enabled ? 'enabled' : 'disabled'));
        
        if (enabled) {
            this.initializeWorkers();
        } else {
            this.clearWorkers();
        }
    };

    /**
     * Check if orchestrator mode is enabled
     */
    OrchestratorService.prototype.isEnabled = function() {
        return this.enabled;
    };

    /**
     * Initialize worker agents based on connected MCP gateways
     */
    OrchestratorService.prototype.initializeWorkers = function() {
        var self = this;
        this.workers.clear();
        
        if (!window.MCPService) {
            console.warn('[Orchestrator] MCPService not available');
            return;
        }
        
        var connectedUrls = window.MCPService.getConnectedGatewayUrls();
        var workerIndex = 0;
        
        connectedUrls.forEach(function(gatewayUrl) {
            var connection = window.MCPService.connectedGateways.get(gatewayUrl);
            if (connection) {
                var workerId = 'worker_' + workerIndex;
                var workerName = self.getGatewayDisplayName(gatewayUrl);
                var worker = new WorkerAgent(workerId, workerName, gatewayUrl, connection.tools);
                self.workers.set(gatewayUrl, worker);
                workerIndex++;
                
                console.log('[Orchestrator] Created worker:', workerId, '-', workerName, 'with', connection.tools.length, 'tools');
            }
        });
        
        console.log('[Orchestrator] Initialized', this.workers.size, 'worker agents');
    };

    /**
     * Get display name for a gateway URL
     */
    OrchestratorService.prototype.getGatewayDisplayName = function(gatewayUrl) {
        // Try to get gateway info from GatewayService
        if (window.GatewayService) {
            var gateways = window.GatewayService.getGateways();
            var gateway = gateways.find(function(g) {
                return g.mcpUrl === gatewayUrl || g.url === gatewayUrl;
            });
            if (gateway && gateway.name) {
                return gateway.name;
            }
        }
        
        // Extract name from URL
        try {
            var url = new URL(gatewayUrl);
            return url.hostname.split('.')[0];
        } catch (e) {
            return gatewayUrl;
        }
    };

    /**
     * Clear all worker agents
     */
    OrchestratorService.prototype.clearWorkers = function() {
        this.workers.forEach(function(worker) {
            worker.clearHistory();
        });
        this.workers.clear();
        this.parentConversationHistory = [];
    };

    /**
     * Get all workers as an array
     */
    OrchestratorService.prototype.getWorkers = function() {
        return Array.from(this.workers.values());
    };

    /**
     * Get worker by ID
     */
    OrchestratorService.prototype.getWorkerById = function(workerId) {
        var found = null;
        this.workers.forEach(function(worker) {
            if (worker.id === workerId) {
                found = worker;
            }
        });
        return found;
    };

    /**
     * Get the parent agent's tool specs (delegation tools)
     * Creates a pseudo-tool for each worker agent
     */
    OrchestratorService.prototype.getParentToolSpecs = function() {
        var tools = [];
        
        this.workers.forEach(function(worker) {
            // Create a delegation tool for this worker
            var toolName = 'delegate_to_' + worker.id;
            var toolDescription = 'Delegate a task to the "' + worker.name + '" worker agent. ' +
                'This worker has access to the following tools: ' +
                worker.tools.map(function(t) { return t.name; }).join(', ') + '. ' +
                'Use this to ask the worker to perform tasks using its available tools.';
            
            tools.push({
                toolSpec: {
                    name: toolName,
                    description: toolDescription,
                    inputSchema: {
                        json: {
                            type: 'object',
                            properties: {
                                task: {
                                    type: 'string',
                                    description: 'The task or question to delegate to the worker agent. Be specific about what you need.'
                                },
                                context: {
                                    type: 'string',
                                    description: 'Optional additional context to provide to the worker.'
                                }
                            },
                            required: ['task']
                        }
                    }
                }
            });
        });
        
        return tools;
    };

    /**
     * Get system prompt for parent agent (orchestrator)
     */
    OrchestratorService.prototype.getParentSystemPrompt = function() {
        var workerList = [];
        this.workers.forEach(function(worker) {
            var toolNames = worker.tools.map(function(t) { 
                // Extract display name from full tool name
                var name = t.name;
                if (name.indexOf('___') !== -1) {
                    name = name.split('___').pop();
                }
                return name;
            }).join(', ');
            
            workerList.push('- ' + worker.name + ' (delegate_to_' + worker.id + '): Tools available: ' + toolNames);
        });
        
        return 'You are an orchestrator agent that coordinates multiple specialized worker agents to accomplish tasks. ' +
            'You do NOT have direct access to tools - instead, you delegate tasks to worker agents using delegation tools.\n\n' +
            'AUTO-DETECT PORTFOLIO PLANNING TASKS & DELEGATE:\n' +
            'Recognize portfolio optimization, what-if, weekly review, and buy/sell explanation requests and delegate to the portfolio-planning worker.\n' +
            '- Optimizer requests -> run-portfolio-optimization, then retrieve and explain results.\n' +
            '- Liquidity or adherence questions -> run-what-if-analysis and summarize risk.\n' +
            '- Weekly review requests -> generate-weekly-plan-report and compare against previous plan when available.\n\n' +
            'IMPORTANT: Workers execute IN PARALLEL. When you call multiple delegate_to_worker_X tools in a single response, ' +
            'ALL workers start simultaneously and run concurrently. This is highly efficient for tasks that can be parallelized. ' +
            'Each worker operates in its own isolated context with separate conversation history - they cannot see or communicate with each other.\n\n' +
            'Available Worker Agents:\n' + workerList.join('\n') + '\n\n' +
            'Guidelines:\n' +
            '1. Analyze the user\'s request to determine which worker(s) to delegate to\n' +
            '2. Use the delegate_to_worker_X tools to send tasks to appropriate workers\n' +
            '3. LEVERAGE PARALLELISM: When tasks are independent, delegate to multiple workers in a SINGLE response - they will all run at the same time\n' +
            '4. Examples of parallelizable tasks:\n' +
            '   - Comparing data from different sources (each worker fetches their data simultaneously)\n' +
            '   - Gathering information from multiple APIs\n' +
            '   - Running independent analyses on different datasets\n' +
            '5. Workers will execute their tools and return results\n' +
            '6. Synthesize worker responses into a coherent answer for the user\n' +
            '7. If a worker\'s response is incomplete, you can delegate follow-up tasks\n\n' +
            'Be efficient - leverage parallel execution when possible and summarize results clearly.';
    };

    /**
     * Get system prompt for a worker agent
     * Uses the same base prompt as non-orchestrator mode (from BedrockService)
     */
    OrchestratorService.prototype.getWorkerSystemPrompt = function(worker) {
        // Same identity and instructions as the non-orchestrator mode
        var identity = 'You are Hank, a helpful AI assistant. Always refer to yourself as Hank when introducing yourself or when asked your name. ' +
            'Be friendly, helpful, and professional. You have access to various tools through MCP servers to help accomplish tasks.';
        
        // Default instructions for tool usage (same as BedrockService)
        var toolInstructions = '\n\nIMPORTANT: When calling tools, you MUST use the exact tool name as provided by the MCP server. ' +
            'Tool names may contain special characters like underscores (e.g., "tool___toolname", "module__function"). ' +
            'Do NOT modify, simplify, or rename tools - call them exactly as they appear in the tool list. ' +
            'The tool name format (including any prefixes, separators, or suffixes) is intentional and required for proper routing.';
        
        var planningInstructions = '\n\n## PUBLIC PLANNING TOOL GUIDANCE\n\n' +
            'Use the public synthetic gateway tools exactly as listed by the backend.\n' +
            '- Portfolio workflows use list-portfolios, get-portfolio-snapshot, get-market-context, run-portfolio-optimization, status/result tools, what-if analysis, and weekly reports.\n' +
            '- Explain buy/sell recommendations using tool output, and do not claim access to production data.\n' +
            '- Always state that synthetic tool output is not financial advice.';
        
        // Additional orchestrator context
        var orchestratorContext = '\n\nYou are currently operating as a specialized worker agent named "' + worker.name + '" ' +
            'within an orchestrator system. Focus on completing the specific task assigned to you. ' +
            'Provide clear, concise results. Do not ask clarifying questions - work with the information provided.';
        
        return identity + toolInstructions + planningInstructions + orchestratorContext;
    };

    /**
     * Process a message in orchestrator mode
     * Returns a promise that resolves with the final response
     * 
     * @param {string} message - User message
     * @param {string} idToken - Authentication token
     * @param {Object} callbacks - Callbacks for streaming { onChunk, onToolUse, onComplete, onError, onWorkerStart, onWorkerComplete }
     * @returns {Promise<Object>}
     */
    OrchestratorService.prototype.processMessage = function(message, idToken, callbacks) {
        var self = this;
        callbacks = callbacks || {};
        
        if (!this.enabled || this.workers.size === 0) {
            return Promise.reject(new Error('Orchestrator not enabled or no workers available'));
        }
        
        // Notify start of orchestration
        if (callbacks.onOrchestratorStart) {
            callbacks.onOrchestratorStart();
        }
        
        return this.runParentAgent(message, idToken, callbacks);
    };

    /**
     * Run the parent agent to process a user message
     */
    OrchestratorService.prototype.runParentAgent = function(message, idToken, callbacks) {
        var self = this;
        
        // Add user message to parent's history
        if (message !== null) {
            this.parentConversationHistory.push({
                role: 'user',
                content: [{ text: message }]
            });
        }
        
        // Build request for parent agent
        var parentToolSpecs = this.getParentToolSpecs();
        var systemPrompt = this.getParentSystemPromptWithDate();
        
        // Prepare messages
        var requestBody = {
            modelId: window.BedrockService ? window.BedrockService.getModelId() : 'backend-default',
            messages: this.parentConversationHistory.slice(),
            system: [{ text: systemPrompt }],
            toolConfig: {
                tools: parentToolSpecs
            }
        };
        
        // Stream parent agent response
        return this.streamBedrockRequest(requestBody, idToken, {
            onChunk: function(chunk) {
                if (callbacks.onChunk) callbacks.onChunk(chunk, 'parent');
            },
            onToolUse: function(toolUse) {
                if (callbacks.onToolUse) callbacks.onToolUse(toolUse, 'parent');
            },
            onComplete: function(result) {
                // Emit parent usage for audit trace
                if (result.usage && callbacks.onParentUsage) {
                    callbacks.onParentUsage(result.usage, self.parentCallIndex++, result.toolUses ? result.toolUses.length : 0);
                }
                
                // Add assistant response to history
                var historyContent = [];
                if (result.response) {
                    historyContent.push({ text: result.response });
                }
                result.toolUses.forEach(function(tu) {
                    historyContent.push({
                        toolUse: {
                            toolUseId: tu.id,
                            name: tu.name,
                            input: tu.input
                        }
                    });
                });
                
                if (historyContent.length > 0) {
                    self.parentConversationHistory.push({
                        role: 'assistant',
                        content: historyContent
                    });
                }
                
                // Check if there are delegation tools to execute
                if (result.toolUses && result.toolUses.length > 0) {
                    self.executeDelegations(result.toolUses, idToken, callbacks)
                        .then(function(toolResults) {
                            // Continue parent agent with delegation results
                            return self.continueParentWithResults(toolResults, idToken, callbacks);
                        })
                        .catch(function(error) {
                            if (callbacks.onError) callbacks.onError(error);
                        });
                } else {
                    // No delegations, complete
                    if (callbacks.onComplete) callbacks.onComplete(result);
                }
            },
            onError: callbacks.onError
        });
    };

    /**
     * Get parent system prompt with current date
     */
    OrchestratorService.prototype.getParentSystemPromptWithDate = function() {
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
        return dateInfo + '\n\n' + this.getParentSystemPrompt();
    };

    /**
     * Execute delegation tool calls by running worker agents SEQUENTIALLY
     * Each delegation gets a unique instance ID (delegation_0, delegation_1, etc.)
     * This ensures no overlap when the same worker handles multiple tasks
     */
    OrchestratorService.prototype.executeDelegations = function(toolUses, idToken, callbacks) {
        var self = this;
        var results = [];
        
        console.log('[Orchestrator] Executing', toolUses.length, 'delegations SEQUENTIALLY');
        
        // Execute all delegations sequentially (one at a time)
        return toolUses.reduce(function(promise, toolUse, index) {
            return promise.then(function() {
                // Generate unique delegation instance ID
                var delegationId = 'delegation_' + self.delegationCounter++;
                console.log('[Orchestrator] Starting', delegationId, '(delegation', (index + 1), 'of', toolUses.length + ')');
                
                // Check if this is a delegation tool
                if (toolUse.name.indexOf('delegate_to_') === 0) {
                    var workerId = toolUse.name.replace('delegate_to_', '');
                    var worker = self.getWorkerById(workerId);
                    
                    if (worker) {
                        // Create a delegation instance object with unique ID
                        // This allows the UI to distinguish between multiple delegations to the same worker
                        var delegationInstance = {
                            id: delegationId,
                            workerId: worker.id,
                            name: worker.name + ' #' + (index + 1),
                            worker: worker,
                            task: toolUse.input.task
                        };
                        
                        // Notify that this delegation is starting with unique instance
                        if (callbacks.onWorkerStart) {
                            callbacks.onWorkerStart(delegationInstance, toolUse);
                        }
                        
                        // Run the worker agent
                        return self.runWorkerAgent(worker, toolUse.input.task, toolUse.input.context, idToken, {
                            onWorkerChunk: function(w, chunk) {
                                if (callbacks.onWorkerChunk) {
                                    callbacks.onWorkerChunk(delegationInstance, chunk);
                                }
                            },
                            onWorkerToolUse: function(w, tu) {
                                if (callbacks.onWorkerToolUse) {
                                    callbacks.onWorkerToolUse(delegationInstance, tu);
                                }
                            },
                            onWorkerToolResult: function(w, tu, result) {
                                if (callbacks.onWorkerToolResult) {
                                    callbacks.onWorkerToolResult(delegationInstance, tu, result);
                                }
                            },
                            onWorkerUsage: function(w, usage, toolCount) {
                                if (callbacks.onWorkerUsage) {
                                    callbacks.onWorkerUsage(delegationInstance, usage, toolCount);
                                }
                            }
                        })
                            .then(function(workerResult) {
                                var responseText = workerResult.response || '';
                                
                                if (callbacks.onWorkerComplete) {
                                    callbacks.onWorkerComplete(delegationInstance, responseText);
                                }
                                
                                results.push({
                                    toolUseId: toolUse.id,
                                    result: 'Worker "' + worker.name + '" response:\n' + responseText
                                });
                            })
                            .catch(function(error) {
                                console.error('[Orchestrator]', delegationId, 'failed:', error);
                                
                                if (callbacks.onWorkerComplete) {
                                    callbacks.onWorkerComplete(delegationInstance, 'Error: ' + error.message);
                                }
                                
                                results.push({
                                    toolUseId: toolUse.id,
                                    result: 'Error from worker "' + worker.name + '": ' + error.message
                                });
                            });
                    } else {
                        results.push({
                            toolUseId: toolUse.id,
                            result: 'Error: Worker not found: ' + workerId
                        });
                        return Promise.resolve();
                    }
                } else {
                    results.push({
                        toolUseId: toolUse.id,
                        result: 'Error: Unknown tool: ' + toolUse.name
                    });
                    return Promise.resolve();
                }
            });
        }, Promise.resolve()).then(function() {
            console.log('[Orchestrator] All', results.length, 'delegations completed');
            return results;
        });
    };


    /**
     * Execute tools for a worker agent
     */
    OrchestratorService.prototype.executeWorkerTools = function(worker, toolUses, idToken, callbacks) {
        var self = this;
        var toolResults = [];
        
        console.log('[Orchestrator] Executing', toolUses.length, 'tools for worker:', worker.id);
        
        // Execute tools sequentially
        return toolUses.reduce(function(promise, toolUse) {
            return promise.then(function() {
                console.log('[Orchestrator] Worker', worker.id, 'calling tool:', toolUse.name, 'with input:', JSON.stringify(toolUse.input));
                
                if (callbacks.onWorkerToolExecuting) {
                    callbacks.onWorkerToolExecuting(worker, toolUse);
                }
                
                // Call the actual MCP tool
                return window.MCPService.callTool(toolUse.name, toolUse.input)
                    .then(function(result) {
                        console.log('[Orchestrator] Worker', worker.id, 'tool', toolUse.name, 'completed successfully');
                        
                        var resultText = self.formatToolResult(result);
                        toolResults.push({
                            toolUseId: toolUse.id,
                            result: resultText
                        });
                        
                        // Emit tool result callback for UI updates
                        if (callbacks.onWorkerToolResult) {
                            callbacks.onWorkerToolResult(worker, toolUse, resultText);
                        }
                        // Legacy callback name
                        if (callbacks.onWorkerToolComplete) {
                            callbacks.onWorkerToolComplete(worker, toolUse, resultText);
                        }
                    })
                    .catch(function(error) {
                        console.error('[Orchestrator] Worker', worker.id, 'tool', toolUse.name, 'FAILED:', error);
                        console.error('[Orchestrator] Error details:', {
                            message: error.message,
                            stack: error.stack,
                            name: error.name
                        });
                        
                        var errorResult = 'Error: ' + error.message;
                        toolResults.push({
                            toolUseId: toolUse.id,
                            result: errorResult
                        });
                        
                        // Emit tool result callback with error
                        if (callbacks.onWorkerToolResult) {
                            callbacks.onWorkerToolResult(worker, toolUse, { error: error.message });
                        }
                    });
            });
        }, Promise.resolve()).then(function() {
            console.log('[Orchestrator] Worker', worker.id, 'all tools executed, continuing with results');
            // Continue worker with tool results
            return self.continueWorkerWithResults(worker, toolResults, idToken, callbacks);
        });
    };

    /**
     * Continue worker agent with tool results
     */
    OrchestratorService.prototype.continueWorkerWithResults = function(worker, toolResults, idToken, callbacks) {
        var self = this;
        
        // Add tool results to worker's history
        worker.conversationHistory.push({
            role: 'user',
            content: toolResults.map(function(tr) {
                return {
                    toolResult: {
                        toolUseId: tr.toolUseId,
                        content: [{ text: tr.result }]
                    }
                };
            })
        });
        
        // Continue worker conversation - use worker's specific model
        var systemPrompt = this.getWorkerSystemPromptWithDate(worker);
        var requestBody = {
            modelId: worker.getModelId(),
            messages: worker.conversationHistory.slice(),
            system: [{ text: systemPrompt }],
            toolConfig: {
                tools: worker.getToolSpecs()
            }
        };
        
        return this.streamBedrockRequest(requestBody, idToken, {
            onChunk: function(chunk) {
                if (callbacks.onWorkerChunk) {
                    callbacks.onWorkerChunk(worker, chunk);
                }
            },
            onToolUse: function(toolUse) {
                if (callbacks.onWorkerToolUse) {
                    callbacks.onWorkerToolUse(worker, toolUse);
                }
            },
            onComplete: function(result) {
                // Emit worker usage for audit trace
                if (result.usage && callbacks.onWorkerUsage) {
                    callbacks.onWorkerUsage(worker, result.usage, result.toolUses ? result.toolUses.length : 0);
                }
                
                // Add to history
                var historyContent = [];
                if (result.response) {
                    historyContent.push({ text: result.response });
                }
                result.toolUses.forEach(function(tu) {
                    historyContent.push({
                        toolUse: {
                            toolUseId: tu.id,
                            name: tu.name,
                            input: tu.input
                        }
                    });
                });
                
                if (historyContent.length > 0) {
                    worker.conversationHistory.push({
                        role: 'assistant',
                        content: historyContent
                    });
                }
            },
            onError: function(error) {
                console.error('[Orchestrator] Worker continue error:', error);
            }
        }).then(function(result) {
            // If more tools, continue execution
            if (result.toolUses && result.toolUses.length > 0) {
                return self.executeWorkerTools(worker, result.toolUses, idToken, callbacks);
            }
            return result;
        });
    };

    /**
     * Get worker system prompt with date
     */
    OrchestratorService.prototype.getWorkerSystemPromptWithDate = function(worker) {
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
        return dateInfo + '\n\n' + this.getWorkerSystemPrompt(worker);
    };

    /**
     * Continue parent agent with delegation results
     */
    OrchestratorService.prototype.continueParentWithResults = function(toolResults, idToken, callbacks) {
        var self = this;
        
        // Add tool results to parent's history
        this.parentConversationHistory.push({
            role: 'user',
            content: toolResults.map(function(tr) {
                return {
                    toolResult: {
                        toolUseId: tr.toolUseId,
                        content: [{ text: tr.result }]
                    }
                };
            })
        });
        
        // Continue parent conversation
        return this.runParentAgent(null, idToken, callbacks);
    };

    /**
     * Stream a Bedrock request (reuses BedrockService's signing and parsing)
     */
    OrchestratorService.prototype.streamBedrockRequest = function(requestBody, idToken, callbacks) {
        callbacks = callbacks || {};
        var error = new Error('Direct browser Bedrock model invocation is disabled. The frontend must call the AgentCore backend runtime.');
        if (callbacks.onError) callbacks.onError(error);
        return Promise.reject(error);
    };

    OrchestratorService.prototype._disabledStreamBedrockRequest = function(requestBody, idToken, callbacks) {
        var self = this;
        callbacks = callbacks || {};
        var bedrockService = window.BedrockService;
        var url = 'direct-browser-bedrock-disabled';
        
        var fullResponse = '';
        var toolUses = [];
        var stopReason = null;
        var usage = null;
        
        return bedrockService.getCredentials(idToken)
            .then(function(credentials) {
                var headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.amazon.eventstream'
                };
                var body = JSON.stringify(requestBody);
                
                return bedrockService.signRequest('POST', url, headers, body, credentials)
                    .then(function(signedHeaders) {
                        return fetch(url, {
                            method: 'POST',
                            headers: signedHeaders,
                            body: body
                        });
                    });
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(text) {
                        throw new Error('Bedrock request failed: ' + response.status + ' - ' + text);
                    });
                }
                
                var reader = response.body.getReader();
                var bufferArray = null;
                var currentContentBlockIndex = -1;
                var contentBlockTexts = {};
                
                function processEvents(events) {
                    events.forEach(function(event) {
                        // Content delta
                        if (event.delta) {
                            var blockIndex = event.contentBlockIndex !== undefined ? event.contentBlockIndex : currentContentBlockIndex;
                            
                            if (event.delta.text) {
                                if (!contentBlockTexts[blockIndex]) {
                                    contentBlockTexts[blockIndex] = { type: 'text', content: '' };
                                }
                                if (contentBlockTexts[blockIndex].type === 'text') {
                                    contentBlockTexts[blockIndex].content += event.delta.text;
                                    fullResponse += event.delta.text;
                                    if (callbacks.onChunk) callbacks.onChunk(event.delta.text);
                                }
                            }
                            
                            if (event.delta.toolUse && event.delta.toolUse.input !== undefined) {
                                var lastToolUse = toolUses[toolUses.length - 1];
                                if (lastToolUse) {
                                    if (!lastToolUse.inputJson) lastToolUse.inputJson = '';
                                    lastToolUse.inputJson += event.delta.toolUse.input;
                                }
                            }
                        }
                        
                        // Content block start
                        if (event.start) {
                            if (event.contentBlockIndex !== undefined) {
                                currentContentBlockIndex = event.contentBlockIndex;
                            }
                            
                            if (event.start.toolUse) {
                                contentBlockTexts[currentContentBlockIndex] = { type: 'toolUse', content: '' };
                                var tu = {
                                    id: event.start.toolUse.toolUseId,
                                    name: event.start.toolUse.name,
                                    input: {},
                                    status: 'pending'
                                };
                                toolUses.push(tu);
                                if (callbacks.onToolUse) callbacks.onToolUse(tu);
                            }
                        }
                        
                        // Content block stop
                        if (event.contentBlockIndex !== undefined && !event.delta && !event.start) {
                            var lastToolUse = toolUses[toolUses.length - 1];
                            if (lastToolUse && lastToolUse.inputJson) {
                                try {
                                    lastToolUse.input = JSON.parse(lastToolUse.inputJson);
                                } catch (e) {
                                    lastToolUse.input = {};
                                }
                                delete lastToolUse.inputJson;
                            }
                        }
                        
                        // Stop reason
                        if (event.stopReason) {
                            stopReason = event.stopReason;
                        }
                        
                        // Usage
                        if (event.usage) {
                            usage = event.usage;
                        }
                    });
                }
                
                function processStream() {
                    return reader.read().then(function(result) {
                        if (result.done) {
                            // Complete
                            var completionResult = {
                                response: fullResponse,
                                stopReason: stopReason,
                                toolUses: toolUses,
                                usage: usage
                            };
                            if (callbacks.onComplete) callbacks.onComplete(completionResult);
                            return completionResult;
                        }
                        
                        // Combine with buffer
                        var newData = result.value;
                        var combined;
                        if (bufferArray) {
                            combined = new Uint8Array(bufferArray.byteLength + newData.byteLength);
                            combined.set(bufferArray, 0);
                            combined.set(newData, bufferArray.byteLength);
                        } else {
                            combined = newData;
                        }
                        
                        // Parse events
                        var parseResult = bedrockService.parseEventStream(combined);
                        processEvents(parseResult.messages);
                        bufferArray = parseResult.remaining;
                        
                        return processStream();
                    });
                }
                
                return processStream();
            })
            .catch(function(error) {
                if (callbacks.onError) callbacks.onError(error);
                throw error;
            });
    };

    /**
     * Format tool result for display
     */
    OrchestratorService.prototype.formatToolResult = function(result) {
        if (!result) return '';
        
        if (result.content && Array.isArray(result.content)) {
            return result.content.map(function(c) {
                return c.text || JSON.stringify(c);
            }).join('\n');
        }
        
        return JSON.stringify(result, null, 2);
    };

    /**
     * Run a worker agent to complete a delegated task
     */
    OrchestratorService.prototype.runWorkerAgent = function(worker, task, context, idToken, callbacks) {
        var self = this;
        
        console.log('[Orchestrator] Running worker:', worker.id, 'with task:', task.substring(0, 100) + '...');
        
        // Build task message for worker
        var workerMessage = task;
        if (context) {
            workerMessage = 'Context: ' + context + '\n\nTask: ' + task;
        }
        
        // Add to worker's conversation history
        worker.conversationHistory.push({
            role: 'user',
            content: [{ text: workerMessage }]
        });
        
        // Build worker request - use worker's specific model if set
        var systemPrompt = this.getWorkerSystemPromptWithDate(worker);
        var modelId = worker.getModelId();
        
        console.log('[Orchestrator] Worker', worker.id, 'using model:', modelId);
        console.log('[Orchestrator] Worker', worker.id, 'has', worker.tools.length, 'tools available');
        
        var requestBody = {
            modelId: modelId,
            messages: worker.conversationHistory.slice(),
            system: [{ text: systemPrompt }],
            toolConfig: {
                tools: worker.getToolSpecs()
            }
        };
        
        var workerResponse = '';
        var workerToolUses = [];
        
        // Stream worker response
        return this.streamBedrockRequest(requestBody, idToken, {
            onChunk: function(chunk) {
                workerResponse += chunk;
                if (callbacks.onWorkerChunk) {
                    callbacks.onWorkerChunk(worker, chunk);
                }
            },
            onToolUse: function(toolUse) {
                console.log('[Orchestrator] Worker', worker.id, 'wants to use tool:', toolUse.name);
                workerToolUses.push(toolUse);
                if (callbacks.onWorkerToolUse) {
                    callbacks.onWorkerToolUse(worker, toolUse);
                }
            },
            onComplete: function(result) {
                console.log('[Orchestrator] Worker', worker.id, 'streaming complete, tool uses:', result.toolUses.length);
                
                // Emit worker usage for audit trace
                if (result.usage && callbacks.onWorkerUsage) {
                    callbacks.onWorkerUsage(worker, result.usage, result.toolUses ? result.toolUses.length : 0);
                }
                
                // Add assistant response to worker's history
                var historyContent = [];
                if (result.response) {
                    historyContent.push({ text: result.response });
                }
                result.toolUses.forEach(function(tu) {
                    historyContent.push({
                        toolUse: {
                            toolUseId: tu.id,
                            name: tu.name,
                            input: tu.input
                        }
                    });
                });
                
                if (historyContent.length > 0) {
                    worker.conversationHistory.push({
                        role: 'assistant',
                        content: historyContent
                    });
                }
            },
            onError: function(error) {
                console.error('[Orchestrator] Worker', worker.id, 'streaming error:', error);
                console.error('[Orchestrator] Error details:', {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                });
            }
        }).then(function(result) {
            // If worker used tools, execute them
            if (result.toolUses && result.toolUses.length > 0) {
                console.log('[Orchestrator] Worker', worker.id, 'executing', result.toolUses.length, 'tools');
                return self.executeWorkerTools(worker, result.toolUses, idToken, callbacks);
            }
            console.log('[Orchestrator] Worker', worker.id, 'completed without tool calls');
            return result;
        }).catch(function(error) {
            console.error('[Orchestrator] Worker', worker.id, 'FAILED:', error);
            throw error;
        });
    };

    /**
     * Load worker configurations from localStorage
     */
    OrchestratorService.prototype.loadWorkerConfigs = function() {
        try {
            var saved = localStorage.getItem('agentic_orchestrator_worker_configs');
            if (saved) {
                var configs = JSON.parse(saved);
                var self = this;
                this.workers.forEach(function(worker) {
                    var config = configs[worker.gatewayUrl];
                    if (config) {
                        if (config.modelId) worker.setModelId(config.modelId);
                        if (config.maxConcurrency) worker.setMaxConcurrency(config.maxConcurrency);
                    }
                });
                console.log('[Orchestrator] Loaded worker configs from storage');
            }
        } catch (e) {
            console.warn('[Orchestrator] Failed to load worker configs:', e);
        }
    };

    // Export as singleton
    window.OrchestratorService = new OrchestratorService();

})();

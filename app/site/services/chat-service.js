/**
 * Chat Service - Handles AI chat communication with streaming support
 * 
 * Security: Uses application auth tokens for API authentication.
 * Supports response streaming via Server-Sent Events or ReadableStream.
 */

(function() {
    'use strict';

    /**
     * Chat Service class for managing AI conversations
     */
    function ChatService() {
        this.conversationHistory = [];
        this.activeAbortControllers = new Set();
        this.systemPrompt = '';
        this.toolSpecs = [];
    }

    /**
     * Abort all active requests
     */
    ChatService.prototype.abortAll = function() {
        console.log('[Chat] Aborting ' + this.activeAbortControllers.size + ' active requests');
        this.activeAbortControllers.forEach(function(controller) {
            try {
                controller.abort();
            } catch (err) {
                console.error('[Chat] Error aborting controller:', err);
            }
        });
        this.activeAbortControllers.clear();
    };

    /**
     * Create and register an AbortController
     * @returns {AbortController}
     */
    ChatService.prototype.createAbortController = function() {
        var controller = new AbortController();
        this.activeAbortControllers.add(controller);
        return controller;
    };

    /**
     * Remove an AbortController from tracking
     * @param {AbortController} controller
     */
    ChatService.prototype.removeAbortController = function(controller) {
        this.activeAbortControllers.delete(controller);
    };

    /**
     * Set the system prompt for the conversation
     * @param {string} prompt
     */
    ChatService.prototype.setSystemPrompt = function(prompt) {
        this.systemPrompt = prompt;
    };

    /**
     * Get system prompt with current date/time injected
     * @returns {string}
     */
    ChatService.prototype.getSystemPromptWithDate = function() {
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
        
        if (this.systemPrompt && this.systemPrompt.trim()) {
            return dateInfo + '\n\n' + this.systemPrompt;
        }
        
        return dateInfo;
    };

    /**
     * Set tool specifications for the conversation
     * @param {Array} tools
     */
    ChatService.prototype.setToolSpecs = function(tools) {
        this.toolSpecs = tools;
    };

    /**
     * Clear conversation history
     */
    ChatService.prototype.clearHistory = function() {
        this.conversationHistory = [];
    };

    /**
     * Get current conversation history
     * @returns {Array}
     */
    ChatService.prototype.getHistory = function() {
        return this.conversationHistory;
    };

    /**
     * Send a message with streaming response
     * 
     * @param {string} message - The user message
     * @param {string} apiEndpoint - The API endpoint URL
     * @param {string} accessToken - The auth access token
     * @param {Object} callbacks - Callback functions { onChunk, onToolUse, onComplete, onError }
     * @returns {Promise<Object>}
     */
    ChatService.prototype.sendMessageStream = function(message, apiEndpoint, accessToken, callbacks) {
        var self = this;
        var controller = this.createAbortController();
        
        callbacks = callbacks || {};
        var onChunk = callbacks.onChunk || function() {};
        var onToolUse = callbacks.onToolUse || function() {};
        var onComplete = callbacks.onComplete || function() {};
        var onError = callbacks.onError || function() {};

        // Build request body
        var requestBody = {
            message: message,
            conversationHistory: this.conversationHistory,
            systemPrompt: this.getSystemPromptWithDate(),
            stream: true
        };

        // Include tool specs if available
        if (this.toolSpecs && this.toolSpecs.length > 0) {
            requestBody.tools = this.toolSpecs;
        }

        return fetch(apiEndpoint + '/chat', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('Chat request failed: ' + response.status + ' - ' + text);
                });
            }

            // Handle streaming response
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            var fullResponse = '';
            var toolUses = [];

            function processStream() {
                return reader.read().then(function(result) {
                    if (result.done) {
                        // Process any remaining buffer
                        if (buffer.trim()) {
                            processSSEData(buffer);
                        }
                        
                        // Update conversation history
                        self.conversationHistory.push({
                            role: 'user',
                            content: [{ text: message }]
                        });
                        self.conversationHistory.push({
                            role: 'assistant',
                            content: [{ text: fullResponse }]
                        });
                        
                        self.removeAbortController(controller);
                        
                        var result = {
                            response: fullResponse,
                            toolUses: toolUses,
                            conversationHistory: self.conversationHistory
                        };
                        
                        onComplete(result);
                        return result;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    
                    // Process complete SSE events
                    var lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer
                    
                    lines.forEach(function(line) {
                        processSSEData(line);
                    });

                    return processStream();
                });
            }

            function processSSEData(line) {
                line = line.trim();
                if (!line || line.startsWith(':')) return; // Skip empty lines and comments
                
                if (line.startsWith('data: ')) {
                    var data = line.substring(6);
                    
                    if (data === '[DONE]') {
                        return;
                    }
                    
                    try {
                        var parsed = JSON.parse(data);
                        
                        // Handle text chunk
                        if (parsed.type === 'text' || parsed.text) {
                            var chunk = parsed.text || parsed.content || '';
                            fullResponse += chunk;
                            onChunk(chunk);
                        }
                        
                        // Handle tool use
                        if (parsed.type === 'tool_use' || parsed.toolUse) {
                            var toolUse = parsed.toolUse || parsed;
                            toolUses.push(toolUse);
                            onToolUse(toolUse);
                        }
                        
                        // Handle error
                        if (parsed.type === 'error' || parsed.error) {
                            throw new Error(parsed.error || parsed.message || 'Unknown error');
                        }
                    } catch (e) {
                        // If not JSON, treat as plain text chunk
                        if (data && data !== '[DONE]') {
                            fullResponse += data;
                            onChunk(data);
                        }
                    }
                }
            }

            return processStream();
        })
        .catch(function(error) {
            self.removeAbortController(controller);
            
            if (error.name === 'AbortError') {
                console.log('[Chat] Stream aborted');
                onError(new Error('Request was aborted'));
                return { response: fullResponse || '', aborted: true };
            }
            
            console.error('[Chat] Stream error:', error);
            onError(error);
            throw error;
        });
    };

    /**
     * Send a message without streaming (for simpler use cases)
     * 
     * @param {string} message - The user message
     * @param {string} apiEndpoint - The API endpoint URL
     * @param {string} accessToken - The auth access token
     * @returns {Promise<Object>}
     */
    ChatService.prototype.sendMessage = function(message, apiEndpoint, accessToken) {
        var self = this;
        var controller = this.createAbortController();

        var requestBody = {
            message: message,
            conversationHistory: this.conversationHistory,
            systemPrompt: this.getSystemPromptWithDate(),
            stream: false
        };

        if (this.toolSpecs && this.toolSpecs.length > 0) {
            requestBody.tools = this.toolSpecs;
        }

        return fetch(apiEndpoint + '/chat', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        })
        .then(function(response) {
            self.removeAbortController(controller);
            
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('Chat request failed: ' + response.status + ' - ' + text);
                });
            }
            return response.json();
        })
        .then(function(result) {
            // Update conversation history
            self.conversationHistory.push({
                role: 'user',
                content: [{ text: message }]
            });
            self.conversationHistory.push({
                role: 'assistant',
                content: [{ text: result.response }]
            });
            
            result.conversationHistory = self.conversationHistory;
            return result;
        })
        .catch(function(error) {
            self.removeAbortController(controller);
            
            if (error.name === 'AbortError') {
                console.log('[Chat] Request aborted');
                throw new Error('Request was aborted');
            }
            
            console.error('[Chat] Request error:', error);
            throw error;
        });
    };

    /**
     * Continue conversation after tool execution
     * 
     * @param {Array} toolResults - Results from tool executions
     * @param {string} apiEndpoint - The API endpoint URL
     * @param {string} accessToken - The auth access token
     * @param {Object} callbacks - Callback functions for streaming
     * @returns {Promise<Object>}
     */
    ChatService.prototype.continueWithToolResults = function(toolResults, apiEndpoint, accessToken, callbacks) {
        var self = this;
        var controller = this.createAbortController();
        
        callbacks = callbacks || {};
        var onChunk = callbacks.onChunk || function() {};
        var onToolUse = callbacks.onToolUse || function() {};
        var onComplete = callbacks.onComplete || function() {};
        var onError = callbacks.onError || function() {};

        // Add tool results to history
        var updatedHistory = this.conversationHistory.concat([{
            role: 'user',
            content: toolResults.map(function(tr) {
                return {
                    toolResult: {
                        toolUseId: tr.toolUseId,
                        content: [{ text: tr.result }]
                    }
                };
            })
        }]);

        var requestBody = {
            message: null, // No new message, just tool results
            conversationHistory: updatedHistory,
            systemPrompt: this.getSystemPromptWithDate(),
            stream: true
        };

        if (this.toolSpecs && this.toolSpecs.length > 0) {
            requestBody.tools = this.toolSpecs;
        }

        return fetch(apiEndpoint + '/chat', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(text) {
                    throw new Error('Chat continue failed: ' + response.status + ' - ' + text);
                });
            }

            // Reuse streaming logic
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            var fullResponse = '';
            var toolUses = [];

            function processStream() {
                return reader.read().then(function(result) {
                    if (result.done) {
                        if (buffer.trim()) {
                            processSSEData(buffer);
                        }
                        
                        // Update conversation history with tool results and response
                        self.conversationHistory = updatedHistory;
                        self.conversationHistory.push({
                            role: 'assistant',
                            content: [{ text: fullResponse }]
                        });
                        
                        self.removeAbortController(controller);
                        
                        var result = {
                            response: fullResponse,
                            toolUses: toolUses,
                            conversationHistory: self.conversationHistory
                        };
                        
                        onComplete(result);
                        return result;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    
                    var lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    lines.forEach(function(line) {
                        processSSEData(line);
                    });

                    return processStream();
                });
            }

            function processSSEData(line) {
                line = line.trim();
                if (!line || line.startsWith(':')) return;
                
                if (line.startsWith('data: ')) {
                    var data = line.substring(6);
                    
                    if (data === '[DONE]') return;
                    
                    try {
                        var parsed = JSON.parse(data);
                        
                        if (parsed.type === 'text' || parsed.text) {
                            var chunk = parsed.text || parsed.content || '';
                            fullResponse += chunk;
                            onChunk(chunk);
                        }
                        
                        if (parsed.type === 'tool_use' || parsed.toolUse) {
                            var toolUse = parsed.toolUse || parsed;
                            toolUses.push(toolUse);
                            onToolUse(toolUse);
                        }
                        
                        if (parsed.type === 'error' || parsed.error) {
                            throw new Error(parsed.error || parsed.message || 'Unknown error');
                        }
                    } catch (e) {
                        if (data && data !== '[DONE]') {
                            fullResponse += data;
                            onChunk(data);
                        }
                    }
                }
            }

            return processStream();
        })
        .catch(function(error) {
            self.removeAbortController(controller);
            
            if (error.name === 'AbortError') {
                console.log('[Chat] Continue stream aborted');
                onError(new Error('Request was aborted'));
                return { response: '', aborted: true };
            }
            
            console.error('[Chat] Continue stream error:', error);
            onError(error);
            throw error;
        });
    };

    /**
     * Format tool results for display
     * @param {Object} toolResult
     * @returns {string}
     */
    ChatService.prototype.formatToolResult = function(toolResult) {
        if (!toolResult) return '';
        
        if (toolResult.content && Array.isArray(toolResult.content)) {
            return toolResult.content.map(function(c) {
                return c.text || JSON.stringify(c);
            }).join('\n');
        }
        
        return JSON.stringify(toolResult, null, 2);
    };

    // Export as singleton
    window.ChatService = new ChatService();

})();

/**
 * Message Renderer - Handles rendering and updating chat messages
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;
    var setTextContent = window.ChatbotUtils.setTextContent;

    /**
     * MessageRenderer constructor
     * @param {HTMLElement} messagesContainer - Container element for messages
     */
    function MessageRenderer(messagesContainer) {
        this.container = messagesContainer;
        this.messages = [];
    }

    /**
     * Add a message to the chat
     * @param {string} role - 'user' or 'assistant'
     * @param {string} content - Message content
     * @param {object} options - Additional options
     * @returns {string} - Message ID
     */
    MessageRenderer.prototype.addMessage = function(role, content, options) {
        options = options || {};
        
        var msgData = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            role: role,
            content: content,
            timestamp: new Date().toISOString(),
            toolUses: options.toolUses || [],
            isStreaming: options.isStreaming || false
        };
        
        this.messages.push(msgData);
        this.renderMessage(msgData);
        this.scrollToBottom();
        
        return msgData.id;
    };

    /**
     * Render a single message with robot avatars
     */
    MessageRenderer.prototype.renderMessage = function(msg) {
        // Remove welcome message if it exists
        var welcome = this.container.querySelector('.chatbot-welcome');
        if (welcome) welcome.remove();
        
        var msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg ' + escapeHtml(msg.role);
        if (msg.isStreaming) msgDiv.className += ' streaming';
        msgDiv.setAttribute('data-msg-id', msg.id);
        
        // Create robot avatar
        var avatarDiv = document.createElement('div');
        avatarDiv.className = msg.role === 'user' ? 'robot-avatar-user' : 'robot-avatar-ai';
        
        // Create message body container
        var bodyDiv = document.createElement('div');
        bodyDiv.className = 'chat-msg-body';
        
        var headerDiv = document.createElement('div');
        headerDiv.className = 'chat-msg-header';
        
        var roleSpan = document.createElement('span');
        roleSpan.className = 'chat-msg-role';
        setTextContent(roleSpan, msg.role === 'user' ? 'You' : 'Agent');
        
        var timeSpan = document.createElement('span');
        timeSpan.className = 'chat-msg-time';
        setTextContent(timeSpan, new Date(msg.timestamp).toLocaleTimeString());
        
        headerDiv.appendChild(roleSpan);
        headerDiv.appendChild(timeSpan);
        
        var contentDiv = document.createElement('div');
        contentDiv.className = 'chat-msg-content';
        
        // For assistant messages, use markdown rendering (which escapes first)
        // For user messages, use textContent (safe, no HTML interpretation)
        if (msg.role === 'assistant' && window.MarkdownParser) {
            contentDiv.innerHTML = window.MarkdownParser.parse(msg.content);
        } else {
            setTextContent(contentDiv, msg.content);
        }
        
        bodyDiv.appendChild(headerDiv);
        
        // Render tool uses if present
        if (msg.toolUses && msg.toolUses.length > 0) {
            var toolsContainer = document.createElement('div');
            toolsContainer.className = 'tool-uses-container';
            
            var self = this;
            msg.toolUses.forEach(function(toolUse) {
                var toolEl = self.renderToolUse(toolUse);
                toolsContainer.appendChild(toolEl);
            });
            
            bodyDiv.appendChild(toolsContainer);
        }
        
        bodyDiv.appendChild(contentDiv);
        
        // Append avatar and body to message
        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(bodyDiv);
        
        this.container.appendChild(msgDiv);
    };

    /**
     * Render a tool use component
     */
    MessageRenderer.prototype.renderToolUse = function(toolUse) {
        var container = document.createElement('div');
        container.className = 'tool-use-container';
        container.setAttribute('data-tool-id', toolUse.id || '');
        
        var statusClass = toolUse.status || 'pending';
        var statusText = {
            'pending': 'Pending',
            'pending_approval': 'Awaiting Approval',
            'executing': 'Executing...',
            'completed': 'Completed',
            'error': 'Error',
            'denied': 'Denied'
        }[statusClass] || 'Unknown';
        
        container.innerHTML = '\
            <div class="tool-use-header">\
                <div class="tool-use-info">\
                    <span class="tool-use-icon">🔧</span>\
                    <span class="tool-use-name">' + escapeHtml(toolUse.name) + '</span>\
                </div>\
                <span class="tool-use-status ' + escapeHtml(statusClass) + '">' + escapeHtml(statusText) + '</span>\
                <span class="tool-use-toggle">▼</span>\
            </div>\
            <div class="tool-use-body">\
                <div class="tool-use-input">\
                    <div class="tool-use-input-label">Input</div>\
                    <div class="tool-use-input-content">' + escapeHtml(JSON.stringify(toolUse.input || {}, null, 2)) + '</div>\
                </div>\
                ' + (toolUse.result ? '\
                <div class="tool-use-result">\
                    <div class="tool-use-result-label">Result</div>\
                    <div class="tool-use-result-content ' + (toolUse.status === 'error' ? 'error' : '') + '">' + 
                        escapeHtml(typeof toolUse.result === 'string' ? toolUse.result : JSON.stringify(toolUse.result, null, 2)) + 
                    '</div>\
                </div>' : '') + '\
            </div>';
        
        // Toggle expand/collapse
        var header = container.querySelector('.tool-use-header');
        header.addEventListener('click', function() {
            container.classList.toggle('expanded');
        });
        
        return container;
    };

    /**
     * Update message content (for streaming)
     */
    MessageRenderer.prototype.updateMessageContent = function(msgId, content) {
        var msgEl = this.container.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            var contentEl = msgEl.querySelector('.chat-msg-content');
            if (contentEl) {
                var isAssistant = msgEl.classList.contains('assistant');
                if (isAssistant && window.MarkdownParser) {
                    contentEl.innerHTML = window.MarkdownParser.parse(content);
                } else {
                    setTextContent(contentEl, content);
                }
            }
        }
        
        // Update state
        var msg = this.messages.find(function(m) { return m.id === msgId; });
        if (msg) {
            msg.content = content;
        }
        
        this.scrollToBottom();
    };

    /**
     * Add tool use to existing message
     */
    MessageRenderer.prototype.addToolUseToMessage = function(msgId, toolUse) {
        var msgEl = this.container.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            var bodyEl = msgEl.querySelector('.chat-msg-body');
            var contentEl = msgEl.querySelector('.chat-msg-content');
            var toolEl = this.renderToolUse(toolUse);
            
            if (bodyEl && contentEl) {
                bodyEl.insertBefore(toolEl, contentEl);
            } else if (bodyEl) {
                bodyEl.appendChild(toolEl);
            }
        }
    };

    /**
     * Update tool use status
     */
    MessageRenderer.prototype.updateToolUseStatus = function(toolId, status, result, input) {
        var toolEl = this.container.querySelector('[data-tool-id="' + toolId + '"]');
        if (toolEl) {
            var statusEl = toolEl.querySelector('.tool-use-status');
            if (statusEl) {
                statusEl.className = 'tool-use-status ' + escapeHtml(status);
                var statusText = {
                    'pending': 'Pending',
                    'pending_approval': 'Awaiting Approval',
                    'executing': 'Executing...',
                    'completed': 'Completed',
                    'error': 'Error',
                    'denied': 'Denied'
                }[status] || 'Unknown';
                setTextContent(statusEl, statusText);
            }
            
            // Update input display if provided
            if (input !== undefined) {
                var inputContentEl = toolEl.querySelector('.tool-use-input-content');
                if (inputContentEl) {
                    setTextContent(inputContentEl, JSON.stringify(input, null, 2));
                }
            }
            
            if (result !== undefined) {
                var bodyEl = toolEl.querySelector('.tool-use-body');
                var resultEl = bodyEl.querySelector('.tool-use-result');
                
                if (!resultEl) {
                    resultEl = document.createElement('div');
                    resultEl.className = 'tool-use-result';
                    resultEl.innerHTML = '<div class="tool-use-result-label">Result</div><div class="tool-use-result-content"></div>';
                    bodyEl.appendChild(resultEl);
                }
                
                var resultContentEl = resultEl.querySelector('.tool-use-result-content');
                resultContentEl.className = 'tool-use-result-content' + (status === 'error' ? ' error' : '');
                setTextContent(resultContentEl, typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            }
        }
    };

    /**
     * Mark message as finished streaming
     */
    MessageRenderer.prototype.finishStreaming = function(msgId) {
        var msgEl = this.container.querySelector('[data-msg-id="' + msgId + '"]');
        if (msgEl) {
            msgEl.classList.remove('streaming');
        }
        
        var msg = this.messages.find(function(m) { return m.id === msgId; });
        if (msg) {
            msg.isStreaming = false;
        }
    };

    /**
     * Show typing indicator with skeleton message bubble
     */
    MessageRenderer.prototype.showTypingIndicator = function() {
        var existingIndicator = this.container.querySelector('.typing-indicator-container');
        if (existingIndicator) return;
        
        var welcome = this.container.querySelector('.chatbot-welcome');
        if (welcome) welcome.remove();
        
        var container = document.createElement('div');
        container.className = 'chat-msg assistant typing-indicator-container';
        
        var avatarDiv = document.createElement('div');
        avatarDiv.className = 'robot-avatar-ai';
        container.appendChild(avatarDiv);
        
        var bodyDiv = document.createElement('div');
        bodyDiv.className = 'chat-msg-body';
        
        var headerDiv = document.createElement('div');
        headerDiv.className = 'chat-msg-header';
        var roleSpan = document.createElement('span');
        roleSpan.className = 'chat-msg-role';
        setTextContent(roleSpan, 'Agent');
        headerDiv.appendChild(roleSpan);
        bodyDiv.appendChild(headerDiv);
        
        var skeletonContent = document.createElement('div');
        skeletonContent.className = 'skeleton-message-content';
        skeletonContent.style.minWidth = '180px';
        skeletonContent.style.minHeight = '50px';
        skeletonContent.style.display = 'flex';
        skeletonContent.style.alignItems = 'center';
        skeletonContent.style.justifyContent = 'center';
        
        if (window.SkeletonLoader) {
            var loader = window.SkeletonLoader.createInlineLoader();
            skeletonContent.appendChild(loader);
        } else {
            var typingDots = document.createElement('div');
            typingDots.className = 'typing-indicator';
            typingDots.innerHTML = '<span></span><span></span><span></span>';
            skeletonContent.appendChild(typingDots);
        }
        
        bodyDiv.appendChild(skeletonContent);
        container.appendChild(bodyDiv);
        
        this.container.appendChild(container);
        this.scrollToBottom();
    };

    /**
     * Hide typing indicator
     */
    MessageRenderer.prototype.hideTypingIndicator = function() {
        var indicator = this.container.querySelector('.typing-indicator-container');
        if (indicator) indicator.remove();
    };

    /**
     * Scroll messages to bottom
     */
    MessageRenderer.prototype.scrollToBottom = function() {
        this.container.scrollTop = this.container.scrollHeight;
    };

    /**
     * Clear all messages
     */
    MessageRenderer.prototype.clear = function() {
        this.messages = [];
        this.container.innerHTML = '\
            <div class="chatbot-welcome">\
                <h4>Unified Planning Experience</h4>\
                <p>Ask a question or describe a task to get started.</p>\
                <p>Start a conversation by typing a message below.</p>\
            </div>';
    };

    /**
     * Get all messages
     */
    MessageRenderer.prototype.getMessages = function() {
        return this.messages;
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.MessageRenderer = MessageRenderer;

})();
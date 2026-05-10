/**
 * Worker Settings - UI for configuring orchestrator worker agents
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;

    /**
     * WorkerSettings constructor
     */
    function WorkerSettings() {
        this.panel = null;
        this.contentElement = null;
        this.isOpen = false;
        this.onSave = null;
        this.getAvailableModels = function() { return []; };
    }

    /**
     * Initialize the worker settings panel
     */
    WorkerSettings.prototype.init = function(options) {
        options = options || {};
        this.onSave = options.onSave || function() {};
        this.getAvailableModels = options.getAvailableModels || function() { return []; };
        
        this.createPanel();
        this.bindEvents();
    };

    /**
     * Create the settings panel HTML
     */
    WorkerSettings.prototype.createPanel = function() {
        // Check if panel already exists
        if (document.getElementById('worker-settings-overlay')) {
            this.panel = document.getElementById('worker-settings-overlay');
            this.contentElement = document.getElementById('worker-settings-content');
            return;
        }
        
        var overlay = document.createElement('div');
        overlay.className = 'worker-settings-overlay hidden';
        overlay.id = 'worker-settings-overlay';
        
        overlay.innerHTML = '\
            <div class="worker-settings-panel">\
                <div class="worker-settings-header">\
                    <h3>⚙️ Worker Agent Settings</h3>\
                    <button class="worker-settings-close" id="worker-settings-close">&times;</button>\
                </div>\
                <div class="worker-settings-content" id="worker-settings-content">\
                    <p>No workers configured. Enable Orchestrator mode first.</p>\
                </div>\
                <div class="worker-settings-footer">\
                    <button class="btn-secondary" id="worker-settings-reset">Reset to Defaults</button>\
                    <button class="btn-primary" id="worker-settings-save">Save Settings</button>\
                </div>\
            </div>';
        
        document.body.appendChild(overlay);
        
        this.panel = overlay;
        this.contentElement = document.getElementById('worker-settings-content');
    };

    /**
     * Bind event listeners
     */
    WorkerSettings.prototype.bindEvents = function() {
        var self = this;
        
        // Close button
        var closeBtn = document.getElementById('worker-settings-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                self.hide();
            });
        }
        
        // Click outside to close
        this.panel.addEventListener('click', function(e) {
            if (e.target === self.panel) {
                self.hide();
            }
        });
        
        // Save button
        var saveBtn = document.getElementById('worker-settings-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                self.saveSettings();
            });
        }
        
        // Reset button
        var resetBtn = document.getElementById('worker-settings-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                self.resetSettings();
            });
        }
    };

    /**
     * Show the settings panel
     */
    WorkerSettings.prototype.show = function() {
        this.render();
        this.panel.classList.remove('hidden');
        this.isOpen = true;
    };

    /**
     * Hide the settings panel
     */
    WorkerSettings.prototype.hide = function() {
        this.panel.classList.add('hidden');
        this.isOpen = false;
    };

    /**
     * Render the settings content
     */
    WorkerSettings.prototype.render = function() {
        if (!window.OrchestratorService) {
            this.contentElement.innerHTML = '<p class="no-workers">OrchestratorService not available.</p>';
            return;
        }
        
        var workers = window.OrchestratorService.getWorkers();
        
        if (workers.length === 0) {
            this.contentElement.innerHTML = '<p class="no-workers">No workers configured. Enable Orchestrator mode and connect to MCP servers first.</p>';
            return;
        }
        
        var models = this.getAvailableModels();
        var currentGlobalModel = window.BedrockService ? window.BedrockService.getModelId() : '';
        var self = this;
        
        var html = '<div class="worker-settings-list">';
        
        workers.forEach(function(worker, index) {
            var workerModelId = worker.modelId || '';
            var workerConcurrency = worker.maxConcurrency || 1;
            
            html += '\
                <div class="worker-setting-card" data-worker-id="' + escapeHtml(worker.id) + '">\
                    <div class="worker-setting-header">\
                        <span class="worker-icon">🤖</span>\
                        <span class="worker-name">' + escapeHtml(worker.name) + '</span>\
                        <span class="worker-tools-badge">' + worker.tools.length + ' tools</span>\
                    </div>\
                    <div class="worker-setting-body">\
                        <div class="setting-row">\
                            <label for="worker-model-' + index + '">AI Model</label>\
                            <select id="worker-model-' + index + '" class="worker-model-select" data-worker-id="' + escapeHtml(worker.id) + '">\
                                <option value="">Use Global Default (' + escapeHtml(self.getModelDisplayName(currentGlobalModel, models)) + ')</option>';
            
            // Group models by provider
            var providers = {};
            models.forEach(function(model) {
                var provider = model.providerName || 'Other';
                if (!providers[provider]) {
                    providers[provider] = [];
                }
                providers[provider].push(model);
            });
            
            Object.keys(providers).sort().forEach(function(provider) {
                html += '<optgroup label="' + escapeHtml(provider) + '">';
                providers[provider].forEach(function(model) {
                    var selected = workerModelId === model.modelId ? ' selected' : '';
                    html += '<option value="' + escapeHtml(model.modelId) + '"' + selected + '>' + 
                            escapeHtml(model.modelName || model.modelId) + '</option>';
                });
                html += '</optgroup>';
            });
            
            html += '\
                            </select>\
                        </div>\
                        <div class="setting-row">\
                            <label for="worker-concurrency-' + index + '">Max Concurrent Tools</label>\
                            <div class="concurrency-control">\
                                <button class="concurrency-btn minus" data-worker-id="' + escapeHtml(worker.id) + '">−</button>\
                                <input type="number" id="worker-concurrency-' + index + '" \
                                    class="worker-concurrency-input" \
                                    data-worker-id="' + escapeHtml(worker.id) + '" \
                                    value="' + workerConcurrency + '" \
                                    min="1" max="10" />\
                                <button class="concurrency-btn plus" data-worker-id="' + escapeHtml(worker.id) + '">+</button>\
                            </div>\
                            <span class="setting-help">Number of tools that can run simultaneously</span>\
                        </div>\
                    </div>\
                </div>';
        });
        
        html += '</div>';
        
        this.contentElement.innerHTML = html;
        
        // Bind concurrency button events
        this.bindConcurrencyButtons();
    };

    /**
     * Bind concurrency +/- button events
     */
    WorkerSettings.prototype.bindConcurrencyButtons = function() {
        var self = this;
        
        var minusBtns = this.contentElement.querySelectorAll('.concurrency-btn.minus');
        var plusBtns = this.contentElement.querySelectorAll('.concurrency-btn.plus');
        
        minusBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var workerId = btn.getAttribute('data-worker-id');
                var input = self.contentElement.querySelector('.worker-concurrency-input[data-worker-id="' + workerId + '"]');
                if (input) {
                    var val = parseInt(input.value, 10) || 1;
                    input.value = Math.max(1, val - 1);
                }
            });
        });
        
        plusBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var workerId = btn.getAttribute('data-worker-id');
                var input = self.contentElement.querySelector('.worker-concurrency-input[data-worker-id="' + workerId + '"]');
                if (input) {
                    var val = parseInt(input.value, 10) || 1;
                    input.value = Math.min(10, val + 1);
                }
            });
        });
    };

    /**
     * Get model display name from inference profile
     */
    WorkerSettings.prototype.getModelDisplayName = function(modelId, models) {
        if (!modelId) return 'Default';
        
        // Find the model in the available models list
        var model = models.find(function(m) { return m.modelId === modelId; });
        if (model) {
            // Use the inference profile name (modelName) if available
            return model.modelName || model.modelId;
        }
        
        // If model not in list, try to extract a friendly name from the ID
        // Format: backend-default
        // Extract the model name portion: nova-2-lite-v1:0
        if (modelId.indexOf('.') !== -1) {
            var parts = modelId.split('.');
            var modelPart = parts[parts.length - 1]; // nova-2-lite-v1:0
            
            // Clean up the model part to make it more readable
            // Remove version suffix like -v1:0
            var cleanName = modelPart.replace(/-v\d+:\d+$/, '');
            // Remove date suffix like -20241022
            cleanName = cleanName.replace(/-\d{8}$/, '');
            // Capitalize and format
            cleanName = cleanName.split('-').map(function(word) {
                return word.charAt(0).toUpperCase() + word.slice(1);
            }).join(' ');
            
            return cleanName;
        }
        
        return modelId;
    };

    /**
     * Save settings
     */
    WorkerSettings.prototype.saveSettings = function() {
        var self = this;
        
        if (!window.OrchestratorService) return;
        
        // Collect settings from form
        var modelSelects = this.contentElement.querySelectorAll('.worker-model-select');
        var concurrencyInputs = this.contentElement.querySelectorAll('.worker-concurrency-input');
        
        modelSelects.forEach(function(select) {
            var workerId = select.getAttribute('data-worker-id');
            var modelId = select.value || null;
            window.OrchestratorService.setWorkerModel(workerId, modelId);
        });
        
        concurrencyInputs.forEach(function(input) {
            var workerId = input.getAttribute('data-worker-id');
            var concurrency = parseInt(input.value, 10) || 1;
            window.OrchestratorService.setWorkerConcurrency(workerId, concurrency);
        });
        
        // Save to localStorage
        window.OrchestratorService.saveWorkerConfigs();
        
        // Notify
        if (this.onSave) {
            this.onSave();
        }
        
        // Show confirmation
        this.showSaveConfirmation();
    };

    /**
     * Show save confirmation
     */
    WorkerSettings.prototype.showSaveConfirmation = function() {
        var saveBtn = document.getElementById('worker-settings-save');
        if (saveBtn) {
            var originalText = saveBtn.textContent;
            saveBtn.textContent = '✓ Saved!';
            saveBtn.classList.add('saved');
            
            setTimeout(function() {
                saveBtn.textContent = originalText;
                saveBtn.classList.remove('saved');
            }, 1500);
        }
    };

    /**
     * Reset settings to defaults
     */
    WorkerSettings.prototype.resetSettings = function() {
        if (!window.OrchestratorService) return;
        
        var workers = window.OrchestratorService.getWorkers();
        
        workers.forEach(function(worker) {
            worker.modelId = null;
            worker.maxConcurrency = 1;
        });
        
        // Clear localStorage
        try {
            localStorage.removeItem('agentic_orchestrator_worker_configs');
        } catch (e) {
            console.warn('[WorkerSettings] Failed to clear localStorage:', e);
        }
        
        // Re-render
        this.render();
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.WorkerSettings = WorkerSettings;

})();

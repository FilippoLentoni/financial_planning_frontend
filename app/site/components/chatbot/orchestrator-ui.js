/**
 * Orchestrator UI - Handles orchestrator mode UI elements
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;

    /**
     * OrchestratorUI constructor
     * @param {object} elements - DOM elements
     */
    function OrchestratorUI(elements) {
        this.toggle = elements.toggle;
        this.toggleSwitch = elements.toggleSwitch;
        this.countElement = elements.countElement;
        this.statusBar = elements.statusBar;
        this.workersList = elements.workersList;
        
        this.onToggle = null;
        this.onWorkerClick = null; // Callback when a worker chip is clicked
        this.workerPanelStates = {}; // Store worker session states for revisiting
    }

    /**
     * Initialize with toggle callback
     */
    OrchestratorUI.prototype.init = function(onToggle, onWorkerClick) {
        var self = this;
        this.onToggle = onToggle;
        this.onWorkerClick = onWorkerClick;
        
        if (this.toggleSwitch) {
            this.toggleSwitch.addEventListener('click', function() {
                if (self.onToggle) {
                    self.onToggle();
                }
            });
        }
        
        this.update();
    };

    /**
     * Set worker click callback
     */
    OrchestratorUI.prototype.setWorkerClickCallback = function(callback) {
        this.onWorkerClick = callback;
    };

    /**
     * Update orchestrator UI elements based on current state
     */
    OrchestratorUI.prototype.update = function() {
        var isEnabled = window.OrchestratorService && window.OrchestratorService.isEnabled();
        var connectedCount = window.MCPService ? window.MCPService.getConnectedGatewayUrls().length : 0;
        
        // Update toggle switch
        if (this.toggleSwitch) {
            if (isEnabled) {
                this.toggleSwitch.classList.add('active');
            } else {
                this.toggleSwitch.classList.remove('active');
            }
        }
        
        // Update worker count
        if (this.countElement) {
            this.countElement.textContent = connectedCount > 0 ? '(' + connectedCount + ' workers)' : '';
        }
        
        // Update status bar
        if (this.statusBar) {
            if (isEnabled) {
                this.statusBar.classList.add('active');
                this.renderWorkers();
            } else {
                this.statusBar.classList.remove('active');
            }
        }
    };

    /**
     * Render orchestrator workers list in status bar
     */
    OrchestratorUI.prototype.renderWorkers = function() {
        if (!this.workersList || !window.OrchestratorService) return;
        
        var self = this;
        var workers = window.OrchestratorService.getWorkers();
        var html = '';
        
        workers.forEach(function(worker) {
            var hasHistory = self.workerPanelStates[worker.id] && self.workerPanelStates[worker.id].hasContent;
            html += '<div class="orchestrator-worker-chip' + (hasHistory ? ' has-history' : '') + '" data-worker-id="' + escapeHtml(worker.id) + '" title="Click to view worker details">' +
                '<span class="worker-status"></span>' +
                '<span>' + escapeHtml(worker.name) + '</span>' +
                (hasHistory ? '<span class="worker-history-indicator">📋</span>' : '') +
                '</div>';
        });
        
        this.workersList.innerHTML = html;
        
        // Add click handlers to worker chips
        this.bindWorkerChipClicks();
    };

    /**
     * Bind click handlers to worker chips
     */
    OrchestratorUI.prototype.bindWorkerChipClicks = function() {
        var self = this;
        var chips = this.workersList.querySelectorAll('.orchestrator-worker-chip');
        
        chips.forEach(function(chip) {
            chip.addEventListener('click', function() {
                var workerId = chip.getAttribute('data-worker-id');
                if (self.onWorkerClick) {
                    self.onWorkerClick(workerId);
                }
            });
        });
    };

    /**
     * Mark a worker as having content (tool usage history)
     */
    OrchestratorUI.prototype.setWorkerHasContent = function(workerId, hasContent) {
        if (!this.workerPanelStates[workerId]) {
            this.workerPanelStates[workerId] = {};
        }
        this.workerPanelStates[workerId].hasContent = hasContent;
        
        // Update the chip to show indicator
        var chip = this.workersList.querySelector('[data-worker-id="' + workerId + '"]');
        if (chip) {
            if (hasContent) {
                chip.classList.add('has-history');
                // Add indicator if not present
                if (!chip.querySelector('.worker-history-indicator')) {
                    var indicator = document.createElement('span');
                    indicator.className = 'worker-history-indicator';
                    indicator.textContent = '📋';
                    chip.appendChild(indicator);
                }
            } else {
                chip.classList.remove('has-history');
                var indicator = chip.querySelector('.worker-history-indicator');
                if (indicator) indicator.remove();
            }
        }
    };

    /**
     * Clear all worker history states
     */
    OrchestratorUI.prototype.clearWorkerStates = function() {
        this.workerPanelStates = {};
    };

    /**
     * Set worker chip to show active state
     */
    OrchestratorUI.prototype.setWorkerActive = function(workerId, active) {
        if (!this.workersList) return;
        
        var chip = this.workersList.querySelector('[data-worker-id="' + workerId + '"]');
        if (chip) {
            if (active) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        }
    };

    /**
     * Check if orchestrator mode is enabled
     */
    OrchestratorUI.prototype.isEnabled = function() {
        return window.OrchestratorService && window.OrchestratorService.isEnabled();
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.OrchestratorUI = OrchestratorUI;

})();
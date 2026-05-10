/**
 * Token Audit Panel - Shows conversation trace with per-agent token usage
 * Displays grouped table of Bedrock API calls by agent (parent + workers)
 */

(function() {
    'use strict';

    var escapeHtml = window.ChatbotUtils.escapeHtml;

    function TokenAuditPanel() {
        this.entries = [];
        this.overlayEl = null;
        this.contentEl = null;
    }

    TokenAuditPanel.prototype.init = function() {
        // Create overlay using existing tools-panel-overlay pattern
        this.overlayEl = document.createElement('div');
        this.overlayEl.className = 'tools-panel-overlay hidden';
        this.overlayEl.id = 'token-audit-overlay';

        this.overlayEl.innerHTML = '\
            <div class="tools-panel" style="max-width:700px">\
                <div class="tools-panel-header">\
                    <h3>📊 Conversation Trace</h3>\
                    <button class="tools-panel-close" id="token-audit-close">&times;</button>\
                </div>\
                <div class="tools-panel-content" id="token-audit-content">\
                    <p class="token-audit-empty">No trace data yet. Send a message to start.</p>\
                </div>\
            </div>';

        document.body.appendChild(this.overlayEl);
        this.contentEl = document.getElementById('token-audit-content');

        var self = this;
        document.getElementById('token-audit-close').addEventListener('click', function() {
            self.hide();
        });
        this.overlayEl.addEventListener('click', function(e) {
            if (e.target === self.overlayEl) self.hide();
        });
    };

    TokenAuditPanel.prototype.show = function() {
        this.render();
        this.overlayEl.classList.remove('hidden');
    };

    TokenAuditPanel.prototype.hide = function() {
        this.overlayEl.classList.add('hidden');
    };

    /**
     * Add a trace entry
     * @param {string} agentName - Display name of the agent
     * @param {string} agentType - 'parent' or 'worker'
     * @param {string} model - Model ID used
     * @param {Object} usage - {inputTokens, outputTokens} from Bedrock (cumulative for that agent)
     * @param {number} toolCount - Number of tool calls in this response
     */
    TokenAuditPanel.prototype.addEntry = function(agentName, agentType, model, usage, toolCount) {
        if (!usage) return;
        this.entries.push({
            agentName: agentName,
            agentType: agentType,
            model: model || 'unknown',
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
            toolCount: toolCount || 0,
            timestamp: new Date()
        });
        // Live-update if panel is open
        if (!this.overlayEl.classList.contains('hidden')) {
            this.render();
        }
    };

    TokenAuditPanel.prototype.clear = function() {
        this.entries = [];
        if (this.contentEl) {
            this.contentEl.innerHTML = '<p class="token-audit-empty">No trace data yet. Send a message to start.</p>';
        }
    };

    TokenAuditPanel.prototype.render = function() {
        if (!this.contentEl) return;

        if (this.entries.length === 0) {
            this.contentEl.innerHTML = '<p class="token-audit-empty">No trace data yet. Send a message to start.</p>';
            return;
        }

        // Group entries by agent
        var groups = {};
        var groupOrder = [];
        this.entries.forEach(function(e) {
            if (!groups[e.agentName]) {
                groups[e.agentName] = { type: e.agentType, entries: [] };
                groupOrder.push(e.agentName);
            }
            groups[e.agentName].entries.push(e);
        });

        var html = '<table class="token-audit-table">';
        html += '<thead><tr><th>Agent / Call</th><th>Input</th><th>Output</th><th>Total</th><th>Tools</th></tr></thead>';
        html += '<tbody>';

        var grandInput = 0, grandOutput = 0, grandTools = 0;

        groupOrder.forEach(function(name) {
            var group = groups[name];
            var badgeClass = group.type === 'parent' ? 'parent' : 'worker';
            var groupId = 'audit-group-' + name.replace(/[^a-zA-Z0-9]/g, '_');

            // Use last entry's cumulative values as the group total (Bedrock reports cumulative)
            var lastEntry = group.entries[group.entries.length - 1];
            var groupTotalTools = 0;
            group.entries.forEach(function(e) { groupTotalTools += e.toolCount; });

            grandInput += lastEntry.inputTokens;
            grandOutput += lastEntry.outputTokens;
            grandTools += groupTotalTools;

            html += '<tr class="token-audit-group-header" data-group="' + escapeHtml(groupId) + '">';
            html += '<td><span class="toggle-icon">▼</span> ' + escapeHtml(name) +
                '<span class="token-audit-type-badge ' + badgeClass + '">' + badgeClass + '</span></td>';
            html += '<td>' + fmt(lastEntry.inputTokens) + '</td>';
            html += '<td>' + fmt(lastEntry.outputTokens) + '</td>';
            html += '<td>' + fmt(lastEntry.inputTokens + lastEntry.outputTokens) + '</td>';
            html += '<td>' + groupTotalTools + '</td>';
            html += '</tr>';

            group.entries.forEach(function(e, i) {
                var time = e.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                var shortModel = e.model.split('.').pop().split('-').slice(0, 3).join('-');
                html += '<tr class="token-audit-row" data-group="' + escapeHtml(groupId) + '">';
                html += '<td>Call ' + (i + 1) + ' · ' + escapeHtml(shortModel) + ' · ' + time + '</td>';
                html += '<td>' + fmt(e.inputTokens) + '</td>';
                html += '<td>' + fmt(e.outputTokens) + '</td>';
                html += '<td>' + fmt(e.inputTokens + e.outputTokens) + '</td>';
                html += '<td>' + e.toolCount + '</td>';
                html += '</tr>';
            });
        });

        html += '<tr class="token-audit-summary">';
        html += '<td>Total (all agents)</td>';
        html += '<td>' + fmt(grandInput) + '</td>';
        html += '<td>' + fmt(grandOutput) + '</td>';
        html += '<td>' + fmt(grandInput + grandOutput) + '</td>';
        html += '<td>' + grandTools + '</td>';
        html += '</tr>';

        html += '</tbody></table>';
        this.contentEl.innerHTML = html;

        // Bind group toggle
        var headers = this.contentEl.querySelectorAll('.token-audit-group-header');
        headers.forEach(function(header) {
            header.addEventListener('click', function() {
                var groupId = header.getAttribute('data-group');
                var rows = this.contentEl.querySelectorAll('.token-audit-row[data-group="' + groupId + '"]');
                var collapsed = header.classList.toggle('collapsed');
                rows.forEach(function(r) {
                    r.classList.toggle('hidden-row', collapsed);
                });
            }.bind(this));
        }.bind(this));
    };

    function fmt(n) {
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Export
    if (!window.ChatbotUtils) window.ChatbotUtils = {};
    window.ChatbotUtils.TokenAuditPanel = TokenAuditPanel;

})();

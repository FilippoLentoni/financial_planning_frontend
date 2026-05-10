/**
 * Execution Panel — collapsible bottom panel showing workflow run status and logs.
 */
(function() {
    'use strict';

    function ExecutionPanel(container) {
        this.el = container;
        this.status = null; // 'running' | 'success' | 'failed'
        this.logs = [];
        this.canvas = null;
    }

    ExecutionPanel.prototype.init = function(canvas) {
        this.canvas = canvas;
        this.el.innerHTML =
            '<div class="wf-exec-panel" id="wf-exec-panel">' +
                '<div class="wf-exec-header">' +
                    '<span>Execution</span>' +
                    '<div class="wf-exec-status" id="wf-exec-status"></div>' +
                    '<button class="wf-exec-close" id="wf-exec-close" aria-label="Close">&times;</button>' +
                '</div>' +
                '<div class="wf-exec-logs" id="wf-exec-logs"></div>' +
            '</div>';
        var self = this;
        this.panel = this.el.querySelector('#wf-exec-panel');
        this.statusEl = this.el.querySelector('#wf-exec-status');
        this.logsEl = this.el.querySelector('#wf-exec-logs');
        this.el.querySelector('#wf-exec-close').addEventListener('click', function() { self.close(); });

        var ws = window.WorkflowSocketService;
        ws.on('workflow_execution_started', function(d) { self.onStart(d); });
        ws.on('workflow_node_started', function(d) { self.onNodeStart(d); });
        ws.on('workflow_node_completed', function(d) { self.onNodeComplete(d); });
        ws.on('workflow_node_failed', function(d) { self.onNodeFail(d); });
        ws.on('workflow_execution_completed', function(d) { self.onComplete(d); });
    };

    ExecutionPanel.prototype.open = function() { this.panel.classList.add('open'); };
    ExecutionPanel.prototype.close = function() { this.panel.classList.remove('open'); };

    ExecutionPanel.prototype.onStart = function(d) {
        this.logs = [];
        this.status = 'running';
        if (this.canvas) this.canvas.clearStatuses();
        this.addLog('Execution started');
        this.updateStatus();
        this.open();
    };

    ExecutionPanel.prototype.onNodeStart = function(d) {
        if (this.canvas) this.canvas.setNodeStatus(d.node_id, 'running');
        this.addLog('Node ' + d.node_id + ' started');
    };

    ExecutionPanel.prototype.onNodeComplete = function(d) {
        if (this.canvas) this.canvas.setNodeStatus(d.node_id, 'success');
        this.addLog('Node ' + d.node_id + ' completed');
    };

    ExecutionPanel.prototype.onNodeFail = function(d) {
        if (this.canvas) this.canvas.setNodeStatus(d.node_id, 'failed');
        this.addLog('Node ' + d.node_id + ' FAILED: ' + (d.error || 'unknown'));
    };

    ExecutionPanel.prototype.onComplete = function(d) {
        this.status = d.status === 'success' ? 'success' : 'failed';
        this.addLog('Execution ' + (this.status));
        this.updateStatus();
    };

    ExecutionPanel.prototype.addLog = function(msg) {
        var time = new Date().toLocaleTimeString();
        this.logs.push({ time: time, msg: msg });
        var entry = document.createElement('div');
        entry.className = 'wf-exec-log-entry';
        var ts = document.createElement('span');
        ts.className = 'wf-exec-log-time';
        ts.textContent = time;
        var m = document.createElement('span');
        m.textContent = msg;
        entry.appendChild(ts);
        entry.appendChild(m);
        this.logsEl.appendChild(entry);
        this.logsEl.scrollTop = this.logsEl.scrollHeight;
    };

    ExecutionPanel.prototype.updateStatus = function() {
        var s = this.status || 'idle';
        this.statusEl.innerHTML = '<span class="wf-exec-dot ' + s + '"></span><span>' + s.charAt(0).toUpperCase() + s.slice(1) + '</span>';
    };

    window.WfExecutionPanel = ExecutionPanel;
})();

/**
 * Workflow List — left sidebar panel. CRUD via WorkflowSocketService.
 */
(function() {
    'use strict';
    var esc = (window.ChatbotUtils && window.ChatbotUtils.escapeHtml) || function(s) {
        var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    };

    function WorkflowList(container) {
        this.el = container;
        this.workflows = [];
        this.activeId = null;
        this.onSelect = null;  // callback(workflow)
    }

    WorkflowList.prototype.init = function() {
        var self = this;
        this.render();
        var ws = window.WorkflowSocketService;
        ws.on('workflow_list', function(d) { self.workflows = d.workflows || []; self.renderItems(); });
        ws.on('workflow_created', function(d) { self.workflows.push(d.workflow); self.renderItems(); self.select(d.workflow); });
        ws.on('workflow_deleted', function(d) {
            self.workflows = self.workflows.filter(function(w) { return w.workflow_id !== d.workflow_id; });
            if (self.activeId === d.workflow_id) self.activeId = null;
            self.renderItems();
        });
    };

    WorkflowList.prototype.render = function() {
        this.el.innerHTML =
            '<div class="wf-list-header"><span>Workflows</span></div>' +
            '<div class="wf-list-items" id="wf-list-items"></div>' +
            '<button class="wf-list-new" id="wf-list-new-btn">+ New Workflow</button>';
        var self = this;
        this.el.querySelector('#wf-list-new-btn').addEventListener('click', function() { self.createNew(); });
        this.itemsEl = this.el.querySelector('#wf-list-items');
    };

    WorkflowList.prototype.renderItems = function() {
        var self = this;
        if (!this.workflows.length) {
            this.itemsEl.innerHTML = '<div class="wf-list-empty">No workflows yet</div>';
            return;
        }
        this.itemsEl.innerHTML = '';
        this.workflows.forEach(function(wf) {
            var item = document.createElement('div');
            item.className = 'wf-list-item' + (wf.workflow_id === self.activeId ? ' active' : '');
            var nameSpan = document.createElement('span');
            nameSpan.className = 'wf-list-item-name';
            nameSpan.textContent = wf.name || 'Untitled';
            item.appendChild(nameSpan);
            var del = document.createElement('button');
            del.className = 'wf-list-delete';
            del.textContent = '✕';
            del.setAttribute('aria-label', 'Delete workflow');
            del.addEventListener('click', function(e) { e.stopPropagation(); self.deleteWorkflow(wf.workflow_id); });
            item.appendChild(del);
            item.addEventListener('click', function() { self.select(wf); });
            self.itemsEl.appendChild(item);
        });
    };

    WorkflowList.prototype.select = function(wf) {
        if (this.activeId === wf.workflow_id) return;
        if (this.activeId) window.WorkflowSocketService.leaveWorkflow(this.activeId);
        this.activeId = wf.workflow_id;
        var userName = (window.AuthService && window.AuthService.getUserName) ? window.AuthService.getUserName() : 'user';
        window.WorkflowSocketService.joinWorkflow(wf.workflow_id, userName);
        this.renderItems();
        if (this.onSelect) this.onSelect(wf);
    };

    WorkflowList.prototype.createNew = function() {
        var name = prompt('Workflow name:');
        if (!name) return;
        window.WorkflowSocketService.createWorkflow({ name: name, nodes: [], edges: [] });
    };

    WorkflowList.prototype.deleteWorkflow = function(id) {
        if (!confirm('Delete this workflow?')) return;
        window.WorkflowSocketService.deleteWorkflow(id);
    };

    WorkflowList.prototype.leave = function() {
        if (this.activeId) {
            window.WorkflowSocketService.leaveWorkflow(this.activeId);
            this.activeId = null;
        }
    };

    window.WfList = WorkflowList;
})();

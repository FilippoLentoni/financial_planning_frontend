/**
 * Node Editor — right panel for editing selected node properties.
 */
(function() {
    'use strict';
    var esc = function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

    function NodeEditor(container) {
        this.el = container;
        this.node = null;
        this.onChange = null;  // callback(node)
        this.onDelete = null; // callback(nodeId)
    }

    NodeEditor.prototype.init = function() {
        this.el.innerHTML =
            '<div class="wf-editor-panel" id="wf-editor-panel">' +
                '<div class="wf-editor-header"><span id="wf-editor-title">Node</span><button class="wf-editor-close" id="wf-editor-close" aria-label="Close">&times;</button></div>' +
                '<div class="wf-editor-body" id="wf-editor-body"></div>' +
            '</div>';
        var self = this;
        this.panel = this.el.querySelector('#wf-editor-panel');
        this.body = this.el.querySelector('#wf-editor-body');
        this.el.querySelector('#wf-editor-close').addEventListener('click', function() { self.close(); });
    };

    NodeEditor.prototype.open = function(node) {
        this.node = node;
        if (!node) { this.close(); return; }
        this.panel.classList.add('open');
        this.el.querySelector('#wf-editor-title').textContent = (window.WF_NODE_TYPES[node.type] || {}).icon + ' ' + node.type;
        this.renderFields();
    };

    NodeEditor.prototype.close = function() {
        this.panel.classList.remove('open');
        this.node = null;
    };

    NodeEditor.prototype.renderFields = function() {
        var self = this;
        var n = this.node;
        var html = '';
        // Type badge
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Type</label><div class="wf-editor-type-badge">' +
            esc((window.WF_NODE_TYPES[n.type] || {}).icon || '') + ' ' + esc(n.type) + '</div></div>';
        // Label
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Label</label>' +
            '<input class="wf-editor-input" id="wf-ed-label" value="' + esc(n.label) + '"></div>';

        // Type-specific fields
        if (n.type === 'start') {
            html += '<div class="wf-editor-field"><label class="wf-editor-label">System Prompt</label>' +
                '<textarea class="wf-editor-textarea" id="wf-ed-system-prompt" placeholder="You are a helpful assistant...">' + esc(n.config.system_prompt || '') + '</textarea></div>';
            html += '<div class="wf-editor-field"><label class="wf-editor-label">User Prompt</label>' +
                '<textarea class="wf-editor-textarea" id="wf-ed-prompt" placeholder="Describe the task...">' + esc(n.config.prompt_template || '') + '</textarea></div>';
            html += '<div class="wf-editor-field"><label class="wf-editor-label">Mode</label>' +
                '<select class="wf-editor-select" id="wf-ed-mode">' +
                '<option value="thinking"' + (n.config.mode !== 'action' ? ' selected' : '') + '>🧠 Thinking (Sonnet)</option>' +
                '<option value="action"' + (n.config.mode === 'action' ? ' selected' : '') + '>⚡ Action (Haiku)</option>' +
                '</select></div>';
            html += this.gatewayToolFields(n);
        } else if (n.type === 'action') {
            html += this.actionFields(n);
        } else if (n.type === 'condition') {
            html += '<div class="wf-editor-field"><label class="wf-editor-label">Expression</label>' +
                '<input class="wf-editor-input" id="wf-ed-expr" placeholder="result.feasible === true" value="' + esc(n.config.expression || '') + '"></div>';
        } else if (n.type === 'agent_prompt') {
            html += '<div class="wf-editor-field"><label class="wf-editor-label">Prompt Template</label>' +
                '<textarea class="wf-editor-textarea" id="wf-ed-prompt">' + esc(n.config.prompt_template || '') + '</textarea></div>';
            html += '<div class="wf-editor-field"><label class="wf-editor-label">Mode</label>' +
                '<select class="wf-editor-select" id="wf-ed-mode">' +
                '<option value="thinking"' + (n.config.mode !== 'action' ? ' selected' : '') + '>🧠 Thinking (Sonnet)</option>' +
                '<option value="action"' + (n.config.mode === 'action' ? ' selected' : '') + '>⚡ Action (Haiku)</option>' +
                '</select></div>';
            html += this.gatewayToolFields(n);
        } else if (n.type === 'parallel') {
            html += '<div class="wf-editor-field"><label class="wf-editor-label">Join Strategy</label>' +
                '<select class="wf-editor-select" id="wf-ed-join">' +
                '<option value="all"' + (n.config.join_strategy === 'all' ? ' selected' : '') + '>All (wait for all)</option>' +
                '<option value="any"' + (n.config.join_strategy === 'any' ? ' selected' : '') + '>Any (first to finish)</option>' +
                '</select></div>';
        } else if (n.type === 'delay') {
            html += '<div class="wf-editor-field"><label class="wf-editor-label">Duration (seconds)</label>' +
                '<input class="wf-editor-input" id="wf-ed-delay" type="number" value="' + esc(String(n.config.duration_seconds || '')) + '"></div>';
        }

        html += '<button class="wf-editor-delete" id="wf-ed-delete">Delete Node</button>';
        this.body.innerHTML = html;

        // Bind change events
        this.bindInput('wf-ed-label', function(v) { n.label = v; self.emitChange(); });
        this.bindInput('wf-ed-system-prompt', function(v) { n.config.system_prompt = v; self.emitChange(); });
        this.bindInput('wf-ed-expr', function(v) { n.config.expression = v; self.emitChange(); });
        this.bindInput('wf-ed-prompt', function(v) { n.config.prompt_template = v; self.emitChange(); });
        this.bindInput('wf-ed-mode', function(v) { n.config.mode = v; self.emitChange(); });
        this.bindInput('wf-ed-join', function(v) { n.config.join_strategy = v; self.emitChange(); });
        this.bindInput('wf-ed-delay', function(v) { n.config.duration_seconds = parseInt(v) || 0; self.emitChange(); });
        this.bindInput('wf-ed-gateway', function(v) { n.config.gateway = v; self.updateToolDropdown(n); self.bindToolCheckboxes(n); self.emitChange(); });
        this.bindInput('wf-ed-tool', function(v) { n.config.tool_name = v; self.updateParamFields(n); self.emitChange(); });

        var delBtn = this.body.querySelector('#wf-ed-delete');
        if (delBtn) delBtn.addEventListener('click', function() { if (self.onDelete) self.onDelete(n.id); self.close(); });

        // Render tool checkboxes for start/agent_prompt nodes
        this.bindToolCheckboxes(n);
    };

    NodeEditor.prototype.actionFields = function(n) {
        var html = '';
        // Gateway dropdown
        var servers = (window.MCPService && window.MCPService.getConnectedServers) ? window.MCPService.getConnectedServers() : [];
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Gateway</label><select class="wf-editor-select" id="wf-ed-gateway">' +
            '<option value="">Select gateway...</option>';
        servers.forEach(function(s) {
            var name = s.name || s.url || '';
            html += '<option value="' + esc(name) + '"' + (n.config.gateway === name ? ' selected' : '') + '>' + esc(name) + '</option>';
        });
        html += '</select></div>';
        // Tool dropdown
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Tool</label><select class="wf-editor-select" id="wf-ed-tool">' +
            '<option value="">Select tool...</option>';
        var tools = this.getToolsForGateway(n.config.gateway);
        tools.forEach(function(t) {
            html += '<option value="' + esc(t.name) + '"' + (n.config.tool_name === t.name ? ' selected' : '') + '>' + esc(t.name) + '</option>';
        });
        html += '</select></div>';
        // Parameters
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Parameters</label><div class="wf-editor-params" id="wf-ed-params"></div></div>';
        return html;
    };

    NodeEditor.prototype.gatewayToolFields = function(n) {
        var html = '';
        var servers = (window.MCPService && window.MCPService.getConnectedServers) ? window.MCPService.getConnectedServers() : [];
        n.config.selected_tools = n.config.selected_tools || [];
        // Gateway dropdown
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Gateway</label><select class="wf-editor-select" id="wf-ed-gateway">' +
            '<option value="">None (no tools)</option>';
        servers.forEach(function(s) {
            var name = s.name || s.url || '';
            html += '<option value="' + esc(name) + '"' + (n.config.gateway === name ? ' selected' : '') + '>' + esc(name) + '</option>';
        });
        html += '</select></div>';
        // Tool checkboxes
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Tools</label><div class="wf-editor-tools" id="wf-ed-tools"></div></div>';
        return html;
    };

    NodeEditor.prototype.bindToolCheckboxes = function(n) {
        var container = this.body.querySelector('#wf-ed-tools');
        if (!container) return;
        var self = this;
        var tools = this.getToolsForGateway(n.config.gateway);
        if (!tools.length) { container.innerHTML = '<span style="font-size:0.75rem;color:var(--gray-text)">Select a gateway to see tools</span>'; return; }
        n.config.selected_tools = n.config.selected_tools || [];
        container.innerHTML = '';
        tools.forEach(function(t) {
            var label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:0.75rem;padding:2px 0;cursor:pointer;';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = n.config.selected_tools.indexOf(t.name) !== -1;
            cb.addEventListener('change', function() {
                if (cb.checked) { if (n.config.selected_tools.indexOf(t.name) === -1) n.config.selected_tools.push(t.name); }
                else { n.config.selected_tools = n.config.selected_tools.filter(function(x) { return x !== t.name; }); }
                self.emitChange();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(t.name));
            container.appendChild(label);
        });
    };

    NodeEditor.prototype.actionFields = function(n) {
        var html = '';
        var servers = (window.MCPService && window.MCPService.getConnectedServers) ? window.MCPService.getConnectedServers() : [];
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Gateway</label><select class="wf-editor-select" id="wf-ed-gateway">' +
            '<option value="">Select gateway...</option>';
        servers.forEach(function(s) {
            var name = s.name || s.url || '';
            html += '<option value="' + esc(name) + '"' + (n.config.gateway === name ? ' selected' : '') + '>' + esc(name) + '</option>';
        });
        html += '</select></div>';
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Tool</label><select class="wf-editor-select" id="wf-ed-tool">' +
            '<option value="">Select tool...</option>';
        var tools = this.getToolsForGateway(n.config.gateway);
        tools.forEach(function(t) {
            html += '<option value="' + esc(t.name) + '"' + (n.config.tool_name === t.name ? ' selected' : '') + '>' + esc(t.name) + '</option>';
        });
        html += '</select></div>';
        html += '<div class="wf-editor-field"><label class="wf-editor-label">Parameters</label><div class="wf-editor-params" id="wf-ed-params"></div></div>';
        return html;
    };

    NodeEditor.prototype.getToolsForGateway = function(gateway) {
        if (!gateway || !window.MCPService) return [];
        var all = window.MCPService.getAllTools ? window.MCPService.getAllTools() : [];
        return all; // In practice, filter by gateway
    };

    NodeEditor.prototype.updateToolDropdown = function(n) {
        var sel = this.body.querySelector('#wf-ed-tool');
        if (!sel) return;
        var tools = this.getToolsForGateway(n.config.gateway);
        sel.innerHTML = '<option value="">Select tool...</option>';
        tools.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.name;
            sel.appendChild(opt);
        });
    };

    NodeEditor.prototype.updateParamFields = function(n) {
        var container = this.body.querySelector('#wf-ed-params');
        if (!container) return;
        var tools = this.getToolsForGateway(n.config.gateway);
        var tool = tools.find(function(t) { return t.name === n.config.tool_name; });
        if (!tool || !tool.inputSchema || !tool.inputSchema.properties) {
            container.innerHTML = '<span style="font-size:0.75rem;color:var(--gray-text)">Select a tool to configure parameters</span>';
            return;
        }
        var self = this;
        n.config.parameters = n.config.parameters || {};
        container.innerHTML = '';
        Object.keys(tool.inputSchema.properties).forEach(function(key) {
            var row = document.createElement('div');
            row.className = 'wf-editor-param-row';
            var lbl = document.createElement('span');
            lbl.textContent = key;
            lbl.style.fontSize = '0.75rem';
            lbl.style.minWidth = '80px';
            var inp = document.createElement('input');
            inp.value = n.config.parameters[key] || '';
            inp.addEventListener('input', function() { n.config.parameters[key] = inp.value; self.emitChange(); });
            row.appendChild(lbl);
            row.appendChild(inp);
            container.appendChild(row);
        });
    };

    NodeEditor.prototype.bindInput = function(id, cb) {
        var el = this.body.querySelector('#' + id);
        if (!el) return;
        el.addEventListener('input', function() { cb(el.value); });
        el.addEventListener('change', function() { cb(el.value); });
    };

    NodeEditor.prototype.emitChange = function() {
        if (this.node && this.onChange) this.onChange(this.node);
    };

    window.WfNodeEditor = NodeEditor;
})();

/**
 * Workflow Builder — entry point. Wires together all sub-components.
 * Lazy-initialized on first tab activation.
 */
(function() {
    'use strict';

    function WorkflowBuilder(rootEl) {
        this.root = rootEl;
        this.initialized = false;
        this.list = null;
        this.toolbar = null;
        this.canvas = null;
        this.editor = null;
        this.collab = null;
        this.execPanel = null;
        this.undoStack = [];
        this.redoStack = [];
        this.contextMenu = null;
    }

    WorkflowBuilder.prototype.init = function() {
        if (this.initialized) return;
        this.initialized = true;
        this.root.innerHTML =
            '<div class="wf-builder">' +
                '<div id="wf-toolbar-root"></div>' +
                '<div class="wf-body">' +
                    '<div class="wf-list-panel" id="wf-list-root"></div>' +
                    '<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
                        '<div id="wf-canvas-root" style="flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden;"></div>' +
                        '<div id="wf-exec-root"></div>' +
                    '</div>' +
                    '<div id="wf-editor-root"></div>' +
                '</div>' +
            '</div>' +
            '<div class="wf-context-menu" id="wf-context-menu"></div>';

        this.toolbar = new window.WfToolbar(this.root.querySelector('#wf-toolbar-root'));
        this.toolbar.init();
        this.list = new window.WfList(this.root.querySelector('#wf-list-root'));
        this.list.init();
        this.canvas = new window.WfCanvas(this.root.querySelector('#wf-canvas-root'));
        this.canvas.init();
        this.editor = new window.WfNodeEditor(this.root.querySelector('#wf-editor-root'));
        this.editor.init();
        this.execPanel = new window.WfExecutionPanel(this.root.querySelector('#wf-exec-root'));
        this.execPanel.init(this.canvas);
        this.collab = new window.WfCollaboration(this.canvas.wrap);
        this.collab.init();
        this.contextMenu = this.root.querySelector('#wf-context-menu');

        this.wireEvents();
        this.bindKeyboard();
        this.connectWebSocket();
    };

    WorkflowBuilder.prototype.wireEvents = function() {
        var self = this;

        // List → Canvas
        this.list.onSelect = function(wf) {
            // workflow_state event will load the canvas
        };
        window.WorkflowSocketService.on('workflow_state', function(d) {
            self.canvas.loadState(d.workflow || d);
            self.collab.users = d.users || [];
            self.toolbar.setUsers(d.users || []);
            self.undoStack = [];
            self.redoStack = [];
        });

        // Toolbar actions
        this.toolbar.onAddNode = function(type) { self.pushUndo(); self.canvas.addNode(type); };
        this.toolbar.onRun = function() {
            if (self.list.activeId) window.WorkflowSocketService.executeWorkflow(self.list.activeId);
        };
        this.toolbar.onUndo = function() { self.undo(); };
        this.toolbar.onRedo = function() { self.redo(); };
        this.toolbar.onDelete = function() { self.deleteSelected(); };

        // Canvas → Editor
        this.canvas.onNodeSelect = function(node) {
            self.editor.open(node);
            window.WorkflowSocketService.broadcast('node_select', { node_id: node.id });
        };
        this.canvas.onNodeDeselect = function() {
            if (self.editor.node) window.WorkflowSocketService.broadcast('node_deselect', { node_id: self.editor.node.id });
            self.editor.close();
        };

        // Canvas broadcasts
        this.canvas.onNodesChange = function(op, data) {
            window.WorkflowSocketService.broadcastDebounced(op, data, 150);
        };
        this.canvas.onEdgesChange = function(op, data) {
            window.WorkflowSocketService.broadcast(op, data);
        };
        this.canvas.onCursorMove = function(pos) {
            window.WorkflowSocketService.broadcastThrottled('cursor_move', pos, 50);
        };

        // Editor → Canvas + broadcast
        this.editor.onChange = function(node) {
            self.canvas.renderNode(node);
            window.WorkflowSocketService.broadcastDebounced('node_config', { id: node.id, label: node.label, config: node.config }, 150);
        };
        this.editor.onDelete = function(id) { self.pushUndo(); self.canvas.removeNode(id); };

        // Collaboration → Canvas + Toolbar
        this.collab.onUsersChange = function(users) { self.toolbar.setUsers(users); };
        window.WorkflowSocketService.on('op', function(msg) { self.collab.handleOp(msg, self.canvas); });

        // Context menu
        this.canvas.wrap.addEventListener('contextmenu', function(e) { e.preventDefault(); self.showContextMenu(e); });
        document.addEventListener('click', function() { self.hideContextMenu(); });
    };

    // --- Undo / Redo ---
    WorkflowBuilder.prototype.pushUndo = function() {
        this.undoStack.push(this.snapshot());
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
    };

    WorkflowBuilder.prototype.snapshot = function() {
        return JSON.stringify({ nodes: this.canvas.nodes, edges: this.canvas.edges });
    };

    WorkflowBuilder.prototype.restore = function(snap) {
        var s = JSON.parse(snap);
        this.canvas.nodes = s.nodes;
        this.canvas.edges = s.edges;
        this.canvas.renderAll();
    };

    WorkflowBuilder.prototype.undo = function() {
        if (!this.undoStack.length) return;
        this.redoStack.push(this.snapshot());
        this.restore(this.undoStack.pop());
    };

    WorkflowBuilder.prototype.redo = function() {
        if (!this.redoStack.length) return;
        this.undoStack.push(this.snapshot());
        this.restore(this.redoStack.pop());
    };

    // --- Keyboard ---
    WorkflowBuilder.prototype.bindKeyboard = function() {
        var self = this;
        document.addEventListener('keydown', function(e) {
            // Only handle when workflow tab is active
            if (window.TabBar && window.TabBar.activeTab !== 'workflows') return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); self.undo(); }
            else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); self.redo(); }
            else if ((e.ctrlKey || e.metaKey) && e.key === 'Z') { e.preventDefault(); self.redo(); }
            else if (e.key === 'Delete' || e.key === 'Backspace') { self.deleteSelected(); }
            else if (e.key === 'Escape') { self.canvas.deselectAll(); }
            else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                self.canvas.htmlLayer.querySelectorAll('.wf-node').forEach(function(el) { el.classList.add('selected'); });
            }
        });
    };

    WorkflowBuilder.prototype.deleteSelected = function() {
        if (this.canvas.selectedNodeId) {
            this.pushUndo();
            this.canvas.removeNode(this.canvas.selectedNodeId);
            this.editor.close();
        } else if (this.canvas.selectedEdgeIdx !== null) {
            this.pushUndo();
            this.canvas.removeEdge(this.canvas.selectedEdgeIdx);
        }
    };

    // --- Context Menu ---
    WorkflowBuilder.prototype.showContextMenu = function(e) {
        var self = this;
        var nodeEl = e.target.closest('.wf-node');
        var items = [];
        if (nodeEl) {
            var id = nodeEl.getAttribute('data-id');
            items.push({ label: '✏️ Edit', action: function() { self.canvas.selectNode(id); } });
            items.push({ label: '📋 Duplicate', action: function() { self.duplicateNode(id); } });
            items.push({ sep: true });
            items.push({ label: '🗑 Delete', action: function() { self.pushUndo(); self.canvas.removeNode(id); self.editor.close(); } });
        } else {
            var types = window.WF_NODE_TYPES || {};
            Object.keys(types).forEach(function(t) {
                items.push({ label: types[t].icon + ' Add ' + types[t].label, action: function() {
                    var r = self.canvas.wrap.getBoundingClientRect();
                    var pos = { x: (e.clientX - r.left - self.canvas.pan.x) / self.canvas.zoom, y: (e.clientY - r.top - self.canvas.pan.y) / self.canvas.zoom };
                    self.pushUndo();
                    self.canvas.addNode(t, pos);
                }});
            });
        }
        this.contextMenu.innerHTML = '';
        items.forEach(function(item) {
            if (item.sep) {
                var sep = document.createElement('div');
                sep.className = 'wf-context-sep';
                self.contextMenu.appendChild(sep);
            } else {
                var btn = document.createElement('button');
                btn.className = 'wf-context-item';
                btn.textContent = item.label;
                btn.addEventListener('click', function() { self.hideContextMenu(); item.action(); });
                self.contextMenu.appendChild(btn);
            }
        });
        this.contextMenu.style.left = e.clientX + 'px';
        this.contextMenu.style.top = e.clientY + 'px';
        this.contextMenu.classList.add('open');
    };

    WorkflowBuilder.prototype.hideContextMenu = function() {
        if (this.contextMenu) this.contextMenu.classList.remove('open');
    };

    WorkflowBuilder.prototype.duplicateNode = function(id) {
        var orig = this.canvas.getNode(id);
        if (!orig) return;
        this.pushUndo();
        var n = this.canvas.addNode(orig.type, { x: orig.position.x + 40, y: orig.position.y + 40 });
        n.label = orig.label + ' (copy)';
        n.config = JSON.parse(JSON.stringify(orig.config));
        this.canvas.renderNode(n);
    };

    // --- WebSocket connection ---
    WorkflowBuilder.prototype.connectWebSocket = function() {
        var wsUrl = (window.APP_CONFIG && window.APP_CONFIG.workflowWsUrl) || '';
        if (!wsUrl) { console.warn('[WorkflowBuilder] No workflowWsUrl configured'); return; }
        var ws = window.WorkflowSocketService;
        if (ws.connected) { ws.listWorkflows(); return; }
        ws.connect(wsUrl).then(function() { ws.listWorkflows(); }).catch(function(err) {
            console.error('[WorkflowBuilder] WebSocket connect failed:', err);
        });
    };

    WorkflowBuilder.prototype.onActivate = function() {
        if (!this.initialized) this.init();
        else if (window.WorkflowSocketService.connected) window.WorkflowSocketService.listWorkflows();
        else this.connectWebSocket();
    };

    WorkflowBuilder.prototype.onDeactivate = function() {
        if (this.list) this.list.leave();
    };

    window.WorkflowBuilder = WorkflowBuilder;
})();

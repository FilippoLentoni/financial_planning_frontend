/**
 * Workflow Canvas — SVG (grid + edges) + HTML overlay (nodes).
 * Pan, zoom, node drag, edge drawing, port connections.
 */
(function() {
    'use strict';

    var NODE_TYPES = {
        start:        { icon: '▶', label: 'Start' },
        action:       { icon: '⚡', label: 'Action' },
        condition:    { icon: '◆', label: 'Condition' },
        parallel:     { icon: '═', label: 'Parallel' },
        delay:        { icon: '⏱', label: 'Delay' },
        agent_prompt: { icon: '🤖', label: 'Agent Prompt' },
        end:          { icon: '⏹', label: 'End' }
    };

    function Canvas(container) {
        this.el = container;
        this.nodes = [];
        this.edges = [];
        this.pan = { x: 0, y: 0 };
        this.zoom = 1;
        this.selectedNodeId = null;
        this.selectedEdgeIdx = null;
        this.dragging = null;   // { nodeId, startX, startY, origX, origY }
        this.panning = null;    // { startX, startY, origPanX, origPanY }
        this.connecting = null; // { fromId, fromPort, tempLine }
        this.onNodeSelect = null;
        this.onNodeDeselect = null;
        this.onNodesChange = null;
        this.onEdgesChange = null;
        this.onCursorMove = null;
    }

    Canvas.prototype.init = function() {
        this.el.innerHTML =
            '<div class="wf-canvas-wrap" id="wf-canvas-wrap">' +
                '<svg class="wf-svg-layer" id="wf-svg-layer">' +
                    '<defs><pattern id="wf-grid" width="20" height="20" patternUnits="userSpaceOnUse">' +
                        '<path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--wf-canvas-grid)" stroke-width="0.5"/>' +
                    '</pattern></defs>' +
                    '<rect width="100%" height="100%" fill="url(#wf-grid)"/>' +
                    '<g id="wf-edges-g"></g>' +
                '</svg>' +
                '<div class="wf-html-layer" id="wf-html-layer"></div>' +
                '<div class="wf-zoom-info" id="wf-zoom-info">100%</div>' +
            '</div>';
        this.wrap = this.el.querySelector('#wf-canvas-wrap');
        this.svgLayer = this.el.querySelector('#wf-svg-layer');
        this.edgesG = this.el.querySelector('#wf-edges-g');
        this.htmlLayer = this.el.querySelector('#wf-html-layer');
        this.zoomInfo = this.el.querySelector('#wf-zoom-info');
        this.bindEvents();
        this.applyTransform();
    };

    Canvas.prototype.bindEvents = function() {
        var self = this;
        this.wrap.addEventListener('mousedown', function(e) { self.onMouseDown(e); });
        window.addEventListener('mousemove', function(e) { self.onMouseMove(e); });
        window.addEventListener('mouseup', function(e) { self.onMouseUp(e); });
        this.wrap.addEventListener('wheel', function(e) { self.onWheel(e); }, { passive: false });
        this.wrap.addEventListener('mousemove', function(e) {
            if (self.onCursorMove) {
                var r = self.wrap.getBoundingClientRect();
                self.onCursorMove({ x: (e.clientX - r.left - self.pan.x) / self.zoom, y: (e.clientY - r.top - self.pan.y) / self.zoom });
            }
        });
    };

    // --- Transform ---
    Canvas.prototype.applyTransform = function() {
        var t = 'translate(' + this.pan.x + 'px,' + this.pan.y + 'px) scale(' + this.zoom + ')';
        this.svgLayer.style.transform = t;
        this.htmlLayer.style.transform = t;
        this.zoomInfo.textContent = Math.round(this.zoom * 100) + '%';
    };

    // --- Mouse handlers ---
    Canvas.prototype.onMouseDown = function(e) {
        if (e.button !== 0) return;
        var nodeEl = e.target.closest('.wf-node');
        var portEl = e.target.closest('.wf-port');
        if (portEl && nodeEl) {
            // Start edge connection
            var nodeId = nodeEl.getAttribute('data-id');
            var portType = portEl.getAttribute('data-port');
            if (portType && portType.startsWith('out')) {
                this.connecting = { fromId: nodeId, fromPort: portType };
                e.preventDefault();
            }
            return;
        }
        if (nodeEl) {
            var id = nodeEl.getAttribute('data-id');
            this.selectNode(id);
            var node = this.getNode(id);
            if (node) {
                this.dragging = { nodeId: id, startX: e.clientX, startY: e.clientY, origX: node.position.x, origY: node.position.y };
            }
            e.preventDefault();
            return;
        }
        // Click on empty canvas — deselect and start panning
        this.deselectAll();
        this.panning = { startX: e.clientX, startY: e.clientY, origPanX: this.pan.x, origPanY: this.pan.y };
        this.wrap.classList.add('grabbing');
    };

    Canvas.prototype.onMouseMove = function(e) {
        if (this.dragging) {
            var dx = (e.clientX - this.dragging.startX) / this.zoom;
            var dy = (e.clientY - this.dragging.startY) / this.zoom;
            var node = this.getNode(this.dragging.nodeId);
            if (node) {
                node.position.x = this.dragging.origX + dx;
                node.position.y = this.dragging.origY + dy;
                this.renderNode(node);
                this.renderEdges();
            }
        } else if (this.panning) {
            this.pan.x = this.panning.origPanX + (e.clientX - this.panning.startX);
            this.pan.y = this.panning.origPanY + (e.clientY - this.panning.startY);
            this.applyTransform();
        }
    };

    Canvas.prototype.onMouseUp = function(e) {
        if (this.dragging) {
            var node = this.getNode(this.dragging.nodeId);
            if (node && this.onNodesChange) this.onNodesChange('node_move', node);
            this.dragging = null;
        }
        if (this.connecting) {
            var portEl = e.target.closest('.wf-port');
            var nodeEl = e.target.closest('.wf-node');
            if (portEl && nodeEl) {
                var toId = nodeEl.getAttribute('data-id');
                var toPort = portEl.getAttribute('data-port');
                if (toPort === 'in' && toId !== this.connecting.fromId) {
                    this.addEdge(this.connecting.fromId, toId, this.connecting.fromPort === 'out-true' ? 'true' : this.connecting.fromPort === 'out-false' ? 'false' : '');
                }
            }
            this.connecting = null;
        }
        if (this.panning) {
            this.panning = null;
            this.wrap.classList.remove('grabbing');
        }
    };

    Canvas.prototype.onWheel = function(e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? -0.08 : 0.08;
        this.zoom = Math.min(2, Math.max(0.25, this.zoom + delta));
        this.applyTransform();
    };

    // --- Node helpers ---
    Canvas.prototype.getNode = function(id) {
        return this.nodes.find(function(n) { return n.id === id; });
    };

    Canvas.prototype.selectNode = function(id) {
        this.selectedNodeId = id;
        this.selectedEdgeIdx = null;
        this.htmlLayer.querySelectorAll('.wf-node').forEach(function(el) {
            el.classList.toggle('selected', el.getAttribute('data-id') === id);
        });
        if (this.onNodeSelect) this.onNodeSelect(this.getNode(id));
    };

    Canvas.prototype.deselectAll = function() {
        this.selectedNodeId = null;
        this.selectedEdgeIdx = null;
        this.htmlLayer.querySelectorAll('.wf-node.selected').forEach(function(el) { el.classList.remove('selected'); });
        if (this.onNodeDeselect) this.onNodeDeselect();
    };

    Canvas.prototype.addNode = function(type, pos) {
        var info = NODE_TYPES[type] || NODE_TYPES.action;
        var node = {
            id: 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            type: type,
            label: info.label,
            position: pos || { x: (-this.pan.x + 400) / this.zoom, y: (-this.pan.y + 250) / this.zoom },
            config: {},
            inputs: [],
            outputs: []
        };
        this.nodes.push(node);
        this.renderNode(node);
        if (this.onNodesChange) this.onNodesChange('node_add', node);
        return node;
    };

    Canvas.prototype.removeNode = function(id) {
        var node = this.getNode(id);
        if (!node) return;
        this.nodes = this.nodes.filter(function(n) { return n.id !== id; });
        this.edges = this.edges.filter(function(e) { return e.from !== id && e.to !== id; });
        var el = this.htmlLayer.querySelector('[data-id="' + id + '"]');
        if (el) el.remove();
        this.renderEdges();
        if (this.onNodesChange) this.onNodesChange('node_remove', { id: id });
    };

    Canvas.prototype.addEdge = function(from, to, label) {
        if (this.edges.some(function(e) { return e.from === from && e.to === to; })) return;
        var edge = { from: from, to: to, label: label || '' };
        this.edges.push(edge);
        this.renderEdges();
        if (this.onEdgesChange) this.onEdgesChange('edge_add', edge);
    };

    Canvas.prototype.removeEdge = function(idx) {
        var edge = this.edges[idx];
        if (!edge) return;
        this.edges.splice(idx, 1);
        this.renderEdges();
        if (this.onEdgesChange) this.onEdgesChange('edge_remove', edge);
    };

    // --- Rendering ---
    Canvas.prototype.renderAll = function() {
        var self = this;
        this.htmlLayer.innerHTML = '';
        this.nodes.forEach(function(n) { self.renderNode(n); });
        this.renderEdges();
    };

    Canvas.prototype.renderNode = function(node) {
        var info = NODE_TYPES[node.type] || NODE_TYPES.action;
        var existing = this.htmlLayer.querySelector('[data-id="' + node.id + '"]');
        var el = existing || document.createElement('div');
        if (!existing) {
            el.className = 'wf-node';
            el.setAttribute('data-id', node.id);
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', node.label + ' node');
            // Ports
            if (node.type !== 'start') {
                var portIn = document.createElement('div');
                portIn.className = 'wf-port wf-port-in';
                portIn.setAttribute('data-port', 'in');
                el.appendChild(portIn);
            }
            if (node.type !== 'end') {
                if (node.type === 'condition') {
                    var pTrue = document.createElement('div');
                    pTrue.className = 'wf-port wf-port-out-true';
                    pTrue.setAttribute('data-port', 'out-true');
                    pTrue.title = 'True';
                    el.appendChild(pTrue);
                    var pFalse = document.createElement('div');
                    pFalse.className = 'wf-port wf-port-out-false';
                    pFalse.setAttribute('data-port', 'out-false');
                    pFalse.title = 'False';
                    el.appendChild(pFalse);
                } else {
                    var portOut = document.createElement('div');
                    portOut.className = 'wf-port wf-port-out';
                    portOut.setAttribute('data-port', 'out');
                    el.appendChild(portOut);
                }
            }
            // Remote selection indicator
            var rs = document.createElement('div');
            rs.className = 'wf-node-remote-select';
            el.appendChild(rs);
            // Status badge
            var sb = document.createElement('div');
            sb.className = 'wf-node-status';
            el.appendChild(sb);
            this.htmlLayer.appendChild(el);
        }
        // Update content (safe — textContent only)
        var iconSpan = el.querySelector('.wf-node-icon');
        var labelSpan = el.querySelector('.wf-node-label');
        if (!iconSpan) {
            iconSpan = document.createElement('span');
            iconSpan.className = 'wf-node-icon';
            el.insertBefore(iconSpan, el.querySelector('.wf-port') || el.firstChild);
        }
        if (!labelSpan) {
            labelSpan = document.createElement('span');
            labelSpan.className = 'wf-node-label';
            iconSpan.after(labelSpan);
        }
        iconSpan.textContent = info.icon;
        labelSpan.textContent = node.label;
        el.style.left = node.position.x + 'px';
        el.style.top = node.position.y + 'px';
        if (node.id === this.selectedNodeId) el.classList.add('selected');
    };

    Canvas.prototype.renderEdges = function() {
        var self = this;
        this.edgesG.innerHTML = '';
        this.edges.forEach(function(edge, idx) {
            var fromNode = self.getNode(edge.from);
            var toNode = self.getNode(edge.to);
            if (!fromNode || !toNode) return;
            var nw = 160, nh = 56;
            var fromX = fromNode.position.x + nw;
            var fromY = fromNode.position.y + (edge.label === 'true' ? nh * 0.3 : edge.label === 'false' ? nh * 0.7 : nh / 2);
            var toX = toNode.position.x;
            var toY = toNode.position.y + nh / 2;
            var dx = Math.abs(toX - fromX) * 0.5;
            var d = 'M ' + fromX + ' ' + fromY + ' C ' + (fromX + dx) + ' ' + fromY + ', ' + (toX - dx) + ' ' + toY + ', ' + toX + ' ' + toY;
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'var(--wf-edge-color)');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('class', 'wf-edge');
            path.setAttribute('data-idx', idx);
            path.addEventListener('click', function() { self.selectedEdgeIdx = idx; });
            self.edgesG.appendChild(path);
            if (edge.label) {
                var mx = (fromX + toX) / 2, my = (fromY + toY) / 2;
                var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', mx);
                text.setAttribute('y', my - 6);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('font-size', '10');
                text.setAttribute('fill', 'var(--gray-text)');
                text.textContent = edge.label;
                self.edgesG.appendChild(text);
            }
        });
    };

    Canvas.prototype.loadState = function(workflow) {
        this.nodes = (workflow.nodes || []).map(function(n) {
            return { id: n.id, type: n.type, label: n.label, position: { x: n.position.x, y: n.position.y }, config: n.config || {}, inputs: n.inputs || [], outputs: n.outputs || [] };
        });
        this.edges = (workflow.edges || []).map(function(e) {
            return { from: e.from, to: e.to, label: e.label || '' };
        });
        this.renderAll();
    };

    Canvas.prototype.setNodeStatus = function(nodeId, status) {
        var el = this.htmlLayer.querySelector('[data-id="' + nodeId + '"]');
        if (!el) return;
        el.classList.remove('running', 'success', 'failed', 'pending');
        if (status) el.classList.add(status);
        var badge = el.querySelector('.wf-node-status');
        if (badge) badge.textContent = status === 'success' ? '✓' : status === 'failed' ? '✕' : status === 'running' ? '…' : '';
    };

    Canvas.prototype.clearStatuses = function() {
        this.htmlLayer.querySelectorAll('.wf-node').forEach(function(el) {
            el.classList.remove('running', 'success', 'failed', 'pending');
            var b = el.querySelector('.wf-node-status'); if (b) b.textContent = '';
        });
    };

    window.WfCanvas = Canvas;
    window.WF_NODE_TYPES = NODE_TYPES;
})();

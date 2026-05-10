/**
 * Collaboration — user presence, remote cursors, remote node selection.
 */
(function() {
    'use strict';

    function Collaboration(canvasWrap) {
        this.canvasWrap = canvasWrap;
        this.users = [];
        this.cursors = {};  // userId → { el, timer }
        this.onUsersChange = null;
    }

    Collaboration.prototype.init = function() {
        var self = this;
        var ws = window.WorkflowSocketService;
        ws.on('user_joined', function(d) { self.addUser(d); });
        ws.on('user_left', function(d) { self.removeUser(d); });
        ws.on('workflow_state', function(d) { self.users = d.users || []; self.notify(); });
    };

    Collaboration.prototype.addUser = function(u) {
        if (!this.users.find(function(x) { return x.user_id === u.user_id; })) {
            this.users.push(u);
        }
        this.notify();
    };

    Collaboration.prototype.removeUser = function(u) {
        this.users = this.users.filter(function(x) { return x.user_id !== u.user_id; });
        this.removeCursor(u.user_id);
        this.notify();
    };

    Collaboration.prototype.notify = function() {
        if (this.onUsersChange) this.onUsersChange(this.users);
    };

    Collaboration.prototype.handleOp = function(msg, canvas) {
        if (!msg || !msg.op) return;
        switch (msg.op) {
            case 'cursor_move':
                this.showCursor(msg.user_id, msg.user_name, msg.color, msg.data);
                break;
            case 'node_select':
                this.showRemoteSelect(canvas, msg.data.node_id, msg.color || msg.user_id);
                break;
            case 'node_deselect':
                this.clearRemoteSelect(canvas, msg.data.node_id);
                break;
            case 'node_move':
                var n = canvas.getNode(msg.data.id);
                if (n) { n.position = msg.data.position; canvas.renderNode(n); canvas.renderEdges(); }
                break;
            case 'node_add':
                if (!canvas.getNode(msg.data.id)) { canvas.nodes.push(msg.data); canvas.renderNode(msg.data); }
                break;
            case 'node_remove':
                var el = canvas.htmlLayer.querySelector('[data-id="' + msg.data.id + '"]');
                if (el) el.remove();
                canvas.nodes = canvas.nodes.filter(function(nn) { return nn.id !== msg.data.id; });
                canvas.edges = canvas.edges.filter(function(e) { return e.from !== msg.data.id && e.to !== msg.data.id; });
                canvas.renderEdges();
                break;
            case 'edge_add':
                if (!canvas.edges.some(function(e) { return e.from === msg.data.from && e.to === msg.data.to; })) {
                    canvas.edges.push(msg.data);
                    canvas.renderEdges();
                }
                break;
            case 'edge_remove':
                canvas.edges = canvas.edges.filter(function(e) { return !(e.from === msg.data.from && e.to === msg.data.to); });
                canvas.renderEdges();
                break;
            case 'node_config':
                var nc = canvas.getNode(msg.data.id);
                if (nc) { nc.label = msg.data.label; nc.config = msg.data.config; canvas.renderNode(nc); }
                break;
        }
    };

    Collaboration.prototype.showCursor = function(userId, userName, color, pos) {
        if (!this.canvasWrap) return;
        var c = this.cursors[userId];
        if (!c) {
            var el = document.createElement('div');
            el.className = 'wf-remote-cursor';
            var col = color || userColor(userName || userId);
            el.innerHTML = '<div class="wf-remote-cursor-pointer" style="color:' + col + '"></div>' +
                '<div class="wf-remote-cursor-label" style="background:' + col + '"></div>';
            el.querySelector('.wf-remote-cursor-label').textContent = userName || userId;
            this.canvasWrap.appendChild(el);
            c = { el: el, timer: null };
            this.cursors[userId] = c;
        }
        c.el.style.left = pos.x + 'px';
        c.el.style.top = pos.y + 'px';
        c.el.style.opacity = '1';
        if (c.timer) clearTimeout(c.timer);
        c.timer = setTimeout(function() { c.el.style.opacity = '0.3'; }, 5000);
    };

    Collaboration.prototype.removeCursor = function(userId) {
        var c = this.cursors[userId];
        if (c) { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); if (c.timer) clearTimeout(c.timer); delete this.cursors[userId]; }
    };

    Collaboration.prototype.showRemoteSelect = function(canvas, nodeId, color) {
        var el = canvas.htmlLayer.querySelector('[data-id="' + nodeId + '"] .wf-node-remote-select');
        if (el) el.style.borderColor = typeof color === 'string' && color.startsWith('#') ? color : userColor(color);
    };

    Collaboration.prototype.clearRemoteSelect = function(canvas, nodeId) {
        var el = canvas.htmlLayer.querySelector('[data-id="' + nodeId + '"] .wf-node-remote-select');
        if (el) el.style.borderColor = 'transparent';
    };

    Collaboration.prototype.destroy = function() {
        var self = this;
        Object.keys(this.cursors).forEach(function(k) { self.removeCursor(k); });
        this.users = [];
    };

    function userColor(name) {
        var h = 0; for (var i = 0; i < (name || '').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
        return 'hsl(' + (Math.abs(h) % 360) + ',55%,50%)';
    }

    window.WfCollaboration = Collaboration;
})();

/**
 * Workflow Toolbar — add node dropdown, run, undo/redo, collaboration avatars.
 */
(function() {
    'use strict';

    function Toolbar(container) {
        this.el = container;
        this.onAddNode = null;   // callback(type)
        this.onRun = null;
        this.onUndo = null;
        this.onRedo = null;
        this.onDelete = null;
        this.menuOpen = false;
    }

    Toolbar.prototype.init = function() {
        var self = this;
        this.el.innerHTML =
            '<div class="wf-toolbar">' +
                '<div class="wf-toolbar-group">' +
                    '<div class="wf-add-dropdown" id="wf-add-dropdown">' +
                        '<button class="wf-toolbar-btn" id="wf-add-btn" aria-haspopup="true">+ Node ▾</button>' +
                        '<div class="wf-add-menu" id="wf-add-menu" role="menu"></div>' +
                    '</div>' +
                    '<button class="wf-toolbar-btn" id="wf-delete-btn" title="Delete selected" aria-label="Delete selected">🗑</button>' +
                '</div>' +
                '<div class="wf-toolbar-separator"></div>' +
                '<div class="wf-toolbar-group">' +
                    '<button class="wf-toolbar-btn" id="wf-undo-btn" title="Undo (Ctrl+Z)" aria-label="Undo">↩</button>' +
                    '<button class="wf-toolbar-btn" id="wf-redo-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↪</button>' +
                '</div>' +
                '<div class="wf-toolbar-separator"></div>' +
                '<div class="wf-toolbar-group">' +
                    '<button class="wf-toolbar-btn primary" id="wf-run-btn" aria-label="Run workflow">▶ Run</button>' +
                '</div>' +
                '<div class="wf-toolbar-spacer"></div>' +
                '<div class="wf-collab-users" id="wf-collab-users"></div>' +
            '</div>';

        // Build add-node menu
        var menu = this.el.querySelector('#wf-add-menu');
        var types = window.WF_NODE_TYPES || {};
        Object.keys(types).forEach(function(type) {
            var btn = document.createElement('button');
            btn.className = 'wf-add-menu-item';
            btn.setAttribute('role', 'menuitem');
            btn.innerHTML = '<span>' + types[type].icon + '</span><span>' + types[type].label + '</span>';
            btn.addEventListener('click', function() {
                self.closeMenu();
                if (self.onAddNode) self.onAddNode(type);
            });
            menu.appendChild(btn);
        });

        this.el.querySelector('#wf-add-btn').addEventListener('click', function() { self.toggleMenu(); });
        this.el.querySelector('#wf-run-btn').addEventListener('click', function() { if (self.onRun) self.onRun(); });
        this.el.querySelector('#wf-undo-btn').addEventListener('click', function() { if (self.onUndo) self.onUndo(); });
        this.el.querySelector('#wf-redo-btn').addEventListener('click', function() { if (self.onRedo) self.onRedo(); });
        this.el.querySelector('#wf-delete-btn').addEventListener('click', function() { if (self.onDelete) self.onDelete(); });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('#wf-add-dropdown')) self.closeMenu();
        });
    };

    Toolbar.prototype.toggleMenu = function() {
        this.menuOpen = !this.menuOpen;
        this.el.querySelector('#wf-add-menu').classList.toggle('open', this.menuOpen);
    };
    Toolbar.prototype.closeMenu = function() {
        this.menuOpen = false;
        var m = this.el.querySelector('#wf-add-menu');
        if (m) m.classList.remove('open');
    };

    Toolbar.prototype.setUsers = function(users) {
        var el = this.el.querySelector('#wf-collab-users');
        if (!el) return;
        el.innerHTML = '';
        (users || []).forEach(function(u) {
            var av = document.createElement('div');
            av.className = 'wf-collab-avatar';
            av.style.background = userColor(u.user_name || u.user_id);
            av.textContent = (u.user_name || '?')[0].toUpperCase();
            av.title = u.user_name || u.user_id;
            el.appendChild(av);
        });
    };

    function userColor(name) {
        var h = 0;
        for (var i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
        return 'hsl(' + (Math.abs(h) % 360) + ',55%,50%)';
    }

    window.WfToolbar = Toolbar;
})();

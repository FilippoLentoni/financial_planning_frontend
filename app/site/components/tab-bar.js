/**
 * Tab Bar Component — manages tab switching between Chat and Workflows.
 * Shows/hides tab content sections without destroying DOM.
 */
(function() {
    'use strict';

    function TabBar() {
        this.activeTab = 'chat';
        this.onSwitch = null; // callback(tabId)
    }

    TabBar.prototype.init = function(containerEl) {
        var self = this;
        this.container = containerEl;
        if (!this.container) return;
        var btns = this.container.querySelectorAll('.tab-btn');
        btns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                self.switchTo(btn.getAttribute('data-tab'));
            });
        });
    };

    TabBar.prototype.switchTo = function(tabId) {
        if (this.activeTab === tabId) return;
        this.activeTab = tabId;
        // Update buttons
        var btns = this.container.querySelectorAll('.tab-btn');
        btns.forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-tab') === tabId); });
        // Update content sections
        var root = this.container.parentElement;
        var sections = root.querySelectorAll('.tab-content');
        sections.forEach(function(s) { s.classList.toggle('active', s.id === 'tab-' + tabId); });
        if (this.onSwitch) this.onSwitch(tabId);
    };

    window.TabBar = new TabBar();
})();

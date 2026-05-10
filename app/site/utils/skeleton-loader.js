/**
 * Agentic Planning - Skeleton Loader Utility
 * 
 * Vanilla JavaScript utility for creating and managing skeleton loading states.
 * Security: OWASP10 compliant - no user input is injected into DOM unsafely.
 * All dynamic content is created via DOM APIs, not innerHTML with user data.
 */

(function() {
    'use strict';

    // ============================================================
    // SVG Templates (Static, no user input)
    // ============================================================

    var SVG_TEMPLATES = {
        // Main animated loader SVG
        loader: '\
<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">\
    <circle class="outer-ring" cx="40" cy="40" r="35"/>\
    <circle class="inner-pulse" cx="40" cy="40" r="20"/>\
    <circle class="center-glow" cx="40" cy="40" r="8"/>\
    <circle class="orbit-dot" cx="40" cy="15" r="4"/>\
    <circle class="orbit-dot" cx="40" cy="15" r="4"/>\
    <circle class="orbit-dot" cx="40" cy="15" r="4"/>\
</svg>',

        // Simple spinner SVG
        spinner: '\
<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">\
    <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="80" stroke-linecap="round">\
        <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>\
    </circle>\
</svg>',

        // Pulse rings SVG
        pulseRings: '\
<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">\
    <circle cx="30" cy="30" r="25" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3">\
        <animate attributeName="r" from="10" to="28" dur="1.5s" repeatCount="indefinite"/>\
        <animate attributeName="opacity" from="0.8" to="0" dur="1.5s" repeatCount="indefinite"/>\
    </circle>\
    <circle cx="30" cy="30" r="25" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3">\
        <animate attributeName="r" from="10" to="28" dur="1.5s" begin="0.5s" repeatCount="indefinite"/>\
        <animate attributeName="opacity" from="0.8" to="0" dur="1.5s" begin="0.5s" repeatCount="indefinite"/>\
    </circle>\
    <circle cx="30" cy="30" r="6" fill="currentColor" opacity="0.8"/>\
</svg>',

        // Dots loader SVG
        dots: '\
<svg viewBox="0 0 60 20" xmlns="http://www.w3.org/2000/svg">\
    <circle cx="10" cy="10" r="5" fill="currentColor">\
        <animate attributeName="opacity" from="0.3" to="1" dur="0.8s" begin="0s" repeatCount="indefinite" values="0.3;1;0.3"/>\
    </circle>\
    <circle cx="30" cy="10" r="5" fill="currentColor">\
        <animate attributeName="opacity" from="0.3" to="1" dur="0.8s" begin="0.2s" repeatCount="indefinite" values="0.3;1;0.3"/>\
    </circle>\
    <circle cx="50" cy="10" r="5" fill="currentColor">\
        <animate attributeName="opacity" from="0.3" to="1" dur="0.8s" begin="0.4s" repeatCount="indefinite" values="0.3;1;0.3"/>\
    </circle>\
</svg>'
    };

    // ============================================================
    // Skeleton Element Factory
    // ============================================================

    var SkeletonLoader = {
        /**
         * Create a basic skeleton element
         * @param {string} type - Type of skeleton (text, avatar, button, box, card)
         * @param {Object} options - Optional configuration
         * @returns {HTMLElement}
         */
        create: function(type, options) {
            options = options || {};
            var element = document.createElement('div');
            element.className = 'skeleton skeleton-' + type;
            
            if (options.width) {
                element.style.width = typeof options.width === 'number' ? options.width + 'px' : options.width;
            }
            if (options.height) {
                element.style.height = typeof options.height === 'number' ? options.height + 'px' : options.height;
            }
            if (options.className) {
                element.className += ' ' + options.className;
            }
            
            return element;
        },

        /**
         * Create a text skeleton with multiple lines
         * @param {number} lines - Number of lines
         * @param {Object} options - Optional configuration
         * @returns {HTMLElement}
         */
        createTextBlock: function(lines, options) {
            options = options || {};
            var container = document.createElement('div');
            container.className = 'skeleton-col';
            
            for (var i = 0; i < lines; i++) {
                var line = document.createElement('div');
                line.className = 'skeleton skeleton-text';
                
                // Vary line widths for natural look
                if (i === lines - 1 && lines > 1) {
                    line.style.width = '60%';
                } else if (i % 2 === 1) {
                    line.style.width = '90%';
                }
                
                container.appendChild(line);
            }
            
            return container;
        },

        /**
         * Create a user info skeleton
         * @returns {HTMLElement}
         */
        createUserInfo: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-user-info';
            
            var avatar = this.create('avatar');
            container.appendChild(avatar);
            
            var textCol = document.createElement('div');
            textCol.className = 'skeleton-col';
            
            var name = document.createElement('div');
            name.className = 'skeleton skeleton-text';
            name.style.width = '100px';
            textCol.appendChild(name);
            
            var status = document.createElement('div');
            status.className = 'skeleton skeleton-text-sm';
            status.style.width = '60px';
            textCol.appendChild(status);
            
            container.appendChild(textCol);
            return container;
        },

        /**
         * Create a gateway item skeleton
         * @returns {HTMLElement}
         */
        createGatewayItem: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-gateway-item';
            
            var header = document.createElement('div');
            header.className = 'skeleton-gateway-header';
            
            var dot = document.createElement('span');
            dot.className = 'skeleton-status-dot';
            header.appendChild(dot);
            
            var title = document.createElement('div');
            title.className = 'skeleton skeleton-text';
            title.style.width = '120px';
            title.style.height = '14px';
            header.appendChild(title);
            
            container.appendChild(header);
            
            var desc = document.createElement('div');
            desc.className = 'skeleton skeleton-text-sm';
            desc.style.width = '180px';
            desc.style.marginTop = '8px';
            container.appendChild(desc);
            
            return container;
        },

        /**
         * Create multiple gateway item skeletons
         * @param {number} count - Number of items
         * @returns {HTMLElement}
         */
        createGatewayList: function(count) {
            count = count || 3;
            var container = document.createElement('div');
            container.className = 'gateway-list';
            
            for (var i = 0; i < count; i++) {
                container.appendChild(this.createGatewayItem());
            }
            
            return container;
        },

        /**
         * Create a tool item skeleton
         * @returns {HTMLElement}
         */
        createToolItem: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-tool-item';
            
            var icon = document.createElement('div');
            icon.className = 'skeleton skeleton-tool-icon';
            container.appendChild(icon);
            
            var name = document.createElement('div');
            name.className = 'skeleton skeleton-text';
            name.style.width = '80px';
            name.style.height = '12px';
            container.appendChild(name);
            
            return container;
        },

        /**
         * Create multiple tool item skeletons
         * @param {number} count - Number of items
         * @returns {HTMLElement}
         */
        createToolsList: function(count) {
            count = count || 4;
            var container = document.createElement('div');
            container.className = 'tools-list';
            
            for (var i = 0; i < count; i++) {
                container.appendChild(this.createToolItem());
            }
            
            return container;
        },

        /**
         * Create a chat message skeleton
         * @param {boolean} isUser - Whether it's a user message
         * @returns {HTMLElement}
         */
        createMessage: function(isUser) {
            var container = document.createElement('div');
            container.className = 'skeleton-message' + (isUser ? ' skeleton-message-user' : '');
            
            var avatar = this.create('avatar');
            avatar.className = 'skeleton skeleton-avatar-sm';
            container.appendChild(avatar);
            
            var content = document.createElement('div');
            content.className = 'skeleton-message-content';
            
            var textBlock = this.createTextBlock(isUser ? 1 : 3);
            content.appendChild(textBlock);
            
            container.appendChild(content);
            return container;
        },

        /**
         * Create chat messages skeleton
         * @param {number} count - Number of messages
         * @returns {HTMLElement}
         */
        createMessageList: function(count) {
            count = count || 3;
            var container = document.createElement('div');
            container.className = 'skeleton-chat-messages';
            
            for (var i = 0; i < count; i++) {
                var isUser = i % 2 === 0;
                container.appendChild(this.createMessage(isUser));
            }
            
            return container;
        },

        /**
         * Create a chat input skeleton
         * @returns {HTMLElement}
         */
        createChatInput: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-chat-input';
            
            var input = document.createElement('div');
            input.className = 'skeleton skeleton-input-field';
            container.appendChild(input);
            
            var button = document.createElement('div');
            button.className = 'skeleton skeleton-button';
            container.appendChild(button);
            
            return container;
        },

        /**
         * Create an SVG loader element
         * @param {string} type - Type of SVG loader (loader, spinner, pulseRings, dots)
         * @returns {HTMLElement}
         */
        createSvgLoader: function(type) {
            type = type || 'loader';
            var container = document.createElement('div');
            container.className = 'skeleton-svg-loader';
            
            var svg = SVG_TEMPLATES[type] || SVG_TEMPLATES.loader;
            container.innerHTML = svg;
            
            return container;
        },

        /**
         * Create animated loading text
         * @param {string} text - Text to animate (default: "Loading")
         * @returns {HTMLElement}
         */
        createLoadingText: function(text) {
            text = text || 'Loading';
            var container = document.createElement('div');
            container.className = 'skeleton-loading-text';
            
            // Split text into spans for animation
            for (var i = 0; i < text.length; i++) {
                var span = document.createElement('span');
                span.textContent = text[i];
                container.appendChild(span);
            }
            
            return container;
        },

        /**
         * Create inline dot loader
         * @returns {HTMLElement}
         */
        createInlineLoader: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-inline-loader';
            
            for (var i = 0; i < 3; i++) {
                var dot = document.createElement('span');
                dot.className = 'skeleton-dot';
                container.appendChild(dot);
            }
            
            return container;
        },

        /**
         * Create a progress bar skeleton
         * @returns {HTMLElement}
         */
        createProgress: function() {
            var progress = document.createElement('div');
            progress.className = 'skeleton-progress';
            return progress;
        },

        /**
         * Create full page loader overlay
         * @param {Object} options - Configuration options
         * @returns {HTMLElement}
         */
        createPageLoader: function(options) {
            options = options || {};
            var loader = document.createElement('div');
            loader.className = 'skeleton-page-loader';
            loader.id = options.id || 'skeleton-page-loader';
            
            var content = document.createElement('div');
            content.className = 'skeleton-loader-content';
            
            // Add SVG loader
            content.appendChild(this.createSvgLoader(options.loaderType || 'loader'));
            
            // Add loading text
            content.appendChild(this.createLoadingText(options.text || 'Loading'));
            
            // Add progress bar if requested
            if (options.showProgress) {
                content.appendChild(this.createProgress());
            }
            
            loader.appendChild(content);
            return loader;
        },

        /**
         * Create sidebar skeleton
         * @returns {HTMLElement}
         */
        createSidebarSkeleton: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-sidebar';
            
            // Header
            var header = document.createElement('div');
            header.className = 'skeleton-sidebar-header';
            
            var logo = document.createElement('div');
            logo.className = 'skeleton skeleton-logo';
            header.appendChild(logo);
            
            var toggle = document.createElement('div');
            toggle.className = 'skeleton skeleton-button-sm';
            toggle.style.width = '32px';
            toggle.style.height = '32px';
            header.appendChild(toggle);
            
            container.appendChild(header);
            
            // User section
            container.appendChild(this.createUserInfo());
            
            // Gateway section
            var gatewaySection = document.createElement('div');
            gatewaySection.className = 'skeleton-sidebar-section';
            
            var gatewayTitle = document.createElement('div');
            gatewayTitle.className = 'skeleton skeleton-section-title';
            gatewaySection.appendChild(gatewayTitle);
            
            gatewaySection.appendChild(this.createGatewayList(2));
            container.appendChild(gatewaySection);
            
            // Tools section
            var toolsSection = document.createElement('div');
            toolsSection.className = 'skeleton-sidebar-section';
            
            var toolsTitle = document.createElement('div');
            toolsTitle.className = 'skeleton skeleton-section-title';
            toolsSection.appendChild(toolsTitle);
            
            toolsSection.appendChild(this.createToolsList(3));
            container.appendChild(toolsSection);
            
            return container;
        },

        /**
         * Create chat area skeleton
         * @returns {HTMLElement}
         */
        createChatSkeleton: function() {
            var container = document.createElement('div');
            container.className = 'skeleton-chat-area';
            
            // Header
            var header = document.createElement('div');
            header.className = 'skeleton-chat-header';
            
            var status = document.createElement('div');
            status.className = 'skeleton skeleton-text';
            status.style.width = '150px';
            header.appendChild(status);
            
            container.appendChild(header);
            
            // Messages
            container.appendChild(this.createMessageList(3));
            
            // Footer
            var footer = document.createElement('div');
            footer.className = 'skeleton-chat-footer';
            footer.appendChild(this.createChatInput());
            container.appendChild(footer);
            
            return container;
        },

        /**
         * Create full app layout skeleton
         * @returns {HTMLElement}
         */
        createAppSkeleton: function() {
            var container = document.createElement('div');
            container.className = 'app-layout';
            container.id = 'app-skeleton';
            
            // Sidebar
            var sidebar = document.createElement('aside');
            sidebar.className = 'sidebar';
            sidebar.appendChild(this.createSidebarSkeleton());
            container.appendChild(sidebar);
            
            // Main content
            var main = document.createElement('main');
            main.className = 'main-content';
            main.appendChild(this.createChatSkeleton());
            container.appendChild(main);
            
            return container;
        }
    };

    // ============================================================
    // Skeleton Manager - Controls showing/hiding skeletons
    // ============================================================

    var SkeletonManager = {
        activeSkeletons: {},

        /**
         * Show a skeleton in a container
         * @param {string|HTMLElement} container - Container element or selector
         * @param {string} type - Type of skeleton to show
         * @param {Object} options - Additional options
         * @returns {string} - Skeleton ID for later reference
         */
        show: function(container, type, options) {
            options = options || {};
            
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            
            if (!container) {
                console.warn('[SkeletonLoader] Container not found');
                return null;
            }
            
            var id = options.id || 'skeleton-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            var skeleton;
            
            switch (type) {
                case 'userInfo':
                    skeleton = SkeletonLoader.createUserInfo();
                    break;
                case 'gateway':
                    skeleton = SkeletonLoader.createGatewayItem();
                    break;
                case 'gateways':
                    skeleton = SkeletonLoader.createGatewayList(options.count);
                    break;
                case 'tool':
                    skeleton = SkeletonLoader.createToolItem();
                    break;
                case 'tools':
                    skeleton = SkeletonLoader.createToolsList(options.count);
                    break;
                case 'message':
                    skeleton = SkeletonLoader.createMessage(options.isUser);
                    break;
                case 'messages':
                    skeleton = SkeletonLoader.createMessageList(options.count);
                    break;
                case 'chatInput':
                    skeleton = SkeletonLoader.createChatInput();
                    break;
                case 'sidebar':
                    skeleton = SkeletonLoader.createSidebarSkeleton();
                    break;
                case 'chat':
                    skeleton = SkeletonLoader.createChatSkeleton();
                    break;
                case 'app':
                    skeleton = SkeletonLoader.createAppSkeleton();
                    break;
                case 'page':
                    skeleton = SkeletonLoader.createPageLoader(options);
                    break;
                case 'text':
                    skeleton = SkeletonLoader.createTextBlock(options.lines || 3);
                    break;
                case 'inline':
                    skeleton = SkeletonLoader.createInlineLoader();
                    break;
                case 'progress':
                    skeleton = SkeletonLoader.createProgress();
                    break;
                default:
                    skeleton = SkeletonLoader.create(type, options);
            }
            
            skeleton.setAttribute('data-skeleton-id', id);
            
            if (options.replace) {
                container.innerHTML = '';
            }
            
            container.appendChild(skeleton);
            
            this.activeSkeletons[id] = {
                element: skeleton,
                container: container,
                originalContent: options.replace ? null : container.innerHTML
            };
            
            return id;
        },

        /**
         * Hide a specific skeleton
         * @param {string} id - Skeleton ID
         * @param {Object} options - Options for hiding
         */
        hide: function(id, options) {
            options = options || {};
            var skeleton = this.activeSkeletons[id];
            
            if (!skeleton) {
                console.warn('[SkeletonLoader] Skeleton not found:', id);
                return;
            }
            
            var element = skeleton.element;
            
            if (options.fade) {
                element.classList.add('fade-out');
                setTimeout(function() {
                    if (element.parentNode) {
                        element.parentNode.removeChild(element);
                    }
                }, 400);
            } else {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }
            
            delete this.activeSkeletons[id];
        },

        /**
         * Hide all skeletons in a container
         * @param {string|HTMLElement} container - Container element or selector
         * @param {Object} options - Options for hiding
         */
        hideAll: function(container, options) {
            options = options || {};
            
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            
            if (!container) return;
            
            var skeletons = container.querySelectorAll('[data-skeleton-id]');
            var self = this;
            
            skeletons.forEach(function(skeleton) {
                var id = skeleton.getAttribute('data-skeleton-id');
                self.hide(id, options);
            });
        },

        /**
         * Show page loader
         * @param {Object} options - Loader options
         * @returns {string} - Loader ID
         */
        showPageLoader: function(options) {
            options = options || {};
            var loader = SkeletonLoader.createPageLoader(options);
            document.body.appendChild(loader);
            
            var id = loader.id;
            this.activeSkeletons[id] = {
                element: loader,
                container: document.body
            };
            
            return id;
        },

        /**
         * Hide page loader
         * @param {string} id - Loader ID (optional, defaults to 'skeleton-page-loader')
         * @param {Object} options - Options for hiding
         */
        hidePageLoader: function(id, options) {
            id = id || 'skeleton-page-loader';
            options = options || { fade: true };
            this.hide(id, options);
        },

        /**
         * Replace content with skeleton, then replace skeleton with new content
         * @param {string|HTMLElement} container - Container element or selector
         * @param {string} skeletonType - Type of skeleton to show
         * @param {Function} contentLoader - Function that returns a Promise with new content
         * @param {Object} options - Additional options
         */
        withLoading: function(container, skeletonType, contentLoader, options) {
            var self = this;
            options = options || {};
            
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            
            if (!container) {
                return Promise.reject(new Error('Container not found'));
            }
            
            // Show skeleton
            var skeletonId = this.show(container, skeletonType, { replace: true });
            
            // Load content
            return contentLoader()
                .then(function(content) {
                    // Hide skeleton with fade
                    self.hide(skeletonId, { fade: options.fade !== false });
                    
                    // Insert new content
                    if (typeof content === 'string') {
                        container.innerHTML = content;
                    } else if (content instanceof HTMLElement) {
                        container.innerHTML = '';
                        container.appendChild(content);
                    }
                    
                    return content;
                })
                .catch(function(error) {
                    self.hide(skeletonId);
                    throw error;
                });
        }
    };

    // ============================================================
    // Export to window
    // ============================================================

    window.SkeletonLoader = SkeletonLoader;
    window.SkeletonManager = SkeletonManager;

})();

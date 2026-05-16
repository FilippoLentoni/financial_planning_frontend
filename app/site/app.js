/**
 * Financial Planning Frontend Application
 * 
 * Main application orchestrator that coordinates services and UI components.
 * Security: OWASP10 compliant - all user inputs are escaped via SecurityUtils.
 * No external dependencies - pure vanilla JavaScript.
 */

(function() {
    'use strict';

    // ============================================================
    // Configuration
    // ============================================================
    
    var config = window.APP_CONFIG || {
        cognitoIdpId: '',
        cognitoBaseUrl: '',
        cognitoClientId: '',
        cognitoUserPoolId: '',
        stage: 'local',
        baseDomain: 'localhost',
        awsRegion: 'us-east-1',
        tokenExchangeEndpoint: ''
    };

    // ============================================================
    // Application State
    // ============================================================
    
    var state = {
        appInjected: false,
        sidebarOpen: true,
        skeletonIds: {},
        loadStartTime: Date.now(),
        minLoadingTime: 0, // No artificial loading delay
        failedGatewayIds: [] // Track gateways that failed auth/connection
    };

    // Component references
    var chatbot = null;
    var elements = {};

    // ============================================================
    // App HTML Template
    // ============================================================

    function getAppHtml() {
        return '\
<div id="app" class="app-layout">\
    <aside class="sidebar" id="sidebar">\
        <div class="sidebar-header">\
            <h1 class="logo"><span class="logo-img"><img src="assets/agentic-logo.svg" alt="Logo" /></span> <span class="logo-text-label">Portfolio Planner</span></h1>\
            <button class="sidebar-toggle" id="sidebarToggle" title="Toggle Sidebar">☰</button>\
        </div>\
        <div class="sidebar-section gateway-section" id="gatewaySection">\
            <div class="section-header">\
                <h3>Gateways</h3>\
                <button class="btn-icon btn-sm" id="refreshGatewaysBtn" title="Refresh Gateways">↻</button>\
            </div>\
            <div id="gatewayList" class="gateway-list">\
                <p class="gateway-placeholder">Loading gateways...</p>\
            </div>\
        </div>\
        <div class="sidebar-section conversations-section" id="conversationsSection">\
            <div class="section-header">\
                <h3>Conversations</h3>\
                <button class="btn-new-chat" id="newChatBtn" title="Start new conversation">+ New</button>\
            </div>\
            <div id="conversationList" class="conversation-list">\
                <p class="conversation-loading">Loading...</p>\
            </div>\
        </div>\
        <div class="sidebar-configurations">\
            <div class="sidebar-section user-section">\
                <div id="userInfo" class="user-info">\
                    <div class="user-avatar"><img src="assets/Profile.svg" alt="Profile" /></div>\
                    <div class="user-details">\
                        <span class="user-name">Loading...</span>\
                    </div>\
                </div>\
                <div class="auth-buttons">\
                    <button id="logoutBtn" class="btn btn-secondary btn-sm">Sign Out</button>\
                </div>\
            </div>\
        </div>\
        <div class="sidebar-footer">\
            <span class="version-info">v2.0.0</span>\
        </div>\
    </aside>\
    <main class="main-content">\
        <header class="top-bar">\
            <button class="sidebar-toggle-mobile" id="sidebarToggleMobile" title="Toggle Sidebar">☰</button>\
            <div class="connection-status" id="connectionStatus">\
                <span class="status-dot disconnected"></span>\
                <span class="status-text">Not connected</span>\
            </div>\
        </header>\
        <div class="tab-bar" id="tabBar" role="tablist">\
            <button class="tab-btn active" data-tab="chat" role="tab" aria-selected="true">Chat</button>\
            <button class="tab-btn" data-tab="workflows" role="tab" aria-selected="false">Reviews</button>\
        </div>\
        <section class="tab-content active" id="tab-chat">\
            <section class="model-run-panel" id="modelRunPanel" aria-live="polite">\
                <div class="model-run-panel-header">\
                    <div>\
                        <h2>Latest Model Run</h2>\
                        <p id="modelRunSubtitle">Loading model run metadata...</p>\
                    </div>\
                    <button class="btn-icon btn-sm" id="refreshModelRunsBtn" title="Refresh model run metadata">↻</button>\
                </div>\
                <div class="model-run-grid" id="modelRunMetadata">\
                    <div class="model-run-empty">Waiting for the latest input and run.</div>\
                </div>\
            </section>\
            <section class="chat-section" id="chatSection">\
                <div id="chatbot-container"></div>\
            </section>\
        </section>\
        <section class="tab-content" id="tab-workflows">\
            <div id="workflow-builder-root" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>\
        </section>\
    </main>\
</div>\
<div class="sidebar-overlay" id="sidebarOverlay"></div>';
    }

    // ============================================================
    // App Injection & Teardown
    // ============================================================

    function injectApp() {
        if (state.appInjected) return;
        
        // Hide robot loader first, then inject app
        hideRobotLoader(function() {
            var appRoot = document.getElementById('app-root');
            if (!appRoot) {
                console.error('[App] App root not found');
                return;
            }
            
            appRoot.innerHTML = getAppHtml();
            state.appInjected = true;
            
            hideUnauthorizedScreen();
            document.title = 'Financial Planning Assistant';
            
            cacheElements();
            setupEventListeners();
            
            // Show skeleton loading states for dynamic content
            showInitialSkeletons();
            
            initChatbot();
            initTabBar();
            updateAuthenticatedUI();
            
            console.log('[App] Application loaded');
        });
    }

    function removeApp() {
        var appRoot = document.getElementById('app-root');
        if (appRoot) appRoot.innerHTML = '';
        
        state.appInjected = false;
        state.skeletonIds = {};
        chatbot = null;
        elements = {};
        
        showUnauthorizedScreen();
        document.title = 'Unauthorized';
    }

    // ============================================================
    // Skeleton Loading Functions
    // ============================================================

    /**
     * Show initial skeleton loading states for sidebar sections
     */
    function showInitialSkeletons() {
        if (!window.SkeletonManager) {
            console.warn('[App] SkeletonManager not available');
            return;
        }
        
        // Show skeleton for user info
        if (elements.userInfo) {
            state.skeletonIds.userInfo = window.SkeletonManager.show(
                elements.userInfo,
                'userInfo',
                { replace: true, id: 'skeleton-user-info' }
            );
        }
        
        // Show skeleton for gateway list
        if (elements.gatewayList) {
            state.skeletonIds.gateways = window.SkeletonManager.show(
                elements.gatewayList,
                'gateways',
                { replace: true, id: 'skeleton-gateways', count: 2 }
            );
        }
        
        // Show skeleton for tools list
        if (elements.toolsList) {
            state.skeletonIds.tools = window.SkeletonManager.show(
                elements.toolsList,
                'tools',
                { replace: true, id: 'skeleton-tools', count: 3 }
            );
        }
    }

    /**
     * Hide a specific skeleton by key
     * @param {string} key - The skeleton key (userInfo, gateways, tools)
     */
    function hideSkeleton(key) {
        if (!window.SkeletonManager || !state.skeletonIds[key]) return;
        
        window.SkeletonManager.hide(state.skeletonIds[key], { fade: true });
        delete state.skeletonIds[key];
    }

    /**
     * Hide all active skeletons
     */
    function hideAllSkeletons() {
        if (!window.SkeletonManager) return;
        
        Object.keys(state.skeletonIds).forEach(function(key) {
            window.SkeletonManager.hide(state.skeletonIds[key], { fade: true });
        });
        state.skeletonIds = {};
    }

    /**
     * Show inline loading indicator
     * @param {HTMLElement} container - Container to show loader in
     * @returns {HTMLElement} - The loader element
     */
    function showInlineLoader(container) {
        if (!window.SkeletonLoader || !container) return null;
        
        var loader = window.SkeletonLoader.createInlineLoader();
        container.appendChild(loader);
        return loader;
    }

    /**
     * Remove inline loading indicator
     * @param {HTMLElement} loader - The loader element to remove
     */
    function removeInlineLoader(loader) {
        if (loader && loader.parentNode) {
            loader.parentNode.removeChild(loader);
        }
    }

    // ============================================================
    // DOM Element Caching
    // ============================================================

    function cacheElements() {
        elements.sidebar = document.getElementById('sidebar');
        elements.sidebarToggle = document.getElementById('sidebarToggle');
        elements.sidebarToggleMobile = document.getElementById('sidebarToggleMobile');
        elements.sidebarOverlay = document.getElementById('sidebarOverlay');
        elements.logoutBtn = document.getElementById('logoutBtn');
        elements.userInfo = document.getElementById('userInfo');
        elements.gatewayList = document.getElementById('gatewayList');
        elements.toolsList = document.getElementById('toolsList');
        elements.refreshGatewaysBtn = document.getElementById('refreshGatewaysBtn');
        elements.connectionStatus = document.getElementById('connectionStatus');
        elements.darkModeToggle = document.getElementById('darkModeToggle');
        elements.conversationList = document.getElementById('conversationList');
        elements.newChatBtn = document.getElementById('newChatBtn');
        elements.modelRunPanel = document.getElementById('modelRunPanel');
        elements.modelRunSubtitle = document.getElementById('modelRunSubtitle');
        elements.modelRunMetadata = document.getElementById('modelRunMetadata');
        elements.refreshModelRunsBtn = document.getElementById('refreshModelRunsBtn');
    }

    // ============================================================
    // Sidebar Functions
    // ============================================================

    function toggleSidebar() {
        state.sidebarOpen = !state.sidebarOpen;
        elements.sidebar.classList.toggle('collapsed', !state.sidebarOpen);
        elements.sidebar.classList.toggle('expanded', state.sidebarOpen);
    }

    function toggleDarkMode() {
        state.isDarkMode = !state.isDarkMode;
        if (state.isDarkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            document.body.removeAttribute('data-theme');
        }
        // Update the dark mode toggle icon
        if (elements.darkModeToggle) {
            var icon = elements.darkModeToggle.querySelector('.nav-action-icon');
            if (icon) {
                icon.textContent = state.isDarkMode ? '☀️' : '🌙';
            }
        }
    }

    function openSidebar() {
        elements.sidebar.classList.add('open');
        elements.sidebarOverlay.classList.add('active');
        state.sidebarOpen = true;
    }

    function closeSidebar() {
        elements.sidebar.classList.remove('open');
        elements.sidebarOverlay.classList.remove('active');
        state.sidebarOpen = false;
    }

    // ============================================================
    // UI Update Functions
    // ============================================================

    function updateAuthenticatedUI() {
        if (!state.appInjected) return;
        
        var user = window.AuthService.getUser();
        var userName = user && user.email ? user.email.split('@')[0] : 'User';
        var escapeHtml = window.SecurityUtils.escapeHtml;
        var devConfig = window.DEV_CONFIG || {};
        var region = config.awsRegion || devConfig.awsRegion || 'us-east-2';

        if (window.RuntimeService) {
            window.RuntimeService.configure({
                apiBaseUrl: config.apiBaseUrl || devConfig.apiBaseUrl || '',
                runtimeWsUrl: config.runtimeWsUrl || devConfig.runtimeWsUrl || '',
                runtimeEndpoint: config.runtimeEndpoint || devConfig.runtimeEndpoint || '',
                runtimeArn: config.runtimeArn || devConfig.runtimeArn || '',
                region: region
            });
        }
        
        // Hide user info skeleton and show real content
        hideSkeleton('userInfo');
        
        elements.userInfo.innerHTML = '\
            <div class="user-avatar"><img src="assets/Profile.svg" alt="Profile" /></div>\
            <div class="user-details">\
                <span class="user-name">' + escapeHtml(userName) + '</span>\
            </div>';
        
        // Initialize BedrockService credentials first, then load gateways and models
        initBedrockCredentials().then(function() {
            console.log('[App] IAM credentials initialized successfully');
            loadGateways();
            loadModelRuns();
            loadConversations();
            updateConnectionStatus();
            // Initialize chatbot with auth (loads models proactively)
            if (chatbot && chatbot.initWithAuth) {
                chatbot.initWithAuth();
            }
        }).catch(function(error) {
            console.error('[App] Failed to initialize IAM credentials:', error);
            console.error('[App] This may cause MCP gateway authentication to fail');
            // Still try to load gateways - they may work with fallback auth
            loadGateways();
            loadModelRuns();
            loadConversations();
            updateConnectionStatus();
        });
    }

    /**
     * Initialize BedrockService with AWS credentials from Cognito Identity Pool
     */
    function initBedrockCredentials() {
        // ID token is required for Cognito Identity Pool token exchange
        var idToken = window.AuthService.getIdToken();
        
        if (!idToken) {
            return Promise.reject(new Error('No ID token available'));
        }
        
        // Configure BedrockService if not already done
        var identityPoolId = config.cognitoIdpId || devConfig.cognitoIdpId;
        var region = config.awsRegion || devConfig.awsRegion || 'us-east-2';
        var userPoolId = config.cognitoUserPoolId || devConfig.cognitoUserPoolId;
        
        if (!identityPoolId) {
            return Promise.reject(new Error('Identity Pool ID not configured'));
        }
        
        if (window.BedrockService) {
            window.BedrockService.configure(identityPoolId, region, userPoolId);
            
            // Configure RuntimeService (AgentCore Runtime proxy)
            if (window.RuntimeService) {
                window.RuntimeService.configure({
                    apiBaseUrl: config.apiBaseUrl || devConfig.apiBaseUrl || '',
                    runtimeWsUrl: config.runtimeWsUrl || devConfig.runtimeWsUrl || '',
                    runtimeEndpoint: config.runtimeEndpoint || devConfig.runtimeEndpoint || '',
                    runtimeArn: config.runtimeArn || devConfig.runtimeArn || '',
                    region: region
                });
            }
            
            // Get credentials using the ID token (required for Cognito Identity Pool)
            return window.BedrockService.getCredentials(idToken)
                .then(function(credentials) {
                    console.log('[App] AWS credentials obtained successfully');
                    return credentials;
                });
        }
        
        return Promise.reject(new Error('BedrockService not available'));
    }

    function updateConnectionStatus() {
        if (!elements.connectionStatus) return;
        
        var statusDot = elements.connectionStatus.querySelector('.status-dot');
        var statusText = elements.connectionStatus.querySelector('.status-text');
        
        var connectedCount = window.GatewayService.getConnectedUrls().length;
        var toolCount = window.GatewayService.getAllTools().length;
        
        if (connectedCount > 0) {
            statusDot.className = 'status-dot connected';
            window.SecurityUtils.setTextContent(statusText, connectedCount + ' server(s) • ' + toolCount + ' tool(s)');
        } else {
            statusDot.className = 'status-dot disconnected';
            window.SecurityUtils.setTextContent(statusText, 'No servers connected');
        }
    }

    function showError(message) {
        console.error('[App] Error:', message);
        if (!state.appInjected) return;
        
        var errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        window.SecurityUtils.setTextContent(errorDiv, message);
        
        var mainContent = document.querySelector('.main-content');
        if (mainContent && mainContent.firstChild) {
            mainContent.insertBefore(errorDiv, mainContent.firstChild.nextSibling);
        }
        
        setTimeout(function() {
            if (errorDiv.parentNode) errorDiv.parentNode.removeChild(errorDiv);
        }, 5000);
    }

    function formatCurrency(value) {
        if (value === null || value === undefined || value === '') return 'n/a';
        return '$' + Number(value).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }

    function renderModelRunMetadata(run) {
        if (!elements.modelRunMetadata || !elements.modelRunSubtitle) return;
        var escapeHtml = window.SecurityUtils.escapeHtml;
        if (!run) {
            window.SecurityUtils.setTextContent(elements.modelRunSubtitle, 'No model run available yet.');
            elements.modelRunMetadata.innerHTML = '<div class="model-run-empty">No input/run pair has been created.</div>';
            return;
        }

        var created = run.createdAtIso || 'unknown time';
        var modelId = run.modelUsed && run.modelUsed.modelId ? run.modelUsed.modelId : 'backend default';
        window.SecurityUtils.setTextContent(
            elements.modelRunSubtitle,
            (run.description || 'Portfolio planning run') + ' • ' + created
        );
        elements.modelRunMetadata.innerHTML = '\
            <div class="model-run-field"><span>Input ID</span><code>' + escapeHtml(run.input_id || 'n/a') + '</code></div>\
            <div class="model-run-field"><span>Run ID</span><code>' + escapeHtml(run.run_id || 'n/a') + '</code></div>\
            <div class="model-run-field"><span>As of</span><strong>' + escapeHtml(run.asOfDate || 'n/a') + '</strong></div>\
            <div class="model-run-field"><span>Portfolio</span><strong>' + escapeHtml(run.portfolioId || 'n/a') + '</strong></div>\
            <div class="model-run-field"><span>Risk</span><strong>' + escapeHtml(run.riskTarget || 'n/a') + '</strong></div>\
            <div class="model-run-field"><span>Expected W16</span><strong>' + escapeHtml(formatCurrency(run.expectedValueAtWeek16)) + '</strong></div>\
            <div class="model-run-field"><span>Return</span><strong>' + escapeHtml((run.expectedReturnPct16w || 0) + '%') + '</strong></div>\
            <div class="model-run-field"><span>Model</span><code>' + escapeHtml(modelId) + '</code></div>';
    }

    function loadModelRuns() {
        if (!elements.modelRunMetadata || !window.RuntimeService || !window.RuntimeService.invokeBackendApi) return;
        if (elements.refreshModelRunsBtn) elements.refreshModelRunsBtn.disabled = true;
        window.RuntimeService.invokeBackendApi('GET', '/planning/runs')
            .then(function(data) {
                renderModelRunMetadata(data.latest);
            })
            .catch(function(error) {
                console.error('[App] Failed to load model run metadata:', error);
                if (elements.modelRunSubtitle) {
                    window.SecurityUtils.setTextContent(elements.modelRunSubtitle, 'Model run metadata unavailable.');
                }
                if (elements.modelRunMetadata) {
                    elements.modelRunMetadata.innerHTML = '<div class="model-run-empty">Unable to load the latest run metadata.</div>';
                }
            })
            .finally(function() {
                if (elements.refreshModelRunsBtn) elements.refreshModelRunsBtn.disabled = false;
            });
    }

    // ============================================================
    // Unauthorized Screen
    // ============================================================

    // ============================================================
    // Robot Loader Functions
    // ============================================================

    /**
     * Hide the robot loader with fade animation
     * Ensures minimum display time of 1 second
     * @param {Function} callback - Called after loader is hidden
     */
    function hideRobotLoader(callback) {
        var loader = document.getElementById('robot-loader');
        if (!loader) {
            if (callback) callback();
            return;
        }
        
        var elapsed = Date.now() - state.loadStartTime;
        var remaining = Math.max(0, state.minLoadingTime - elapsed);
        
        // Wait for minimum time, then fade out
        setTimeout(function() {
            loader.classList.add('fade-out');
            
            // After fade animation (500ms), hide completely
            setTimeout(function() {
                loader.classList.add('hidden');
                if (callback) callback();
            }, 500);
        }, remaining);
    }

    /**
     * Show the robot loader (reset state)
     */
    function showRobotLoader() {
        var loader = document.getElementById('robot-loader');
        if (loader) {
            loader.classList.remove('fade-out', 'hidden');
            state.loadStartTime = Date.now();
        }
    }

    function hideUnauthorizedScreen() {
        var screen = document.getElementById('unauthorized-screen');
        if (screen) screen.classList.add('hidden');
    }

    function showUnauthorizedScreen() {
        var screen = document.getElementById('unauthorized-screen');
        if (screen) screen.classList.remove('hidden');
    }

    function showUnauthorizedWithError(message) {
        // Hide robot loader first, then show unauthorized screen with error
        hideRobotLoader(function() {
            var screen = document.getElementById('unauthorized-screen');
            if (!screen) return;
            
            screen.classList.remove('hidden');
            var errorEl = screen.querySelector('.unauthorized-error');
            
            if (!errorEl) {
                errorEl = document.createElement('p');
                errorEl.className = 'unauthorized-error';
                errorEl.style.cssText = 'color: #ff6b6b; margin-top: 1rem; font-size: 0.9rem;';
                var content = screen.querySelector('.unauthorized-content');
                if (content) content.appendChild(errorEl);
            }
            
            window.SecurityUtils.setTextContent(errorEl, message);
        });
    }

    // ============================================================
    // Gateway Management
    // ============================================================

    function loadGateways() {
        // Show skeleton if not already showing
        if (!state.skeletonIds.gateways && elements.gatewayList && window.SkeletonManager) {
            state.skeletonIds.gateways = window.SkeletonManager.show(
                elements.gatewayList,
                'gateways',
                { replace: true, id: 'skeleton-gateways', count: 2 }
            );
        }
        
        window.GatewayService.fetchGateways()
            .then(function(gateways) {
                // Hide gateway skeleton before rendering
                hideSkeleton('gateways');
                renderGateways(gateways);
                if (chatbot) chatbot.autoDiscoverGateways();
                
                // Auto-connect all gateways that aren't already connected
                autoConnectGateways(gateways);
            })
            .catch(function(error) {
                console.error('[App] Failed to load gateways:', error);
                hideSkeleton('gateways');
                if (elements.gatewayList) {
                    elements.gatewayList.innerHTML = '<p class="gateway-placeholder">Failed to load gateways</p>';
                }
            });
    }

    /**
     * Auto-connect all gateways that aren't already connected
     * Connects sequentially to avoid overwhelming the auth system
     */
    function autoConnectGateways(gateways) {
        if (!gateways || gateways.length === 0) return;
        
        var gatewaysToConnect = gateways.filter(function(gw) {
            return !window.GatewayService.isConnected(gw);
        });
        
        if (gatewaysToConnect.length === 0) {
            console.log('[App] All gateways already connected');
            return;
        }
        
        // Separate OAuth gateways that need user click from others
        var oauthGatewaysNeedingAuth = [];
        var otherGateways = [];
        
        gatewaysToConnect.forEach(function(gateway) {
            // Check authType first to match connection logic priority (lines 580-599)
            if (gateway.authType === 'sigv4' || gateway.authType === 'proxy') {
                otherGateways.push(gateway);
            } else if (gateway.authDiscoveryUrl && gateway.clientId) {
                // Check if we have valid cached token
                var hasValidCachedToken = window.MCPService && window.MCPService.hasValidToken(gateway.mcpUrl);
                
                if (!hasValidCachedToken) {
                    oauthGatewaysNeedingAuth.push(gateway);
                } else {
                    otherGateways.push(gateway); // Has valid cached token, can auto-connect
                }
            } else {
                otherGateways.push(gateway);
            }
        });
        
        console.log('[App] Auto-connecting', otherGateways.length, 'gateway(s), ', oauthGatewaysNeedingAuth.length, 'need OAuth');
        
        // Show one-click prompt if there are OAuth gateways needing auth
        if (oauthGatewaysNeedingAuth.length > 0 && window.MCPService) {
            showGatewayAuthPrompt(oauthGatewaysNeedingAuth);
        }
        
        // Connect gateways that don't need OAuth popup (SigV4, proxy, cached tokens)
        var promises = otherGateways.map(function(gateway) {
            console.log('[App] Auto-connecting gateway:', gateway.name);
            
            if (gateway.authType === 'sigv4' && window.MCPService) {
                return window.MCPService.connectWithSigV4(gateway, function() {})
                    .then(function() { console.log('[App] Auto-connected (SigV4):', gateway.name); })
                    .catch(function(error) { console.warn('[App] Auto-connect failed:', gateway.name, error.message); });
            } else if (gateway.authType === 'proxy' && window.MCPService) {
                return window.MCPService.connectWithProxy(gateway, function() {})
                    .then(function() { console.log('[App] Auto-connected (proxy):', gateway.name); })
                    .catch(function(error) { console.warn('[App] Auto-connect failed:', gateway.name, error.message); });
            } else if (gateway.authDiscoveryUrl && gateway.clientId && window.MCPService) {
                // Has cached token - use it
                return window.MCPService.connectWithGatewayAuth(gateway, function() {})
                    .then(function() { console.log('[App] Auto-connected (cached):', gateway.name); })
                    .catch(function(error) { console.warn('[App] Cached auth failed:', gateway.name, error.message); });
            } else {
                var accessToken = window.AuthService.getAccessToken();
                if (!accessToken) return Promise.resolve();
                return window.GatewayService.connect(gateway, accessToken)
                    .then(function() { console.log('[App] Auto-connected:', gateway.name); })
                    .catch(function(error) { console.warn('[App] Auto-connect failed:', gateway.name, error.message); });
            }
        });
        
        Promise.all(promises).then(function() {
            console.log('[App] Auto-connect batch complete');
            renderGateways(window.GatewayService.getGateways());
            updateConnectionStatus();
            window.GatewayService.syncToolsWithChatService();
        });
    }

    /**
     * Show a one-click prompt to authenticate all OAuth gateways.
     * Uses existing gateway items in sidebar to show progress.
     */
    function showGatewayAuthPrompt(oauthGateways) {
        // Remove existing prompt if any
        var existing = document.getElementById('gateway-auth-prompt');
        if (existing) existing.remove();
        
        // Create a small prompt above the gateway list (using DOM APIs to avoid innerHTML)
        var prompt = document.createElement('div');
        prompt.id = 'gateway-auth-prompt';
        prompt.style.cssText = 'padding:8px 12px;background:rgba(15,20,26,0.05);border-bottom:1px solid rgba(15,20,26,0.1);';
        
        var btn = document.createElement('button');
        btn.className = 'gateway-auth-btn';
        btn.textContent = 'Connect All (' + oauthGateways.length + ')';
        btn.style.cssText = 'width:100%;background:#0f141a;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;';
        prompt.appendChild(btn);
        
        btn.addEventListener('click', function() {
            btn.disabled = true;
            btn.textContent = 'Authenticating...';
            btn.style.background = '#1a2030';
            
            // Show connecting state on each gateway item as we process them
            window.MCPService.authenticateAllGatewaysSequentially(oauthGateways, function(name, gateway, index, total, status) {
                updateGatewayItemProgress(gateway, status);
                btn.textContent = (index + 1) + ' of ' + total + ': ' + name.substring(0, 12) + (name.length > 12 ? '...' : '');
            }).then(function(results) {
                console.log('[App] Sequential auth complete:', results.success.length, 'success,', results.failed.length, 'failed');
                
                // Mark failed gateways
                results.failed.forEach(function(item) {
                    updateGatewayItemProgress(item.gateway, 'failed');
                });
                
                if (results.success.length > 0) {
                    btn.textContent = 'Connecting Gateways...';
                    
                    // Connect all successfully authenticated gateways
                    var connectPromises = results.success.map(function(item) {
                        updateGatewayItemProgress(item.gateway, 'connecting');
                        return window.MCPService.connectWithGatewayAuth(item.gateway, function(step) {
                            if (step === 'listing_tools') {
                                updateGatewayItemProgress(item.gateway, 'loading_tools');
                            }
                        })
                        .then(function() {
                            updateGatewayItemProgress(item.gateway, 'connected');
                        })
                        .catch(function(e) {
                            console.warn('[App] Connect failed:', item.gateway.name, e.message);
                            updateGatewayItemProgress(item.gateway, 'error');
                        });
                    });
                    
                    return Promise.all(connectPromises).then(function() {
                        renderGateways(window.GatewayService.getGateways());
                        updateConnectionStatus();
                        window.GatewayService.syncToolsWithChatService();
                        prompt.remove();
                    });
                } else {
                    btn.textContent = 'Failed - Retry';
                    btn.style.background = '#8b0000';
                    btn.style.border = 'none';
                    btn.disabled = false;
                }
            }).catch(function(error) {
                console.error('[App] Sequential auth error:', error);
                btn.textContent = 'Error - Retry';
                btn.style.background = '#8b0000';
                btn.style.border = 'none';
                btn.disabled = false;
            });
        });
        
        // Insert prompt at top of gateway section
        var gatewaySection = document.getElementById('gatewaySection');
        if (gatewaySection && elements.gatewayList) {
            gatewaySection.insertBefore(prompt, elements.gatewayList);
        }
    }

    /**
     * Update a gateway item's visual state during batch auth
     */
    function updateGatewayItemProgress(gateway, status) {
        if (!elements.gatewayList) return;
        
        var gatewayItem = elements.gatewayList.querySelector('[data-gateway-id="' + window.SecurityUtils.escapeHtml(gateway.id) + '"]');
        if (!gatewayItem) return;
        
        // Get or create progress element
        var existingProgress = gatewayItem.querySelector('[data-progress="true"]');
        
        switch (status) {
            case 'authenticating':
                gatewayItem.classList.add('connecting');
                gatewayItem.classList.remove('connected');
                gatewayItem.classList.remove('failed');
                if (!existingProgress) {
                    var progressEl = document.createElement('div');
                    progressEl.className = 'gateway-progress-status';
                    progressEl.setAttribute('data-progress', 'true');
                    window.SecurityUtils.setTextContent(progressEl, 'Authenticating...');
                    gatewayItem.appendChild(progressEl);
                } else {
                    window.SecurityUtils.setTextContent(existingProgress, 'Authenticating...');
                }
                break;
                
            case 'success':
                if (existingProgress) {
                    window.SecurityUtils.setTextContent(existingProgress, 'Token received');
                }
                break;
                
            case 'connecting':
                if (existingProgress) {
                    window.SecurityUtils.setTextContent(existingProgress, 'Connecting...');
                }
                break;
                
            case 'loading_tools':
                if (existingProgress) {
                    window.SecurityUtils.setTextContent(existingProgress, 'Loading tools...');
                }
                break;
                
            case 'connected':
                // Remove from failed list if previously failed (successful retry)
                var failedIndex = state.failedGatewayIds.indexOf(gateway.id);
                if (failedIndex !== -1) {
                    state.failedGatewayIds.splice(failedIndex, 1);
                }
                gatewayItem.classList.remove('connecting');
                gatewayItem.classList.remove('failed');
                gatewayItem.classList.add('connected');
                if (existingProgress) {
                    existingProgress.parentNode.removeChild(existingProgress);
                }
                break;
                
            case 'failed':
            case 'error':
                gatewayItem.classList.remove('connecting');
                gatewayItem.classList.add('failed');
                // Track failed gateway
                if (state.failedGatewayIds.indexOf(gateway.id) === -1) {
                    state.failedGatewayIds.push(gateway.id);
                }
                if (existingProgress) {
                    window.SecurityUtils.setTextContent(existingProgress, 'No access');
                    setTimeout(function() {
                        if (existingProgress.parentNode) {
                            existingProgress.parentNode.removeChild(existingProgress);
                        }
                    }, 2000);
                }
                // Move failed gateway to bottom of list
                if (gatewayItem.parentNode) {
                    gatewayItem.parentNode.appendChild(gatewayItem);
                }
                break;
        }
    }

    function renderGateways(gateways) {
        if (!elements.gatewayList) return;
        
        // Hide any active gateway skeleton
        hideSkeleton('gateways');
        
        elements.gatewayList.innerHTML = '';
        var escapeHtml = window.SecurityUtils.escapeHtml;
        
        if (!gateways || gateways.length === 0) {
            elements.gatewayList.innerHTML = '<p class="gateway-placeholder">No gateways available</p>';
            // Also hide tools skeleton since no gateways means no tools
            hideSkeleton('tools');
            return;
        }
        
        // Sort gateways: connected first, then disconnected, failed last
        var sortedGateways = gateways.slice().sort(function(gatewayA, gatewayB) {
            var aConnected = window.GatewayService.isConnected(gatewayA);
            var bConnected = window.GatewayService.isConnected(gatewayB);
            // Only treat as failed if not connected (matches render logic at line 812)
            var aFailed = !aConnected && state.failedGatewayIds.indexOf(gatewayA.id) !== -1;
            var bFailed = !bConnected && state.failedGatewayIds.indexOf(gatewayB.id) !== -1;
            
            if (aFailed && !bFailed) return 1;
            if (!aFailed && bFailed) return -1;
            if (aConnected && !bConnected) return -1;
            if (!aConnected && bConnected) return 1;
            return 0;
        });
        
        sortedGateways.forEach(function(gateway) {
            var isConnected = window.GatewayService.isConnected(gateway);
            // Only treat as failed if not currently connected (defensive guard for retry scenarios)
            var isFailed = !isConnected && state.failedGatewayIds.indexOf(gateway.id) !== -1;
            var toolCount = window.GatewayService.getToolCount(gateway);
            
            var item = document.createElement('div');
            var className = 'gateway-item';
            if (isConnected) className += ' connected';
            if (isFailed) className += ' failed';
            item.className = className;
            item.setAttribute('data-gateway-id', escapeHtml(gateway.id));
            
            item.innerHTML = '\
                <div class="gateway-item-header">\
                    <span class="gateway-status-dot ' + (isConnected ? 'connected' : '') + '"></span>\
                    <h4>' + escapeHtml(gateway.name) + '</h4>\
                </div>\
                <p>' + escapeHtml(gateway.description || '') + '</p>' +
                (isConnected ? '<div class="gateway-tool-count">' + toolCount + ' tool(s)</div>' : '') +
                (isFailed ? '<div class="gateway-failed-label">No access</div>' : '');
            
            item.addEventListener('click', function() {
                toggleGatewayConnection(gateway);
            });
            
            elements.gatewayList.appendChild(item);
        });
    }

    function toggleGatewayConnection(gateway) {
        if (window.GatewayService.isConnected(gateway)) {
            window.GatewayService.disconnect(gateway);
            renderGateways(window.GatewayService.getGateways());
            updateToolsList();
            updateConnectionStatus();
        } else {
            // Show tools skeleton while connecting
            if (elements.toolsList && window.SkeletonManager) {
                state.skeletonIds.tools = window.SkeletonManager.show(
                    elements.toolsList,
                    'tools',
                    { replace: true, id: 'skeleton-tools', count: 3 }
                );
            }
            
            // Get the gateway item element and show connecting state
            var gatewayId = gateway.id;
            var gatewayItem = elements.gatewayList ? 
                elements.gatewayList.querySelector('[data-gateway-id="' + window.SecurityUtils.escapeHtml(gatewayId) + '"]') : null;
            
            if (gatewayItem) {
                gatewayItem.classList.add('connecting');
                // Add progress status element
                var progressEl = document.createElement('div');
                progressEl.className = 'gateway-progress-status';
                progressEl.setAttribute('data-progress', 'true');
                window.SecurityUtils.setTextContent(progressEl, 'Starting...');
                gatewayItem.appendChild(progressEl);
            }
            
            // Progress callback to update UI during auth flow
            var progressCallback = function(step, message) {
                if (!gatewayItem) return;
                var progressEl = gatewayItem.querySelector('[data-progress="true"]');
                if (!progressEl) return;
                
                var statusText = '';
                switch (step) {
                    case 'oauth_start':
                        statusText = 'Starting authentication...';
                        break;
                    case 'oauth_popup':
                        statusText = 'Waiting for sign-in...';
                        break;
                    case 'exchanging_token':
                        statusText = 'Exchanging token...';
                        break;
                    case 'token_received':
                        statusText = 'Token received...';
                        break;
                    case 'connecting':
                        statusText = 'Connecting to gateway...';
                        break;
                    case 'listing_tools':
                        statusText = 'Loading tools...';
                        break;
                    case 'complete':
                        statusText = 'Connected!';
                        break;
                    case 'error':
                        statusText = message || 'Error occurred';
                        break;
                    default:
                        statusText = message || step;
                }
                window.SecurityUtils.setTextContent(progressEl, statusText);
            };
            
            // Cleanup function to remove connecting state
            var cleanupConnectingState = function() {
                if (gatewayItem) {
                    gatewayItem.classList.remove('connecting');
                    var progressEl = gatewayItem.querySelector('[data-progress="true"]');
                    if (progressEl) {
                        progressEl.parentNode.removeChild(progressEl);
                    }
                }
            };
            
            // SigV4-authenticated gateways - use AWS credentials (no OAuth needed)
            if (gateway.authType === 'sigv4' && window.MCPService) {
                console.log('[App] Using SigV4 auth for:', gateway.name);
                progressCallback('connecting', 'Signing with AWS credentials...');
                window.MCPService.connectWithSigV4(gateway, progressCallback)
                    .then(function() {
                        cleanupConnectingState();
                        renderGateways(window.GatewayService.getGateways());
                        updateToolsList();
                        updateConnectionStatus();
                        window.GatewayService.syncToolsWithChatService();
                    })
                    .catch(function(error) {
                        cleanupConnectingState();
                        hideSkeleton('tools');
                        showError('Failed to connect: ' + error.message);
                    });
            } else if (gateway.authType === 'proxy' && window.MCPService) {
                console.log('[App] Using proxy auth for:', gateway.name);
                progressCallback('connecting', 'Connecting via backend proxy...');
                window.MCPService.connectWithProxy(gateway, progressCallback)
                    .then(function() {
                        cleanupConnectingState();
                        renderGateways(window.GatewayService.getGateways());
                        updateToolsList();
                        updateConnectionStatus();
                        window.GatewayService.syncToolsWithChatService();
                    })
                    .catch(function(error) {
                        cleanupConnectingState();
                        hideSkeleton('tools');
                        showError('Failed to connect: ' + error.message);
                    });
            } else if (gateway.authDiscoveryUrl && gateway.clientId && window.MCPService) {
                // Use gateway-specific OAuth flow if the gateway has authDiscoveryUrl
                // Each gateway has its own Cognito User Pool, so we need gateway-specific tokens
                console.log('[App] Using gateway-specific OAuth for:', gateway.name);
                window.MCPService.connectWithGatewayAuth(gateway, progressCallback)
                    .then(function() {
                        cleanupConnectingState();
                        renderGateways(window.GatewayService.getGateways());
                        updateToolsList();
                        updateConnectionStatus();
                        window.GatewayService.syncToolsWithChatService();
                    })
                    .catch(function(error) {
                        cleanupConnectingState();
                        hideSkeleton('tools');
                        showError('Failed to connect: ' + error.message);
                    });
            } else {
                // Fallback to frontend access token (for gateways without their own auth)
                var accessToken = window.AuthService.getAccessToken();
                if (!accessToken) {
                    cleanupConnectingState();
                    hideSkeleton('tools');
                    showError('Not authenticated. Please sign in first.');
                    return;
                }
                
                // Show connecting status for non-OAuth flow too
                progressCallback('connecting', 'Connecting to gateway...');
                
                window.GatewayService.connect(gateway, accessToken)
                    .then(function() {
                        cleanupConnectingState();
                        renderGateways(window.GatewayService.getGateways());
                        updateToolsList();
                        updateConnectionStatus();
                        window.GatewayService.syncToolsWithChatService();
                    })
                    .catch(function(error) {
                        cleanupConnectingState();
                        hideSkeleton('tools');
                        showError('Failed to connect: ' + error.message);
                    });
            }
        }
    }

    function updateToolsList() {
        if (!elements.toolsList) return;
        
        // Hide tools skeleton
        hideSkeleton('tools');
        
        var tools = window.GatewayService.getAllTools();
        var escapeHtml = window.SecurityUtils.escapeHtml;
        
        if (tools.length === 0) {
            elements.toolsList.innerHTML = '<p class="tools-placeholder">Connect to gateways to see tools</p>';
            return;
        }
        
        elements.toolsList.innerHTML = '';
        tools.forEach(function(tool) {
            var item = document.createElement('div');
            item.className = 'tool-item';
            item.innerHTML = '<span class="tool-item-icon">🔧</span><span>' + escapeHtml(tool.name) + '</span>';
            item.title = tool.description || tool.name;
            elements.toolsList.appendChild(item);
        });
    }

    // ============================================================
    // Conversation History Management
    // ============================================================

    function loadConversations() {
        if (!window.ConversationService) return;
        
        if (elements.conversationList) {
            elements.conversationList.innerHTML = '<p class="conversation-loading">Loading...</p>';
        }
        
        window.ConversationService.listConversations(30)
            .then(function(result) {
                renderConversations(result.conversations || []);
            })
            .catch(function(error) {
                console.error('[App] Failed to load conversations:', error);
                if (elements.conversationList) {
                    elements.conversationList.innerHTML = '<p class="conversation-error">Failed to load</p>';
                }
            });
    }

    function renderConversations(conversations) {
        if (!elements.conversationList) return;
        
        elements.conversationList.innerHTML = '';
        var escapeHtml = window.SecurityUtils.escapeHtml;
        var currentId = window.ConversationService ? window.ConversationService.getCurrentConversationId() : null;
        
        if (!conversations || conversations.length === 0) {
            elements.conversationList.innerHTML = '<p class="conversation-empty">No conversations yet</p>';
            return;
        }
        
        conversations.forEach(function(conv) {
            var isActive = conv.conversationId === currentId;
            
            var item = document.createElement('div');
            item.className = 'conversation-item' + (isActive ? ' active' : '');
            item.setAttribute('data-conversation-id', conv.conversationId);
            
            item.innerHTML = '\
                <span class="conversation-item-icon">💬</span>\
                <div class="conversation-item-content">\
                    <div class="conversation-item-title">' + escapeHtml(conv.title || 'Untitled') + '</div>\
                    <div class="conversation-item-meta">\
                        <span class="conversation-item-time">' + escapeHtml(window.ConversationService.formatRelativeTime(conv.updatedAt)) + '</span>\
                        <span class="conversation-item-count">' + (conv.messageCount || 0) + ' msgs</span>\
                    </div>\
                </div>\
                <button class="conversation-item-delete" title="Delete conversation">&times;</button>';
            
            // Click to load conversation
            item.addEventListener('click', function(e) {
                // Ignore if clicking the delete button
                if (e.target.classList.contains('conversation-item-delete')) return;
                handleLoadConversation(conv.conversationId);
            });
            
            // Delete button
            var deleteBtn = item.querySelector('.conversation-item-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    handleDeleteConversation(conv.conversationId, conv.title);
                });
            }
            
            elements.conversationList.appendChild(item);
        });
    }

    function handleLoadConversation(conversationId) {
        if (!window.ConversationService || !chatbot) return;
        
        console.log('[App] Loading conversation:', conversationId);
        
        window.ConversationService.getConversation(conversationId)
            .then(function(conv) {
                // Set the current conversation ID
                window.ConversationService.setCurrentConversationId(conversationId);
                
                // Clear current chat and restore messages
                if (chatbot.clearConversation) {
                    chatbot.clearConversation();
                }
                
                // Restore Bedrock conversation history
                if (window.BedrockService && conv.messages) {
                    window.BedrockService.conversationHistory = conv.messages;
                }
                
                // Restore model if saved
                if (conv.modelId && window.BedrockService) {
                    window.BedrockService.setModelId(conv.modelId);
                }
                
                // Re-render messages in the chatbot UI
                if (chatbot.messageRenderer && conv.messages) {
                    renderRestoredMessages(conv.messages);
                }
                
                // Update the conversation list to highlight active
                loadConversations();
                
                console.log('[App] Conversation loaded:', conversationId, '(' + (conv.messages ? conv.messages.length : 0) + ' messages)');
            })
            .catch(function(error) {
                console.error('[App] Failed to load conversation:', error);
                showError('Failed to load conversation: ' + error.message);
            });
    }

    function renderRestoredMessages(messages) {
        if (!chatbot || !chatbot.messageRenderer) return;
        
        messages.forEach(function(msg) {
            var role = msg.role;
            var content = msg.content || [];
            
            if (role === 'user') {
                // Extract text from user message
                var text = '';
                content.forEach(function(block) {
                    if (block.text) text += block.text;
                });
                if (text) {
                    chatbot.messageRenderer.addMessage('user', text);
                }
            } else if (role === 'assistant') {
                // Extract text and tool uses from assistant message
                var assistantText = '';
                var toolUses = [];
                
                content.forEach(function(block) {
                    if (block.text) {
                        assistantText += block.text;
                    }
                    if (block.toolUse) {
                        toolUses.push({
                            id: block.toolUse.toolUseId,
                            name: block.toolUse.name,
                            input: block.toolUse.input,
                            status: 'completed'
                        });
                    }
                    if (block.toolResult) {
                        // Tool results are displayed inline with the tool use
                    }
                });
                
                if (assistantText || toolUses.length > 0) {
                    var msgId = chatbot.messageRenderer.addMessage('assistant', assistantText);
                    
                    // Add tool use indicators for restored messages
                    toolUses.forEach(function(tu) {
                        chatbot.messageRenderer.addToolUseToMessage(msgId, tu);
                        chatbot.messageRenderer.updateToolUseStatus(tu.id, 'completed', '(restored from history)');
                    });
                }
            }
        });
    }

    function handleDeleteConversation(conversationId, title) {
        if (!window.ConversationService) return;
        
        if (!confirm('Delete "' + (title || 'Untitled') + '"?')) return;
        
        window.ConversationService.deleteConversation(conversationId)
            .then(function() {
                console.log('[App] Conversation deleted:', conversationId);
                
                // If it was the current conversation, clear the chat
                if (window.ConversationService.getCurrentConversationId() === null && chatbot) {
                    chatbot.clearConversation();
                }
                
                loadConversations();
            })
            .catch(function(error) {
                console.error('[App] Failed to delete conversation:', error);
                showError('Failed to delete conversation');
            });
    }

    function handleNewChat() {
        if (window.ConversationService) {
            window.ConversationService.clearCurrentConversation();
        }
        if (chatbot) {
            chatbot.clearConversation();
        }
        if (window.BedrockService) {
            window.BedrockService.clearHistory();
        }
        loadConversations();
    }

    // ============================================================
    // Chatbot Integration
    // ============================================================

    function initChatbot() {
        if (!window.ChatbotComponent) {
            console.error('[App] ChatbotComponent not loaded');
            return;
        }
        
        chatbot = new window.ChatbotComponent('chatbot-container', {
            getAccessToken: function() {
                return window.AuthService.getAccessToken();
            },
            getIdToken: function() {
                return window.AuthService.getIdToken();
            },
            getApiEndpoint: function() {
                return window.GatewayService.getApiEndpoint();
            },
            getGatewaysList: function() {
                return window.GatewayService.getGateways();
            }
        });
        
        chatbot.init();
        console.log('[App] Chatbot initialized');
    }

    // ============================================================
    // Tab Bar & Workflow Builder
    // ============================================================

    var workflowBuilder = null;

    function initTabBar() {
        var tabBarEl = document.getElementById('tabBar');
        if (window.TabBar && tabBarEl) {
            window.TabBar.init(tabBarEl);
            window.TabBar.onSwitch = function(tabId) {
                var sidebar = document.getElementById('sidebar');
                if (tabId === 'workflows') {
                    if (sidebar) sidebar.style.display = 'none';
                    if (!workflowBuilder) {
                        var root = document.getElementById('workflow-builder-root');
                        if (root && window.WorkflowBuilder) {
                            workflowBuilder = new window.WorkflowBuilder(root);
                        }
                    }
                    if (workflowBuilder) workflowBuilder.onActivate();
                } else {
                    if (sidebar) sidebar.style.display = '';
                    if (workflowBuilder) workflowBuilder.onDeactivate();
                }
            };
        }
    }

    // ============================================================
    // Event Listeners
    // ============================================================

    function setupEventListeners() {
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', handleLogout);
        }
        if (elements.sidebarToggle) {
            elements.sidebarToggle.addEventListener('click', toggleSidebar);
        }
        if (elements.sidebarToggleMobile) {
            elements.sidebarToggleMobile.addEventListener('click', openSidebar);
        }
        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.addEventListener('click', closeSidebar);
        }
        if (elements.refreshGatewaysBtn) {
            elements.refreshGatewaysBtn.addEventListener('click', loadGateways);
        }
        if (elements.refreshModelRunsBtn) {
            elements.refreshModelRunsBtn.addEventListener('click', loadModelRuns);
        }
        if (elements.newChatBtn) {
            elements.newChatBtn.addEventListener('click', handleNewChat);
        }
        if (elements.darkModeToggle) {
            elements.darkModeToggle.addEventListener('click', toggleDarkMode);
        }
    }

    function handleLogout() {
        // Cleanup services
        if (window.MCPService) {
            window.MCPService.abortAll();
            window.MCPService.disconnect();
        }
        if (window.ChatService) {
            window.ChatService.abortAll();
            window.ChatService.clearHistory();
        }
        if (window.ConversationService) {
            window.ConversationService.clearCurrentConversation();
        }
        
        removeApp();
        window.AuthService.logout(true);
    }

    // ============================================================
    // Initialization
    // ============================================================

    function init() {
        console.log('[App] Initializing Financial Planning...');
        console.log('[App] Current URL:', window.location.href);
        console.log('[App] Search params:', window.location.search);
        console.log('[App] Has code param:', new URLSearchParams(window.location.search).has('code'));
        
        // Check if we're in a popup window (gateway OAuth callback)
        // Gateway OAuth redirects to /callback with code, state params
        // We detect this by checking if window.opener exists AND we have code param
        var urlParams = new URLSearchParams(window.location.search);
        var hasCode = urlParams.has('code');
        var hasState = urlParams.has('state');
        var isPopup = window.opener && window.opener !== window;
        
        if (isPopup && hasCode && hasState) {
            console.log('[App] Detected gateway OAuth callback in popup, sending postMessage');
            
            // Send the OAuth response back to the opener window
            var message = {
                type: 'gateway-oauth-callback',
                code: urlParams.get('code'),
                state: urlParams.get('state'),
                error: urlParams.get('error'),
                error_description: urlParams.get('error_description')
            };
            
            try {
                window.opener.postMessage(message, window.location.origin);
                console.log('[App] Sent gateway OAuth callback to opener');
                // Don't close immediately - let the opener handle it
                // The popup will be closed by MCPService after processing
            } catch (e) {
                console.error('[App] Failed to send postMessage:', e);
            }
            
            // Show a simple message in the popup
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><p>Authentication complete. This window will close automatically.</p></div>';
            return;
        }
        
        // Merge DEV_CONFIG for local development
        var devConfig = window.DEV_CONFIG || {};
        var authConfig = {
            cognitoIdpId: config.cognitoIdpId || devConfig.cognitoIdpId,
            cognitoBaseUrl: config.cognitoBaseUrl || devConfig.cognitoBaseUrl,
            cognitoClientId: config.cognitoClientId || devConfig.cognitoClientId,
            cognitoUserPoolId: config.cognitoUserPoolId || devConfig.cognitoUserPoolId,
            tokenExchangeEndpoint: config.tokenExchangeEndpoint || devConfig.tokenExchangeEndpoint,
            stage: config.stage || devConfig.stage,
            awsRegion: config.awsRegion || devConfig.awsRegion
        };
        
        // Configure services
        window.AuthService.configure(authConfig);
        
        // Note: MCPService uses direct PKCE OAuth flow with Cognito - no API base URL needed
        
        // Setup login button on unauthorized screen
        var loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.addEventListener('click', function() {
                window.AuthService.login();
            });
        }
        
        // Check for OAuth error
        var oauthError = window.AuthService.checkForOAuthError();
        if (oauthError) {
            console.error('[App] OAuth error:', oauthError.description);
            showUnauthorizedWithError(oauthError.description);
            return;
        }
        
        // Check for OAuth callback (Authorization Code flow - async)
        if (window.AuthService.hasOAuthCallback()) {
            window.AuthService.handleAuthCallback()
                .then(function(success) {
                    if (success) {
                        injectApp();
                    } else {
                        showUnauthorizedWithError('Authentication failed. Please try again.');
                    }
                })
                .catch(function(error) {
                    console.error('[App] Auth callback error:', error);
                    showUnauthorizedWithError(error.message);
                });
            return;
        }
        
        // Try to restore session
        if (window.AuthService.restoreSession()) {
            injectApp();
            return;
        }

        var hasCognitoConfig =
            authConfig.cognitoBaseUrl &&
            !authConfig.cognitoBaseUrl.includes('##_') &&
            authConfig.cognitoClientId &&
            !authConfig.cognitoClientId.includes('##_');

        // No session - auto redirect to OAuth
        if (hasCognitoConfig) {
            console.log('[App] No session, redirecting to OAuth login...');
            // Hide loader with minimum time before redirect
            hideRobotLoader(function() {
                window.AuthService.login();
            });
        } else {
            showUnauthorizedWithError('Authentication is not configured for this stage.');
        }
    }

    // Start application
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

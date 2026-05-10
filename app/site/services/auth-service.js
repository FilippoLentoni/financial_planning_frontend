/**
 * Authentication Service Module
 * 
 * Implements OIDC Authorization Code Flow with PKCE for Cognito.
 * All token exchange is done client-side directly with Cognito - no backend Lambda needed.
 * 
 * Flow:
 * 1. User clicks Sign In
 * 2. Generate PKCE code_verifier and code_challenge
 * 3. Redirect to Cognito Hosted UI with code_challenge
 * 4. Cognito authenticates the user
 * 5. After auth, Cognito redirects back with authorization code
 * 6. Exchange code directly with Cognito token endpoint using code_verifier
 * 7. Store tokens and user info
 */

(function() {
    'use strict';

    /**
     * Generate a cryptographically secure random string
     * @param {number} length - Length of the string
     * @returns {string}
     */
    function generateRandomString(length) {
        var array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, function(byte) {
            return ('0' + byte.toString(16)).slice(-2);
        }).join('').substring(0, length);
    }

    /**
     * Generate a PKCE code verifier (43-128 characters)
     * @returns {string} Code verifier
     */
    function generateCodeVerifier() {
        // Generate 32 random bytes -> 64 hex chars, which is in the 43-128 range
        var array = new Uint8Array(32);
        window.crypto.getRandomValues(array);
        // Use base64url encoding for the verifier
        return base64UrlEncode(array);
    }

    /**
     * Generate PKCE code challenge from verifier using SHA-256
     * @param {string} verifier - The code verifier
     * @returns {Promise<string>} Code challenge (base64url encoded)
     */
    async function generateCodeChallenge(verifier) {
        var encoder = new TextEncoder();
        var data = encoder.encode(verifier);
        var hash = await window.crypto.subtle.digest('SHA-256', data);
        return base64UrlEncode(new Uint8Array(hash));
    }

    /**
     * Base64 URL encode (RFC 4648)
     * @param {Uint8Array} buffer - Buffer to encode
     * @returns {string} Base64 URL encoded string
     */
    function base64UrlEncode(buffer) {
        var binary = '';
        for (var i = 0; i < buffer.length; i++) {
            binary += String.fromCharCode(buffer[i]);
        }
        var base64 = btoa(binary);
        // Convert to base64url: replace + with -, / with _, remove =
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /**
     * Parse JWT token to extract claims
     * @param {string} token - JWT token
     * @returns {Object|null} Parsed claims
     */
    function parseJwt(token) {
        try {
            var parts = token.split('.');
            if (parts.length !== 3) return null;
            var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (payload.length % 4) {
                payload += '=';
            }
            return JSON.parse(atob(payload));
        } catch (e) {
            console.error('[Auth] Failed to parse JWT:', e);
            return null;
        }
    }

    /**
     * AuthService - Manages authentication state and OIDC flows
     */
    function AuthService() {
        this.config = null;
        this.state = {
            isAuthenticated: false,
            accessToken: null,
            idToken: null,
            refreshToken: null,
            user: null,
            expiresAt: null
        };
        this.refreshTimer = null;
    }

    /**
     * Configure the auth service with Cognito settings
     * @param {Object} config - Configuration object
     */
    AuthService.prototype.configure = function(config) {
        this.config = config;
    };

    /**
     * Get Cognito Hosted UI base URL
     * @returns {string|null}
     */
    AuthService.prototype.getCognitoDomain = function() {
        if (!this.config || !this.config.cognitoBaseUrl) {
            return null;
        }
        return 'https://' + this.config.cognitoBaseUrl;
    };

    /**
     * Get the current access token
     * @returns {string|null}
     */
    AuthService.prototype.getAccessToken = function() {
        return this.state.accessToken;
    };

    /**
     * Get the current ID token
     * @returns {string|null}
     */
    AuthService.prototype.getIdToken = function() {
        return this.state.idToken;
    };

    /**
     * Get the current user info
     * @returns {Object|null}
     */
    AuthService.prototype.getUser = function() {
        return this.state.user;
    };

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    AuthService.prototype.isAuthenticated = function() {
        return this.state.isAuthenticated;
    };

    /**
     * Initiate OIDC Authorization Code Flow with PKCE
     * Redirects to Cognito Hosted UI for authentication
     */
    AuthService.prototype.login = async function() {
        if (!this.config) {
            console.error('[Auth] Service not configured');
            return;
        }

        if (!this.config.cognitoBaseUrl || this.config.cognitoBaseUrl.includes('##_')) {
            console.error('[Auth] Cognito base URL not configured');
            return;
        }
        
        if (!this.config.cognitoClientId || this.config.cognitoClientId.includes('##_')) {
            console.error('[Auth] Cognito client ID not configured');
            return;
        }

        var cognitoDomain = this.getCognitoDomain();
        var clientId = this.config.cognitoClientId;
        var redirectUri = window.location.origin;
        var scope = 'openid aws.cognito.signin.user.admin';
        
        // Generate state for CSRF protection
        var state = generateRandomString(32);
        
        // Generate PKCE code verifier and challenge
        var codeVerifier = generateCodeVerifier();
        var codeChallenge = await generateCodeChallenge(codeVerifier);
        
        // Store state and code_verifier for callback validation
        try {
            sessionStorage.setItem('oauth_state', state);
            sessionStorage.setItem('pkce_code_verifier', codeVerifier);
        } catch (e) {
            console.error('[Auth] Failed to store OAuth state:', e);
            return;
        }
        
        // Build OAuth authorize URL with PKCE
        var loginUrl = cognitoDomain + '/oauth2/authorize' +
            '?client_id=' + encodeURIComponent(clientId) +
            '&response_type=code' +
            '&scope=' + encodeURIComponent(scope) +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&state=' + encodeURIComponent(state) +
            '&code_challenge=' + encodeURIComponent(codeChallenge) +
            '&code_challenge_method=S256';
        
        console.log('[Auth] Redirecting to OAuth login with PKCE...');
        window.location.href = loginUrl;
    };

    /**
     * Logout and clear session
     * @param {boolean} redirectToIdp - Whether to redirect to Cognito logout
     */
    AuthService.prototype.logout = function(redirectToIdp) {
        // Clear refresh timer
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        
        this.state.isAuthenticated = false;
        this.state.user = null;
        this.state.accessToken = null;
        this.state.idToken = null;
        this.state.refreshToken = null;
        this.state.expiresAt = null;
        
        // Clear URL
        window.history.replaceState(null, document.title, window.location.pathname);
        
        try {
            sessionStorage.removeItem('agentic_access_token');
            sessionStorage.removeItem('agentic_id_token');
            sessionStorage.removeItem('agentic_refresh_token');
            sessionStorage.removeItem('agentic_user');
            sessionStorage.removeItem('agentic_expires_at');
            sessionStorage.removeItem('oauth_state');
            sessionStorage.removeItem('pkce_code_verifier');
        } catch (e) {
            console.warn('[Auth] Could not clear session storage:', e);
        }
        
        if (redirectToIdp && this.config && this.config.cognitoBaseUrl && !this.config.cognitoBaseUrl.includes('##_')) {
            var cognitoDomain = this.getCognitoDomain();
            var clientId = this.config.cognitoClientId;
            var logoutUri = window.location.origin;
            
            var logoutUrl = cognitoDomain + '/logout' +
                '?client_id=' + encodeURIComponent(clientId) +
                '&logout_uri=' + encodeURIComponent(logoutUri);
            
            window.location.href = logoutUrl;
        }
    };

    /**
     * Exchange authorization code for tokens directly with Cognito
     * Using PKCE - no client secret needed
     * @param {string} code - Authorization code from OAuth callback
     * @param {string} codeVerifier - PKCE code verifier stored during login
     * @returns {Promise<Object>} Token response
     */
    AuthService.prototype.exchangeCodeForTokens = function(code, codeVerifier) {
        var self = this;
        var redirectUri = window.location.origin;
        var cognitoDomain = this.getCognitoDomain();
        var clientId = this.config.cognitoClientId;
        
        if (!cognitoDomain) {
            return Promise.reject(new Error('Cognito domain not configured'));
        }
        
        var tokenEndpoint = cognitoDomain + '/oauth2/token';
        
        console.log('[Auth] Exchanging code for tokens with PKCE...');
        
        // Build form data for token request
        var params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('client_id', clientId);
        params.append('code_verifier', codeVerifier);
        
        return fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        })
        .then(function(response) {
            if (!response.ok) {
                return response.json().then(function(err) {
                    throw new Error(err.error || err.message || 'Token exchange failed');
                }).catch(function(parseError) {
                    if (parseError.message.includes('Token exchange failed')) {
                        throw parseError;
                    }
                    throw new Error('Token exchange failed with status ' + response.status);
                });
            }
            return response.json();
        });
    };

    /**
     * Refresh tokens using the refresh token directly with Cognito
     * @returns {Promise<boolean>} True if refresh successful
     */
    AuthService.prototype.refreshTokens = function() {
        var self = this;
        
        if (!this.state.refreshToken) {
            console.warn('[Auth] No refresh token available');
            return Promise.resolve(false);
        }
        
        var cognitoDomain = this.getCognitoDomain();
        var clientId = this.config.cognitoClientId;
        
        if (!cognitoDomain) {
            console.error('[Auth] Cognito domain not configured');
            return Promise.resolve(false);
        }
        
        var tokenEndpoint = cognitoDomain + '/oauth2/token';
        
        console.log('[Auth] Refreshing tokens with Cognito...');
        
        // Build form data for refresh request
        var params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', this.state.refreshToken);
        params.append('client_id', clientId);
        
        return fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        })
        .then(function(response) {
            if (!response.ok) {
                console.error('[Auth] Token refresh failed');
                return false;
            }
            return response.json();
        })
        .then(function(tokens) {
            if (!tokens || !tokens.access_token) {
                return false;
            }
            
            self.state.accessToken = tokens.access_token;
            self.state.idToken = tokens.id_token || self.state.idToken;
            // Note: refresh_token may not be returned on refresh
            if (tokens.refresh_token) {
                self.state.refreshToken = tokens.refresh_token;
            }
            
            // Update expiration
            if (tokens.expires_in) {
                self.state.expiresAt = Date.now() + (tokens.expires_in * 1000);
            }
            
            // Persist updated tokens
            self.persistSession();
            
            // Schedule next refresh
            self.scheduleTokenRefresh();
            
            console.log('[Auth] Tokens refreshed successfully');
            return true;
        })
        .catch(function(err) {
            console.error('[Auth] Token refresh error:', err);
            return false;
        });
    };

    /**
     * Schedule automatic token refresh before expiration
     */
    AuthService.prototype.scheduleTokenRefresh = function() {
        var self = this;
        
        // Clear existing timer
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        
        if (!this.state.expiresAt || !this.state.refreshToken) {
            return;
        }
        
        // Refresh 5 minutes before expiration
        var refreshTime = this.state.expiresAt - Date.now() - (5 * 60 * 1000);
        
        if (refreshTime <= 0) {
            // Token already expired or will expire soon, refresh now
            this.refreshTokens();
            return;
        }
        
        console.log('[Auth] Scheduling token refresh in', Math.round(refreshTime / 1000), 'seconds');
        
        this.refreshTimer = setTimeout(function() {
            self.refreshTokens();
        }, refreshTime);
    };

    /**
     * Handle OAuth callback (authorization code flow with PKCE)
     * @returns {Promise<boolean>} True if callback was handled successfully
     */
    AuthService.prototype.handleAuthCallback = function() {
        var self = this;
        
        // Check for authorization code in URL query params
        var urlParams = new URLSearchParams(window.location.search);
        var code = urlParams.get('code');
        var returnedState = urlParams.get('state');
        var error = urlParams.get('error');
        
        // Check for error first
        if (error) {
            console.error('[Auth] OAuth error:', error, urlParams.get('error_description'));
            window.history.replaceState(null, document.title, window.location.pathname);
            return Promise.resolve(false);
        }
        
        if (!code) {
            return Promise.resolve(false);
        }

        // Retrieve stored state and code_verifier
        var storedState = null;
        var codeVerifier = null;
        try {
            storedState = sessionStorage.getItem('oauth_state');
            codeVerifier = sessionStorage.getItem('pkce_code_verifier');
        } catch (e) {
            console.error('[Auth] Failed to retrieve OAuth state:', e);
        }
        
        // Validate state (CSRF protection)
        if (storedState && returnedState !== storedState) {
            console.error('[Auth] State mismatch - possible CSRF attack');
            window.history.replaceState(null, document.title, window.location.pathname);
            return Promise.resolve(false);
        }
        
        // Validate code_verifier exists (required for PKCE)
        if (!codeVerifier) {
            console.error('[Auth] No code_verifier found - PKCE flow incomplete');
            window.history.replaceState(null, document.title, window.location.pathname);
            return Promise.resolve(false);
        }

        console.log('[Auth] Authorization code received, exchanging for tokens with PKCE...');

        // Clear code from URL immediately
        window.history.replaceState(null, document.title, window.location.pathname);
        
        // Clear stored state and code_verifier
        try {
            sessionStorage.removeItem('oauth_state');
            sessionStorage.removeItem('pkce_code_verifier');
        } catch (e) {
            // Ignore
        }

        return this.exchangeCodeForTokens(code, codeVerifier)
            .then(function(tokens) {
                console.log('[Auth] Token exchange successful');
                
                // Store tokens
                self.state.accessToken = tokens.access_token || null;
                self.state.idToken = tokens.id_token || null;
                self.state.refreshToken = tokens.refresh_token || null;
                self.state.isAuthenticated = true;
                
                // Set expiration
                if (tokens.expires_in) {
                    self.state.expiresAt = Date.now() + (tokens.expires_in * 1000);
                }

                // Parse user info from ID token
                if (tokens.id_token) {
                    var claims = parseJwt(tokens.id_token);
                    if (claims) {
                        self.state.user = {
                            email: claims.email || claims.sub || 'Unknown',
                            sub: claims.sub || 'Unknown'
                        };
                    }
                }

                // Persist session
                self.persistSession();
                
                // Schedule token refresh
                self.scheduleTokenRefresh();

                return true;
            })
            .catch(function(err) {
                console.error('[Auth] Token exchange failed:', err);
                return false;
            });
    };

    /**
     * Persist session to sessionStorage
     */
    AuthService.prototype.persistSession = function() {
        try {
            if (this.state.accessToken) {
                sessionStorage.setItem('agentic_access_token', this.state.accessToken);
            }
            if (this.state.idToken) {
                sessionStorage.setItem('agentic_id_token', this.state.idToken);
            }
            if (this.state.refreshToken) {
                sessionStorage.setItem('agentic_refresh_token', this.state.refreshToken);
            }
            if (this.state.user) {
                sessionStorage.setItem('agentic_user', JSON.stringify(this.state.user));
            }
            if (this.state.expiresAt) {
                sessionStorage.setItem('agentic_expires_at', String(this.state.expiresAt));
            }
        } catch (e) {
            console.warn('[Auth] Could not persist session:', e);
        }
    };

    /**
     * Restore session from sessionStorage
     * @returns {boolean} True if session was restored
     */
    AuthService.prototype.restoreSession = function() {
        try {
            var accessToken = sessionStorage.getItem('agentic_access_token');
            var idToken = sessionStorage.getItem('agentic_id_token');
            var refreshToken = sessionStorage.getItem('agentic_refresh_token');
            var user = sessionStorage.getItem('agentic_user');
            var expiresAt = sessionStorage.getItem('agentic_expires_at');
            
            if (accessToken && idToken) {
                this.state.accessToken = accessToken;
                this.state.idToken = idToken;
                this.state.refreshToken = refreshToken || null;
                this.state.isAuthenticated = true;
                this.state.expiresAt = expiresAt ? parseInt(expiresAt, 10) : null;
                
                if (user) {
                    this.state.user = JSON.parse(user);
                }
                
                console.log('[Auth] Session restored');
                
                // Check if token is expired or will expire soon
                if (this.state.expiresAt && Date.now() > this.state.expiresAt - (5 * 60 * 1000)) {
                    // Token expired or expiring soon, try to refresh
                    if (this.state.refreshToken) {
                        console.log('[Auth] Token expired, refreshing...');
                        this.refreshTokens();
                    } else {
                        console.log('[Auth] Token expired and no refresh token');
                        this.logout(false);
                        return false;
                    }
                } else {
                    // Schedule refresh for later
                    this.scheduleTokenRefresh();
                }
                
                return true;
            }
        } catch (e) {
            console.warn('[Auth] Could not restore session:', e);
        }
        return false;
    };

    /**
     * Check if there's an OAuth error in the URL
     * @returns {Object|null} Error info or null
     */
    AuthService.prototype.checkForOAuthError = function() {
        var urlParams = new URLSearchParams(window.location.search);
        var error = urlParams.get('error');
        
        if (error) {
            return {
                error: error,
                description: urlParams.get('error_description') || 'Authentication failed'
            };
        }
        return null;
    };

    /**
     * Check if URL has OAuth callback (authorization code in query params)
     * @returns {boolean}
     */
    AuthService.prototype.hasOAuthCallback = function() {
        var urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('code');
    };

    /**
     * Get IAM credentials for MCP gateway authentication
     * Uses Cognito Identity Pool to exchange ID token for temporary AWS credentials
     * @returns {Promise<Object|null>} AWS credentials object or null if not available
     */
    AuthService.prototype.getIamCredentials = function() {
        var idToken = this.getIdToken();
        
        if (!idToken) {
            console.warn('[Auth] No ID token available for IAM credentials');
            return Promise.resolve(null);
        }
        
        if (!window.BedrockService) {
            console.warn('[Auth] BedrockService not available for IAM credentials');
            return Promise.resolve(null);
        }
        
        return window.BedrockService.getCredentials(idToken)
            .then(function(credentials) {
                console.log('[Auth] Retrieved IAM credentials for MCP gateway authentication');
                return credentials;
            })
            .catch(function(error) {
                console.error('[Auth] Failed to get IAM credentials:', error);
                return null;
            });
    };

    /**
     * Check if IAM credentials are available
     * @returns {boolean} True if ID token is available (required for IAM credentials)
     */
    AuthService.prototype.hasIamCredentials = function() {
        return !!this.getIdToken();
    };

    // Export as singleton
    window.AuthService = new AuthService();

})();

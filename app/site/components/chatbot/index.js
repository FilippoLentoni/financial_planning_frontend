/**
 * Chatbot Components Index
 * Loads all chatbot sub-components in the correct order
 */

(function() {
    'use strict';

    // Components are loaded via script tags in order:
    // 1. security-utils.js (provides escapeHtml, setTextContent)
    // 2. message-renderer.js (depends on security-utils)
    // 3. tool-executor.js (depends on security-utils)
    // 4. stream-animation.js (standalone)
    // 5. worker-panel.js (depends on security-utils)
    // 6. orchestrator-ui.js (depends on security-utils)
    // 7. panels-manager.js (depends on security-utils)
    // 8. gateway-manager.js (standalone)
    // 9. chatbot.js (main component, depends on all above)

    console.log('[Chatbot] Components loaded:', Object.keys(window.ChatbotUtils || {}));

})();
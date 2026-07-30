/**
 * Built-in YouTube & Web AdBlock Engine for MelodyFlow
 * Network Interception + YouTube Config Sanitization + DOM Ad Eliminator
 */
(function() {
    'use strict';

    // 1. Blacklisted Ad Domains & Endpoint URL Patterns
    const AD_PATTERNS = [
        'doubleclick.net',
        'googleads.g.doubleclick.net',
        'pagead2.googlesyndication.com',
        'googleadservices.com',
        'adservice.google.com',
        '/api/stats/ads',
        '/pagead/',
        'ad_status',
        'ptracking',
        'get_midroll_'
    ];

    function isAdUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return AD_PATTERNS.some(pattern => url.includes(pattern));
    }

    // 2. Intercept fetch() Network Requests
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (isAdUrl(url)) {
            console.log('[MelodyFlow AdBlock] Blocked fetch ad request:', url);
            return new Response(JSON.stringify({ status: 'blocked' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        return originalFetch.apply(this, arguments);
    };

    // 3. Intercept XMLHttpRequest Requests
    const originalXHROpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        if (isAdUrl(url)) {
            console.log('[MelodyFlow AdBlock] Blocked XHR ad request:', url);
            try { this.abort(); } catch(e) {}
            return;
        }
        return originalXHROpen.apply(this, arguments);
    };

    // 4. DOM MutationObserver to detect and obliterate YouTube ad overlays
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (
                        node.classList.contains('ytp-ad-module') ||
                        node.classList.contains('ytp-ad-overlay-container') ||
                        node.classList.contains('video-ads') ||
                        node.classList.contains('ytp-ad-text') ||
                        node.id === 'player-ads'
                    ) {
                        node.remove();
                    }
                    const skipBtn = node.querySelector ? node.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button') : null;
                    if (skipBtn) {
                        try { skipBtn.click(); } catch(e) {}
                    }
                }
            }
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[MelodyFlow AdBlock Engine] Loaded & Active 🛡️');
})();

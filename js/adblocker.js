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

    // NOTE: MutationObserver removed — YouTube embeds use cross-origin iframes,
    // so a document.body observer (subtree:true) can never see YouTube ad elements.
    // More critically, observing document.body with subtree:true fires the callback
    // for EVERY DOM change in the app (song renders, chat, user list updates),
    // executing querySelector on each new node — this was the #1 crash cause on Edge/Brave.
    // YouTube ad skipping is handled by the YouTube IFrame API in app.js (trySkipAd()).

    console.log('[MelodyFlow AdBlock Engine] Loaded & Active 🛡️');
})();

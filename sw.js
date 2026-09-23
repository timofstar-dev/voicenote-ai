// ============================================
// VoiceNote AI — Service Worker
// Caching strategy: Cache First for static assets,
// Network First for API calls
// ============================================

const CACHE_NAME = 'voicenote-ai-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-512.jpg',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
    'https://cdn.jsdelivr.net/npm/marked@12.0.1/marked.min.js',
    'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
];

// Install — cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('Some assets failed to cache:', err);
                // Cache what we can, don't fail the install
                return Promise.allSettled(
                    STATIC_ASSETS.map((url) =>
                        cache.add(url).catch(() => console.warn('Failed to cache:', url))
                    )
                );
            });
        })
    );
    self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch — Cache First for static, Network First for API
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip Claude API calls — always go to network
    if (url.hostname === 'api.anthropic.com') {
        return;
    }

    // For navigation requests, try network first then cache
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
        );
        return;
    }

    // For other requests, cache first then network
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;

            return fetch(request)
                .then((response) => {
                    // Only cache successful same-origin or CDN responses
                    if (
                        response.ok &&
                        (url.origin === self.location.origin ||
                            url.hostname === 'cdn.jsdelivr.net' ||
                            url.hostname === 'fonts.googleapis.com' ||
                            url.hostname === 'fonts.gstatic.com')
                    ) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    // Return offline fallback for images
                    if (request.destination === 'image') {
                        return new Response('', { status: 404 });
                    }
                    return new Response('오프라인 상태입니다.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    });
                });
        })
    );
});

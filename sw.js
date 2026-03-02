/**
 * Shamrock Bail Bonds — Service Worker
 * Provides offline fallback page when no connection is available.
 * Caches shared design assets for faster repeat loads.
 */

const CACHE_NAME = 'shamrock-v1';
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
    OFFLINE_URL,
    '/shared/theme.css',
    '/shared/brand.js',
    '/shared/logo.png',
];

// Install: pre-cache offline page + shared assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first, fallback to offline page for navigation requests
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Navigation requests (page loads) → network-first, offline fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(OFFLINE_URL);
            })
        );
        return;
    }

    // Static assets (CSS, JS, images) → cache-first for speed
    if (
        event.request.url.includes('/shared/') ||
        event.request.url.endsWith('.css') ||
        event.request.url.endsWith('.png') ||
        event.request.url.endsWith('.svg')
    ) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    // Cache successful responses
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                }).catch(() => {
                    // Silent fail for non-critical assets
                    return new Response('', { status: 408 });
                });
            })
        );
        return;
    }
});

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  BackgroundSyncQueue,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const mutationQueue = new BackgroundSyncQueue("study-app-mutations", {
  maxRetentionTime: 24 * 60,
  forceSyncFallback: true,
});

const apiDataCache = new NetworkFirst({
  cacheName: "api-data",
  plugins: [new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 })],
  networkTimeoutSeconds: 5,
});

const imageCache = new CacheFirst({
  cacheName: "images",
  plugins: [
    new ExpirationPlugin({
      maxEntries: 100,
      maxAgeSeconds: 30 * 24 * 60 * 60,
    }),
  ],
});

const authMutationNetworkOnly = new NetworkOnly();
const aiNetworkOnly = new NetworkOnly();

const authMeCache = new NetworkFirst({
  cacheName: "auth-me",
  plugins: [new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 })],
  networkTimeoutSeconds: 5,
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.method === "GET" &&
        (url.pathname === "/api/auth/me" || url.pathname === "/api/auth/profile"),
      handler: authMeCache,
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/auth"),
      handler: authMutationNetworkOnly,
    },
    {
      matcher: ({ url }) =>
        url.pathname.includes("/generate") || url.pathname.includes("/ai"),
      handler: aiNetworkOnly,
    },
    {
      matcher: ({ request, url }) =>
        request.method === "GET" && url.pathname.startsWith("/api/"),
      handler: apiDataCache,
    },
    {
      matcher: ({ request }) => request.destination === "image",
      handler: imageCache,
    },
    {
      matcher: ({ request, sameOrigin }) =>
        request.method === "GET" && sameOrigin && request.mode !== "navigate",
      handler: new NetworkFirst({
        cacheName: "pages",
        plugins: [new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 })],
        networkTimeoutSeconds: 5,
      }),
    },
    ...defaultCache,
  ],
});

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Offline - Study App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a; color: #fafafa;
    }
    .wrap { text-align: center; padding: 1.5rem; max-width: 24rem; }
    svg { width: 3.5rem; height: 3.5rem; color: #a1a1aa; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; color: #a1a1aa; line-height: 1.5; margin-bottom: 1.25rem; }
    .btns { display: flex; gap: 0.75rem; justify-content: center; }
    button {
      padding: 0.5rem 1rem; border-radius: 0.375rem; font-size: 0.875rem;
      font-weight: 500; cursor: pointer; border: 1px solid #27272a;
      background: #18181b; color: #fafafa; transition: background 0.15s;
    }
    button:hover { background: #27272a; }
    button.primary { background: #fafafa; color: #0a0a0a; border-color: #fafafa; }
    button.primary:hover { background: #e4e4e7; }
  </style>
</head>
<body>
  <div class="wrap">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
      stroke-width="1.5" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
      <line x1="4" y1="4" x2="20" y2="20" stroke-linecap="round" />
    </svg>
    <h1>Content not available offline</h1>
    <p>This page hasn't been cached yet. It will load when you reconnect,
       or go back to a page you've already visited.</p>
    <div class="btns">
      <button onclick="history.back()">Go back</button>
      <button class="primary" onclick="location.reload()">Retry</button>
    </div>
  </div>
</body>
</html>`;

function fetchWithTimeout(req: Request, ms = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(req, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// Register BEFORE serwist.addEventListeners() so this runs first.
// Only respondWith for navigations and write mutations;
// all other requests fall through to Serwist's handler.
self.addEventListener("fetch", (event: FetchEvent) => {
  const { request } = event;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open("pages");
        try {
          const networkResponse = await fetchWithTimeout(request, 3000);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response(OFFLINE_HTML, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
      })(),
    );
    return;
  }

  if (
    request.method === "POST" ||
    request.method === "PATCH" ||
    request.method === "DELETE"
  ) {
    if (
      request.url.includes("/api/") &&
      !request.url.includes("/api/auth")
    ) {
      event.respondWith(
        (async () => {
          try {
            return await fetchWithTimeout(request.clone(), 2000);
          } catch {
            await mutationQueue.pushRequest({ request });
            return new Response(
              JSON.stringify({
                queued: true,
                message: "Saved offline. Will sync when back online.",
              }),
              {
                status: 202,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        })(),
      );
    }
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "REPLAY_MUTATIONS") {
    event.waitUntil(mutationQueue.replayRequests());
  }
});

// Serwist handles everything else: API caching, images, static assets, etc.
serwist.addEventListeners();

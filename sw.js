// Service Worker para Evaluación Competencial ESO
// Estrategia:
//   - Cache-first para recursos estáticos (HTML, JS, CSS, iconos)
//   - Network-first para las dependencias CDN (Tailwind, XLSX, Firebase)
//     con fallback a caché si no hay conexión
//   - Las llamadas a Firebase van siempre a la red (no se cachean)

const CACHE_VERSION = 'v1.2.0';
const CACHE_NAME = 'perfil-competencial-' + CACHE_VERSION;

// Recursos estáticos propios (se cachean al instalar)
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

// Recursos externos (CDN) que también queremos cachear para uso offline
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'
];

// === Instalación: precachear recursos ===
// Si algún recurso falla, NO se rompe la instalación. El SW se instala
// igualmente y los recursos se cachean bajo demanda en el fetch.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Intentar cachear recursos estáticos propios
      for (const url of STATIC_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] No se pudo precachear', url, err.message);
        }
      }
      // Intentar cachear recursos CDN (no es obligatorio para instalar)
      for (const url of CDN_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] No se pudo precachear CDN', url, err.message);
        }
      }
    })
  );
  self.skipWaiting();
});

// === Activación: limpiar caches antiguos ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('perfil-competencial-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// === Fetch: estrategia según el tipo de recurso ===
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignorar peticiones que no sean GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. No interceptar las llamadas a Firebase (databaseURL de firebasedatabase.app)
  //    Estas deben ir siempre a la red para datos en tiempo real.
  if (url.hostname.endsWith('firebasedatabase.app') ||
      url.hostname.endsWith('firebaseio.com')) {
    return;
  }

  // 2. Recursos propios (mismo origen): cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          // Cachear la respuesta si es válida
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          // Si es navegación y no hay cache, devolver index.html cached
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
    );
    return;
  }

  // 3. Recursos CDN (Tailwind, XLSX, Firebase SDK): stale-while-revalidate
  //    Devolver cache si existe, y en paralelo actualizar para la próxima vez.
  if (CDN_ASSETS.some((cdnUrl) => url.href.startsWith(cdnUrl))) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse); // Si no hay red, usar cache
        return cachedResponse || networkFetch;
      })
    );
    return;
  }

  // 4. Otros recursos: network-first con fallback a cache
  event.respondWith(
    fetch(request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
      }
      return networkResponse;
    }).catch(() => caches.match(request))
  );
});

// === Mensajes del cliente (para forzar actualización) ===
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

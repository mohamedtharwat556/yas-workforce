// Service Worker — تخزين مؤقت للأصول + شاشة أساسية عند انقطاع الشبكة
const CACHE = 'yas-workforce-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']

// رد احتياطي مضمون (لازم نرجّع Response دايمًا وإلا respondWith هيفشل)
function offlineFallback() {
  return new Response('<!doctype html><meta charset="utf-8"><title>غير متصل</title>', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // نتجاهل أي طلب خارج نطاق الموقع (زي Supabase API)
  if (url.origin !== self.location.origin) return

  // التنقّل: جرّب الشبكة، ولو فشلت ارجع للواجهة المخزّنة
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = (await caches.match('/index.html')) || (await caches.match('/'))
        return cached || offlineFallback()
      })
    )
    return
  }

  // الأصول: من الكاش أولاً، وإلا من الشبكة مع تخزينها
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached || offlineFallback())
    })
  )
})

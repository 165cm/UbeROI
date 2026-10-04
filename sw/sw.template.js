// デリ勘の Service Worker（ビルド時に vite.config.ts が版と一覧を埋め込んで dist/sw.js を作る）
// 方針：アプリ本体だけを端末に保存してオフラインで開けるようにする。外部のデータは保存しない。
const VERSION = __VERSION__
const PRECACHE = __PRECACHE__
const CACHE = `deli-kan-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('deli-kan-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// 新しい版は、利用者が「更新する」を押した時だけ切り替える（入力中のフォームを勝手に消さない）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // 別のサイトへの通信には関わらない（キャッシュしない）
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((cached) => cached || fetch(request)))
    return
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
})

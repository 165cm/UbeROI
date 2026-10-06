// デリ勘の Service Worker（ビルド時に vite.config.ts が版と一覧を埋め込んで dist/sw.js を作る）
// 方針：アプリ本体だけを端末に保存してオフラインで開けるようにする。外部のデータは保存しない。
const VERSION = __VERSION__
const PRECACHE = __PRECACHE__
const CACHE = `deli-kan-${VERSION}`
// スクショの文字の読み取りのファイル：使った時に保存し、版が変わっても消さない（2回目からはオフラインでも読み取れる）
const OCR_CACHE = 'deli-kan-ocr-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('deli-kan-') && k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
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
  if (url.pathname.includes('/ocr/')) {
    event.respondWith(
      caches.open(OCR_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((res) => {
              if (res.ok) cache.put(request, res.clone())
              return res
            }),
        ),
      ),
    )
    return
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
})

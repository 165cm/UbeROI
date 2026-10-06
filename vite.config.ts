import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * ビルドした全ファイルの一覧と版を埋め込んで sw.js を作る（オフラインで開くための Service Worker）。
 * 版は中身から計算するので、アプリが変わった時だけ「新しい版があります」になる。
 */
function serviceWorker(): Plugin {
  return {
    name: 'deli-kan-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync('public')
      // 文字認識のファイル（ocr/）は重いので、最初の保存の一覧には入れない
      const files = ['index.html', ...Object.keys(bundle).filter((f) => f !== 'index.html' && !f.startsWith('ocr/')), ...publicFiles].sort()
      const hash = createHash('sha256')
      for (const name of Object.keys(bundle).filter((f) => !f.startsWith('ocr/')).sort()) {
        const item = bundle[name]!
        hash.update(name)
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source))
      }
      for (const name of publicFiles.sort()) hash.update(readFileSync(`public/${name}`))
      const source = readFileSync('sw/sw.template.js', 'utf8')
        .replace('__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__PRECACHE__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/**
 * スクショの文字の読み取り（端末の中で動く文字認識 tesseract.js）に使うファイルを ocr/ に置く。
 * 外部のサイトからは読み込まない。重いので、最初の画面と一緒には保存せず（sw.js の一覧に入れない）、
 * 読み取りを使った時に読み込んで、端末に保存する（sw.template.js）
 */
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'jpn.traineddata.gz': 'node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz',
  'LICENSE-tesseract.txt': 'node_modules/tesseract.js-core/LICENSE',
}

function ocrAssets(): Plugin {
  return {
    name: 'deli-kan-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/\/ocr\/([^?]+)/)?.[1]
        const file = name ? OCR_FILES[name] : undefined
        if (!file) return next()
        res.setHeader('Content-Type', name!.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [name, file] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) })
    },
  }
}

// GitHub Pages は https://165cm.github.io/UbeROI/ で公開するため base を合わせる
export default defineConfig({
  base: '/UbeROI/',
  plugins: [react(), ocrAssets(), serviceWorker()],
})

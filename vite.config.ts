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
      const files = ['index.html', ...Object.keys(bundle).filter((f) => f !== 'index.html'), ...publicFiles].sort()
      const hash = createHash('sha256')
      for (const name of Object.keys(bundle).sort()) {
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

// GitHub Pages は https://165cm.github.io/UbeROI/ で公開するため base を合わせる
export default defineConfig({
  base: '/UbeROI/',
  plugins: [react(), serviceWorker()],
})

import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'

// 実際のHTTPキャッシュとService Workerを使い、更新時に古いHTMLを再保存しないことを確かめる。
test('更新を承認するまでは入力を保ち、承認後は新版がオフラインでも開く', async ({ page, context }) => {
  let version = 'old'
  const template = readFileSync('sw/sw.template.js', 'utf8')
  const server = createServer((req, res) => {
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.setHeader('Cache-Control', 'no-store')
      res.end(template.replace('__VERSION__', JSON.stringify(version)).replace('__PRECACHE__', JSON.stringify(['index.html'])))
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.end(`<h1>${version}</h1><input aria-label="入力"><button hidden>更新する</button><script>
      let applying = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
      navigator.serviceWorker.register('/sw.js').then(reg => {
        const offer = () => { document.querySelector('button').hidden = false; };
        if (reg.waiting) offer();
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(); });
        });
        document.querySelector('button').onclick = () => { applying = true; reg.waiting.postMessage('SKIP_WAITING'); };
      });
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/index.html`
  try {
    await page.goto(url)
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await page.reload()
    await expect(page.getByRole('heading')).toHaveText('old')
    await page.getByLabel('入力').fill('まだ保存していない入力')
    await page.evaluate(() => localStorage.setItem('saved-record', '保持する記録'))
    version = 'new'
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg!.update() })
    await expect(page.getByRole('button', { name: '更新する' })).toBeVisible()
    await expect(page.getByRole('heading')).toHaveText('old')
    await expect(page.getByLabel('入力')).toHaveValue('まだ保存していない入力')
    await page.getByRole('button', { name: '更新する' }).click()
    await expect(page.getByRole('heading')).toHaveText('new')
    expect(await page.evaluate(() => localStorage.getItem('saved-record'))).toBe('保持する記録')
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading')).toHaveText('new')
  } finally {
    await context.setOffline(false)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  }
})

// オフライン対応（Service Worker）と「ホーム画面に追加」の補助
import { useEffect, useState, useSyncExternalStore } from 'react'

type Listener = () => void

interface PwaState {
  /** 新しい版の準備ができていて、押せば切り替えられる */
  updateReady: boolean
  /** Android Chrome 等で、アプリとして追加するボタンを出せる */
  canInstall: boolean
}

let state: PwaState = { updateReady: false, canInstall: false }
const listeners = new Set<Listener>()
let waitingWorker: ServiceWorker | null = null
let installEvent: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null
let applyingUpdate = false

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** 本番だけで Service Worker を登録する（開発中はキャッシュで混乱しないよう登録しない） */
export function registerServiceWorker(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvent = e as typeof installEvent
    setState({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => setState({ canInstall: false }))

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        const offer = (worker: ServiceWorker) => {
          waitingWorker = worker
          setState({ updateReady: true })
        }
        // すでに前の版で動いている時だけ「新しい版」と知らせる（初回の登録では知らせない）
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting)
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker)
          })
        })
        // 開いたままでも、1時間ごとに新しい版を確かめる
        window.setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000)
      })
      .catch(() => undefined)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 利用者が「更新する」を押した時だけ読み込み直す
      if (applyingUpdate) window.location.reload()
    })
  })
}

export function applyUpdate(): void {
  if (!waitingWorker) return
  applyingUpdate = true
  waitingWorker.postMessage('SKIP_WAITING')
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return
  await installEvent.prompt()
  await installEvent.userChoice
  installEvent = null
  setState({ canInstall: false })
}

/** ホーム画面から（アプリとして）開いているか */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/**
 * ブラウザーに「容量が足りなくなっても消さないで」と頼む（端末の判断で断られることもある）。
 * 結果は true＝消えにくい保存、false＝通常の保存、null＝この端末では確かめられない。
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null
    if (await navigator.storage.persisted()) return true
    return navigator.storage.persist ? await navigator.storage.persist() : false
  } catch {
    return null
  }
}

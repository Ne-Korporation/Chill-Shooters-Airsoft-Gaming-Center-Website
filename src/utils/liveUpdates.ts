import { useEffect, useRef } from 'react'
import { apiBase } from './apiClient'

// Live updates: the server keeps a version number per topic (server/utils/changeFeed.js) and
// bumps it whenever that kind of data changes. One poller per tab watches it; when a topic moves,
// every page that showed that topic reloads its data in place (forms keep what was typed).

export type LiveTopic = 'reservations' | 'slots' | 'payments' | 'waivers' | 'notifications' | 'accounts' | 'gear' | 'games' | 'content'

type Snapshot = { bootId: string; versions: Record<string, number> }

const POLL_MS = 5_000
const listeners = new Set<(topics: Set<string>) => void>()
let last: Snapshot | null = null
let timer: number | undefined
let inFlight = false

async function poll() {
  if (inFlight || document.visibilityState !== 'visible') return
  inFlight = true
  try {
    const res = await fetch(`${apiBase}/api/changes`, { cache: 'no-store' })
    if (!res.ok) return
    const json = await res.json()
    const next: Snapshot | undefined = json?.data
    if (!next?.versions) return
    const changed = new Set<string>()
    if (last) {
      // The server restarted: anything may have changed while it was down.
      const restarted = last.bootId !== next.bootId
      for (const [topic, version] of Object.entries(next.versions)) {
        if (restarted || last.versions[topic] !== version) changed.add(topic)
      }
    }
    last = next
    if (changed.size) listeners.forEach((listener) => listener(changed))
  } catch {
    // Offline or the API is waking up: try again on the next tick.
  } finally {
    inFlight = false
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void poll()
}

function start() {
  if (timer !== undefined) return
  void poll()
  timer = window.setInterval(() => void poll(), POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
}

function stop() {
  if (timer === undefined) return
  window.clearInterval(timer)
  timer = undefined
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', onVisible)
}

export function subscribeLiveUpdates(listener: (topics: Set<string>) => void) {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stop()
  }
}

// Calls `reload` (debounced) whenever any of `topics` changes on the server. Use it with the
// page's own "load data quietly" function, e.g. useLiveRefresh(['reservations'], () => load(true)).
export function useLiveRefresh(topics: LiveTopic[], reload: () => unknown, enabled = true) {
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const key = topics.join(',')

  useEffect(() => {
    if (!enabled) return
    const wanted = new Set(key.split(','))
    let debounce: number | undefined
    const unsubscribe = subscribeLiveUpdates((changed) => {
      if (![...changed].some((topic) => wanted.has(topic))) return
      window.clearTimeout(debounce)
      // Several changes in a burst (a booking also touches slots, payments...) cause one reload.
      debounce = window.setTimeout(() => { void reloadRef.current() }, 400)
    })
    return () => {
      window.clearTimeout(debounce)
      unsubscribe()
    }
  }, [key, enabled])
}

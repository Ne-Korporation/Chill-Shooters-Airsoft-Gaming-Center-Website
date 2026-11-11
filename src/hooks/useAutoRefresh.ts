import { useEffect, useRef } from 'react'

// Re-runs `refresh` in the background so staff see new bookings and payments without reloading:
// every `intervalMs` while the tab is open and visible, and right away when they come back to the
// tab. A refresh still running is never started twice. Pass a refresh that doesn't show a loading
// state, so the page doesn't flash.
export function useAutoRefresh(refresh: () => unknown, intervalMs = 15_000) {
  const latest = useRef(refresh)
  latest.current = refresh

  useEffect(() => {
    let running = false
    const run = async () => {
      if (running || document.visibilityState !== 'visible') return
      running = true
      try {
        await latest.current()
      } catch {
        // A failed background refresh keeps what's on screen; the next one tries again.
      } finally {
        running = false
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void run() }
    const timer = window.setInterval(run, intervalMs)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
}

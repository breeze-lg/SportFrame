export type Theme = 'light' | 'dark'

const KEY = 'frame-app-theme'

export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return systemDark ? 'dark' : 'light'
}

export function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/**
 * Keeps the browser chrome in step with the app: the meta tag is read from the
 * applied `--wall` token rather than a hex literal, so the token stays the
 * single source of truth. Skips the write when the token has not loaded yet,
 * which leaves the document's existing declaration in place.
 */
function syncThemeColorMeta(): void {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const wall = getComputedStyle(document.documentElement).getPropertyValue('--wall').trim()
  if (wall) meta.setAttribute('content', wall)
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.style.colorScheme = t
  syncThemeColorMeta()
}

export function setTheme(t: Theme): void {
  applyTheme(t)
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function initTheme(): Theme {
  const t = resolveTheme(readStoredTheme(), systemPrefersDark())
  applyTheme(t)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (readStoredTheme() === null) applyTheme(e.matches ? 'dark' : 'light')
  })
  return t
}

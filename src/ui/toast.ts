let host: HTMLElement | null = null
let timer: number | undefined

export function toast(message: string): void {
  if (!host) {
    host = document.getElementById('toast')
    if (!host) return
  }
  host.textContent = message
  host.classList.add('show')
  window.clearTimeout(timer)
  timer = window.setTimeout(() => host?.classList.remove('show'), 1800)
}

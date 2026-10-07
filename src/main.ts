import './styles/tokens.css'
import './styles/app.css'
import { initTheme } from './ui/theme'

initTheme()

const root = document.getElementById('app')
if (root) root.textContent = 'ready'

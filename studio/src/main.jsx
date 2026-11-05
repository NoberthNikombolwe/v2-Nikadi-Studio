import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PublicScanPage from './PublicScanPage.jsx'
import { applyTheme, getThemePref } from './lib/theme.js'

// Apply the saved theme before the first render so the page never flashes the wrong colours
applyTheme(getThemePref())

// #/scan/<eventId> is the public, code-protected door-scanning page (no login)
const scanMatch = window.location.hash.match(/^#\/scan\/([0-9a-f-]{36})/i)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {scanMatch ? <PublicScanPage eventId={scanMatch[1]} /> : <App />}
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyTheme, getThemePref } from './lib/theme.js'

// Apply the saved theme before the first render so the page never flashes the wrong colours
applyTheme(getThemePref())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

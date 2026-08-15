import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/workspacePresets.css'
import './engine/omnirouteProvider.js'
import App from './App.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'

globalThis.__MEDANTIR_ENTRY_URL__ = import.meta.url

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
)

// Register the PWA service worker (offline app shell + installability). Prod only,
// after load so it never competes with first paint. Dev is left untouched.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch(() => {})
  })
}

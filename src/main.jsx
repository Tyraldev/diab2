import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// Auto-update du service worker avec notification de rechargement
const updateSW = registerSW({
  onNeedRefresh() {
    // Une nouvelle version est dispo : afficher un bandeau
    showUpdateBanner(() => updateSW(true))
  },
  onOfflineReady() {
    console.log('App prete pour le mode hors-ligne')
  },
})

function showUpdateBanner(onReload) {
  // Eviter les doublons
  if (document.getElementById('sw-update-banner')) return
  const bar = document.createElement('div')
  bar.id = 'sw-update-banner'
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1836B2;color:white;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;z-index:99999;font-family:Arial,sans-serif;font-size:14px;box-shadow:0 -2px 12px rgba(0,0,0,0.2)'
  const txt = document.createElement('span')
  txt.textContent = 'Nouvelle version disponible'
  const btn = document.createElement('button')
  btn.textContent = 'Mettre a jour'
  btn.style.cssText = 'background:white;color:#1836B2;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px'
  btn.onclick = () => { btn.textContent = 'Mise a jour...'; onReload() }
  bar.appendChild(txt)
  bar.appendChild(btn)
  document.body.appendChild(bar)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

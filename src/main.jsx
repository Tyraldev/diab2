import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

const CHECK_INTERVAL_MS = 60 * 1000

// Enregistre le SW pour le mode hors-ligne
registerSW({ immediate: true })

let knownBuildId = null   // le buildId au moment ou l app a ete chargee
let bannerShown = false

async function fetchBuildId() {
  const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
  if (!res.ok) throw new Error('version.json status ' + res.status)
  const data = await res.json()
  return data && data.buildId ? String(data.buildId) : null
}

async function checkForUpdate() {
  try {
    const serverBuild = await fetchBuildId()
    if (!serverBuild) return
    // Premiere lecture: on memorise le build courant (celui qui tourne)
    if (knownBuildId === null) {
      knownBuildId = serverBuild
      return
    }
    // Si le serveur a un build different de celui charge au demarrage -> nouvelle version
    if (serverBuild !== knownBuildId) {
      showUpdateBanner()
    }
  } catch (_) { /* hors-ligne / erreur: on ignore */ }
}

async function forceUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch (_) { /* ignore */ }
  location.reload()
}

function showUpdateBanner() {
  if (bannerShown || document.getElementById('sw-update-banner')) return
  bannerShown = true
  const bar = document.createElement('div')
  bar.id = 'sw-update-banner'
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1836B2;color:white;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;z-index:99999;font-family:Arial,sans-serif;font-size:14px;box-shadow:0 -2px 12px rgba(0,0,0,0.2)'
  const txt = document.createElement('span')
  txt.textContent = 'Nouvelle version disponible'
  const btn = document.createElement('button')
  btn.textContent = 'Mettre a jour'
  btn.style.cssText = 'background:white;color:#1836B2;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px'
  btn.onclick = () => { btn.textContent = 'Mise a jour...'; forceUpdate() }
  bar.appendChild(txt)
  bar.appendChild(btn)
  document.body.appendChild(bar)
}

// Lecture initiale (memorise le build courant), puis verification periodique
checkForUpdate()
setInterval(checkForUpdate, CHECK_INTERVAL_MS)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
window.addEventListener('focus', checkForUpdate)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

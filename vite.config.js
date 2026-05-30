import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Identifiant unique genere a chaque build - sert a detecter les nouvelles versions
const BUILD_ID = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    {
      // Emet un fichier version.json (non cache) contenant l identifiant du build
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID }) })
      }
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'DiabeteTracker',
        short_name: 'DiabeteTracker',
        description: 'Suivi diabete Dexcom ONE+',
        theme_color: '#dc2626',
        background_color: '#f7f3ef',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true,
        // Ne pas intercepter les routes API
        navigateFallbackDenylist: [/^\/api\/.*/],
        globIgnores: ['version.json'],
        runtimeCaching: [
          {
            urlPattern: /version\.json/,
            handler: 'NetworkOnly'
          },
          {
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkOnly'
          },
          {
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ]
})

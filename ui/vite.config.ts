import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/** Some clients still request `/favicon.ico`; serve the SVG so the console stays clean. */
function faviconIcoFallback(): Plugin {
  return {
    name: 'favicon-ico-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/favicon.ico' || req.url?.startsWith('/favicon.ico?')) {
          res.statusCode = 302
          res.setHeader('Location', '/favicon.svg')
          res.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), faviconIcoFallback()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3220',
        changeOrigin: true,
      },
    },
  },
})

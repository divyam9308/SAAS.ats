import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const localApiTarget = process.env.ATS_API_PROXY || 'http://127.0.0.1:4000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    minify: 'oxc',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': localApiTarget,
      '/share/open-roles': {
        target: localApiTarget,
      },
    },
  },
})

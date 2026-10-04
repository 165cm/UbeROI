import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages は https://165cm.github.io/UbeROI/ で公開するため base を合わせる
export default defineConfig({
  base: '/UbeROI/',
  plugins: [react()],
})

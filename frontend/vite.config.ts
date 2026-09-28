import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// npm run dev 로 개발 서버(http://localhost:5173)를 띄우면,
// /api 로 시작하는 요청은 Go 백엔드(127.0.0.1:8080)로 넘겨준다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
})

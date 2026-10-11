import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站需要 base=/仓库名/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || process.env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [react()],
  }
})

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', '')
  const repositoryName = environment.GITHUB_REPOSITORY?.split('/')[1]
  const base = environment.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/'
  return {
    base,
  plugins: [react()],
  }
})

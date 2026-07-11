/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    // Les libs lourdes sont isolées du code applicatif : une mise à jour de l'app ne réinvalide pas
    // leur cache navigateur. Précieux sur forfait data limité, où chaque re-téléchargement coûte.
    // (Plus de chunk `charts` : recharts a été remplacé par du SVG maison, voir ADR-013.)
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion') || id.includes('motion-')) return 'motion'
          if (id.includes('/react') || id.includes('/scheduler/')) return 'react'
        },
      },
    },
  },
  test: {
    environment: 'node',
    // `api/` contient la fonction serverless de la vitrine : elle est publique, elle mérite des tests.
    include: ['src/**/*.test.ts', 'api/**/*.test.js'],
  },
})

import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: { open: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  // .glb is imported with ?url so Vite fingerprints and copies it on build
  assetsInclude: ['**/*.glb'],
})

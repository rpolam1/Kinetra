import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// exercises.json is shared with the python side and lives one level up, so let the dev server read it
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', sourcemap: true },
});

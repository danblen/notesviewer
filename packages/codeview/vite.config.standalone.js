import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone (self-contained) library build.
//
// Unlike the default build (which externalizes every heavy dep as a
// peerDependency), this variant bundles ALL rendering deps —
// react-markdown, highlight.js, remark-*, rehype-highlight, diff — INTO the
// single emitted JS file. Only React itself stays external so the consuming
// app shares one React instance (bundling React would break hooks).
//
// The result is a drop-in `codeview.js` + `codeview.css` pair that a consumer
// can vendor directly (no npm peer deps to install). Used by AI-team4.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-standalone',
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['es'],
      fileName: () => 'codeview.js',
    },
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      // Keep only React external; everything else is bundled in.
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        assetFileNames: (asset) =>
          asset.name && asset.name.endsWith('.css') ? 'codeview.css' : '[name][extname]',
      },
    },
  },
});

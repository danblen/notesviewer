import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Library build: emit a single ESM bundle + a single CSS file (codeview.css).
// All heavy rendering deps are externalized as peerDependencies so the
// consuming app supplies one copy (avoids duplicate React / highlight.js).
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['es'],
      fileName: () => 'codeview.js',
    },
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-markdown',
        'remark-gfm',
        'remark-breaks',
        'rehype-highlight',
        'highlight.js',
        'diff',
      ],
      output: {
        // Force the single emitted stylesheet to be named codeview.css so the
        // package export "./style.css" → "./dist/codeview.css" resolves.
        assetFileNames: (asset) =>
          asset.name && asset.name.endsWith('.css') ? 'codeview.css' : '[name][extname]',
      },
    },
  },
});

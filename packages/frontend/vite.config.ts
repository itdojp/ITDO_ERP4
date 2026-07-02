import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function frontendManualChunks(moduleId: string) {
  if (!moduleId.includes('/node_modules/')) return null;

  if (
    moduleId.includes('/node_modules/react/') ||
    moduleId.includes('/node_modules/react-dom/') ||
    moduleId.includes('/node_modules/scheduler/')
  ) {
    return 'react-vendor';
  }

  if (moduleId.includes('/node_modules/@itdo/design-system/')) {
    return 'design-system';
  }

  if (moduleId.includes('/node_modules/@tanstack/')) {
    return 'tanstack-vendor';
  }

  if (
    moduleId.includes('/node_modules/react-markdown/') ||
    moduleId.includes('/node_modules/remark-') ||
    moduleId.includes('/node_modules/remark/') ||
    moduleId.includes('/node_modules/micromark') ||
    moduleId.includes('/node_modules/mdast') ||
    moduleId.includes('/node_modules/unist') ||
    moduleId.includes('/node_modules/vfile') ||
    moduleId.includes('/node_modules/hast') ||
    moduleId.includes('/node_modules/trim-lines/') ||
    moduleId.includes('/node_modules/decode-named-character-reference/') ||
    moduleId.includes('/node_modules/comma-separated-tokens/') ||
    moduleId.includes('/node_modules/space-separated-tokens/') ||
    moduleId.includes('/node_modules/property-information/') ||
    moduleId.includes('/node_modules/estree') ||
    moduleId.includes('/node_modules/character-entities') ||
    moduleId.includes('/node_modules/markdown-table/') ||
    moduleId.includes('/node_modules/zwitch/') ||
    moduleId.includes('/node_modules/ccount/') ||
    moduleId.includes('/node_modules/devlop/')
  ) {
    return 'markdown-vendor';
  }

  return 'vendor';
}

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks: frontendManualChunks,
      },
    },
  },
  server: {
    port: 5173,
  },
});

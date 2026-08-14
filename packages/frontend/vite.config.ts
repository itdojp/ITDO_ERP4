import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function shareTargetDevModePlugin(): Plugin {
  return {
    name: 'erp4-share-target-dev-mode',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const mode = process.env.ERP4_DEV_SHARE_TARGET_MODE;
        if (mode !== 'enabled' && mode !== 'decommission') {
          next();
          return;
        }
        const requestUrl = new URL(request.url ?? '/', 'http://localhost');
        if (
          request.method !== 'GET' ||
          requestUrl.pathname !== '/share-target-mode.js'
        ) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('cache-control', 'no-store');
        response.setHeader(
          'content-type',
          'application/javascript; charset=utf-8',
        );
        response.end(`self.ERP4_SHARE_TARGET_MODE = ${JSON.stringify(mode)};\n`);
      });
    },
  };
}

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
  plugins: [shareTargetDevModePlugin(), react()],
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

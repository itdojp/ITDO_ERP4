import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './pages/App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const enableServiceWorker =
  import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === 'true';

if (enableServiceWorker && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      if (import.meta.env.DEV) {
        console.error('Service worker registration failed', error);
      }
    });
  });
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Global error handler — send crashes to backend for terminal visibility
window.addEventListener('error', (e) => {
  fetch('/api/ui-crash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: e.message, stack: e.error?.stack?.slice(0, 3000), filename: e.filename, lineno: e.lineno, colno: e.colno }),
  }).catch(() => {});
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
  fetch('/api/ui-crash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: err.message, stack: err.stack?.slice(0, 3000), type: 'unhandledrejection' }),
  }).catch(() => {});
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

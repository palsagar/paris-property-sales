import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { trackPageview } from '@/lib/analytics';
import { readLang, setLang } from '@/lib/i18n/language';
import { LanguageProvider } from '@/lib/i18n/provider';

import './index.css';

setLang(readLang());
trackPageview();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </ErrorBoundary>,
);

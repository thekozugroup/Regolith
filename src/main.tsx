import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { applyStoredAccent } from './lib/useTheme'
import { installErrorReporter } from './lib/errorReporter'

// Apply the persisted user accent before first paint so it takes effect on
// every route and survives reloads (not only while Settings is mounted).
applyStoredAccent()

// Installed before render so a rejection thrown during boot is still seen.
installErrorReporter()

// Last-resort boundary. The chrome and the route each have their own, so
// reaching this one means the router or a shell-level hook failed — the only
// remaining failure that could otherwise render a blank page.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouteErrorBoundary>
      <App />
    </RouteErrorBoundary>
  </StrictMode>,
)

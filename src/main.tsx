import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredAccent } from './lib/useTheme'

// Apply the persisted user accent before first paint so it takes effect on
// every route and survives reloads (not only while Settings is mounted).
applyStoredAccent()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

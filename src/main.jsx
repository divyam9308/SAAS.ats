import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { installApiFetchInterceptor } from './services/apiClient'
import { applyCompanyBranding } from './config/companyConfig'
import { isLocalDemo } from './services/supabaseClient'

installApiFetchInterceptor()
applyCompanyBranding()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      {!isLocalDemo && import.meta.env.VITE_PLATFORM_MODE !== 'true' && <SpeedInsights />}
    </AppErrorBoundary>
  </StrictMode>,
)

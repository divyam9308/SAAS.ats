import { Navigate } from 'react-router-dom'
import { moduleEnabled } from '../config/companyConfig'

export default function ModuleGuard({ module, children, fallback = '/dashboard' }) {
  return moduleEnabled(module) ? children : <Navigate to={fallback} replace />
}


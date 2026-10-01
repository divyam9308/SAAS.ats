import { Navigate } from 'react-router-dom'
import { AtsLoader } from './AtsLoader'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { usePageViewPermissions } from '../hooks/usePageViewPermissions'

export default function PageViewGuard({ pageKey, children }) {
  const { isAdmin, isSuperAdmin, loading: roleLoading } = useAdminAccess({ loadPermissions: false })
  const pages = usePageViewPermissions({ isAdmin, isSuperAdmin })
  if (roleLoading || pages.loading) return <div className="route-loading"><AtsLoader size={84} label="Loading..." /></div>
  if (pages.canView(pageKey)) return children
  return <Navigate to={pages.firstPermittedRoute(pageKey)} replace />
}


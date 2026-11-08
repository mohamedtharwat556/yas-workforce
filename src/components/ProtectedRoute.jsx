import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// يحمي المسارات: يتأكد من تسجيل الدخول + تفعيل الحساب + الدور
export default function ProtectedRoute({ children, roles }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="p-10 text-center text-slate-500">جاري التحميل…</div>
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (!profile) {
    return <div className="p-10 text-center text-slate-500">جاري تجهيز الحساب…</div>
  }
  if (profile.status !== 'active') {
    return <Navigate to="/pending" replace />
  }
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to="/" replace />
  }
  return children
}

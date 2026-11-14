import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { supabaseConfigured } from './lib/supabase'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Pending from './pages/Pending'

// تحميل مؤجّل للصفحات التقيلة (رسوم/مشرف/حسابات) عشان الموبايل يحمّل اللي محتاجه بس
const SupervisorDashboard = lazy(() => import('./pages/SupervisorDashboard'))
const AccountantDashboard = lazy(() => import('./pages/AccountantDashboard'))
const EmployeeNames = lazy(() => import('./pages/EmployeeNames'))
const Productivity = lazy(() => import('./pages/Productivity'))
const StagesManage = lazy(() => import('./pages/StagesManage'))
const ManagementDashboard = lazy(() => import('./pages/ManagementDashboard'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))

// يوجّه المستخدم للشاشة الصح حسب الدور — مفيش دور «موظف» بعد كده
function HomeRedirect() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="p-10 text-center text-slate-500">جاري التحميل…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <div className="p-10 text-center text-slate-500">جاري تجهيز الحساب…</div>
  if (profile.status !== 'active') return <Navigate to="/pending" replace />
  if (profile.role === 'supervisor') return <Navigate to="/supervisor" replace />
  if (profile.role === 'accountant') return <Navigate to="/accountant" replace />
  return <Navigate to="/login" replace />
}

// مكوّن تحميل بسيط يبان أثناء تحميل صفحة مؤجّلة
function PageLoader() {
  return <div className="p-10 text-center text-slate-500">جاري التحميل…</div>
}

export default function App() {
  return (
    <>
      {!supabaseConfigured && (
        <div className="bg-amber-100 text-amber-900 text-center text-sm py-2 px-4">
          إعدادات Supabase غير مكتملة — انسخ <code>.env.example</code> إلى <code>.env</code> وضع
          VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY.
        </div>
      )}
      <Suspense fallback={<PageLoader />}>
        <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/pending" element={<Pending />} />

        <Route
          path="/supervisor"
          element={
            <ProtectedRoute roles={['supervisor', 'accountant']}>
              <SupervisorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accountant"
          element={
            <ProtectedRoute roles={['accountant']}>
              <AccountantDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervisor/employees"
          element={
            <ProtectedRoute roles={['supervisor']}>
              <EmployeeNames />
            </ProtectedRoute>
          }
        />
        <Route
          path="/management"
          element={
            <ProtectedRoute roles={['accountant']}>
              <ManagementDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervisor/stages"
          element={
            <ProtectedRoute roles={['supervisor']}>
              <StagesManage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervisor/productivity"
          element={
            <ProtectedRoute roles={['supervisor']}>
              <Productivity />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute roles={['supervisor', 'accountant']}>
              <AuditLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/password"
          element={
            <ProtectedRoute roles={['supervisor', 'accountant']}>
              <ChangePassword />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

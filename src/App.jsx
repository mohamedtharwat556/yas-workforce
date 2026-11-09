import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { supabaseConfigured } from './lib/supabase'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Pending from './pages/Pending'
import WorkerDashboard from './pages/WorkerDashboard'

// تحميل مؤجّل للصفحات التقيلة (رسوم/مشرف/حسابات) عشان الموبايل يحمّل اللي محتاجه بس
const WorkerIncentives = lazy(() => import('./pages/WorkerIncentives'))
const SupervisorDashboard = lazy(() => import('./pages/SupervisorDashboard'))
const AccountantDashboard = lazy(() => import('./pages/AccountantDashboard'))
const EmployeeAccounts = lazy(() => import('./pages/EmployeeAccounts'))
const LaptopJourney = lazy(() => import('./pages/LaptopJourney'))
const ManagementDashboard = lazy(() => import('./pages/ManagementDashboard'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const LaptopQR = lazy(() => import('./pages/LaptopQR'))
const ScanLanding = lazy(() => import('./pages/ScanLanding'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))

// يوجّه المستخدم للشاشة الصح حسب الدور
function HomeRedirect() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="p-10 text-center text-slate-500">جاري التحميل…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <div className="p-10 text-center text-slate-500">جاري تجهيز الحساب…</div>
  if (profile.status !== 'active') return <Navigate to="/pending" replace />
  if (profile.role === 'supervisor') return <Navigate to="/supervisor" replace />
  if (profile.role === 'accountant') return <Navigate to="/accountant" replace />
  if (profile.role === 'management') return <Navigate to="/management" replace />
  return <Navigate to="/worker" replace />
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
          path="/worker"
          element={
            <ProtectedRoute roles={['worker', 'supervisor']}>
              <WorkerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/incentives"
          element={
            <ProtectedRoute roles={['worker', 'supervisor']}>
              <WorkerIncentives />
            </ProtectedRoute>
          }
        />
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
            <ProtectedRoute roles={['accountant', 'management']}>
              <AccountantDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervisor/accounts"
          element={
            <ProtectedRoute roles={['supervisor', 'accountant']}>
              <EmployeeAccounts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laptops"
          element={
            <ProtectedRoute roles={['worker', 'supervisor', 'accountant', 'management']}>
              <LaptopJourney />
            </ProtectedRoute>
          }
        />
        <Route
          path="/management"
          element={
            <ProtectedRoute roles={['management']}>
              <ManagementDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute roles={['supervisor', 'accountant', 'management']}>
              <AuditLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laptops/labels"
          element={
            <ProtectedRoute roles={['worker', 'supervisor', 'accountant', 'management']}>
              <LaptopQR />
            </ProtectedRoute>
          }
        />
        <Route
          path="/l/:token"
          element={
            <ProtectedRoute roles={['worker', 'supervisor', 'accountant', 'management']}>
              <ScanLanding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/password"
          element={
            <ProtectedRoute roles={['worker', 'supervisor', 'accountant', 'management']}>
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

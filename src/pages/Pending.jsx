import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Pending() {
  const { profile, signOut, session } = useAuth()

  if (!session) return <Navigate to="/login" replace />
  if (profile?.status === 'active') return <Navigate to="/" replace />

  const rejected = profile?.status === 'rejected'
  const inactive = profile?.status === 'inactive'

  return (
    <div className="flex min-h-[100dvh] items-start justify-center p-4 pt-10 sm:items-center sm:pt-4">
      <div className="card w-full max-w-md text-center space-y-4">
        <h1 className="text-xl font-bold">
          {rejected ? 'تم رفض الحساب' : inactive ? 'الحساب موقوف' : 'حسابك في انتظار الموافقة'}
        </h1>
        <p className="text-slate-600 text-sm">
          {rejected
            ? 'حسابك اترفض من المشرف. لو في مشكلة تواصل معاه.'
            : inactive
              ? 'حسابك موقوف حاليًا. تواصل مع المشرف عشان يرجّعه.'
              : `أهلاً ${profile?.full_name || ''}! حسابك قيد المراجعة من المشرف. بمجرد الموافقة هتقدر تدخل وتدخل إنتاجك اليومي.`}
        </p>
        <button onClick={signOut} className="btn-ghost w-full">
          خروج
        </button>
      </div>
    </div>
  )
}

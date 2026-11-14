import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// أدوار الدخول (بتختار الدور بس، وبعدها تكتب الإيميل والباسورد)
const ROLES = [
  { key: 'supervisor', label: 'مشرف' },
  { key: 'accountant', label: 'حسابات' },
]

function EyeIcon({ off }) {
  return off ? (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2" />
      <path d="M6.7 6.7C4.3 8.2 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1" />
      <path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-2.3 3.2" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const roleLabel = ROLES.find((r) => r.key === role)?.label

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) {
      const msg = error.message || ''
      setError(
        msg.toLowerCase().includes('invalid login credentials')
          ? 'الإيميل أو الباسورد غلط.'
          : `تعذّر الدخول: ${msg}`
      )
      return
    }
    navigate(from || '/', { replace: true })
  }

  return (
    <div className="flex min-h-[100dvh] items-start justify-center p-4 pt-10 sm:items-center sm:pt-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-blue-800">YAS Workforce</h1>
          <p className="text-slate-500 text-sm mt-1">
            {roleLabel ? `الدخول كـ ${roleLabel}` : 'سجّل دخولك لمتابعة إنتاجيتك'}
          </p>
        </div>

        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

        <div>
          <label className="label">الإيميل</label>
          <input
            type="email"
            required
            className="input"
            dir="ltr"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@yas.com"
          />
        </div>
        <div>
          <label className="label">الباسورد</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              className="input"
              dir="ltr"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              style={{ paddingRight: '2.6rem' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2 flex items-center px-1 text-slate-400 hover:text-slate-700"
              aria-label={showPassword ? 'إخفاء الباسورد' : 'إظهار الباسورد'}
              title={showPassword ? 'إخفاء الباسورد' : 'إظهار الباسورد'}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'جاري الدخول…' : 'دخول'}
        </button>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-400 text-center mb-2">اختر نوع الدخول</p>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRole(r.key)}
                className={`btn-ghost text-sm !px-2 ${role === r.key ? '!border-blue-500 !bg-blue-50 !text-blue-700' : ''}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {roleLabel && (
            <p className="text-xs text-slate-400 text-center mt-2">
              اكتب الإيميل والباسورد بتاع حساب {roleLabel} واضغط دخول.
            </p>
          )}
        </div>
      </form>
    </div>
  )
}

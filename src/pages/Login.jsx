import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// دخول سريع للتجربة (يظهر في وضع التطوير فقط)
const DEMO = [
  { label: 'مشرف', email: 'supervisor@yas.com', password: 'yas1234' },
  { label: 'عامل', email: 'salma@yas.local', password: 'yas1234' },
]

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function quickLogin(demo) {
    setError('')
    setBusy(true)
    const { error } = await signIn(demo.email, demo.password)
    setBusy(false)
    if (error) {
      setError(`تعذّر الدخول: ${error.message}`)
      return
    }
    navigate(from || '/', { replace: true })
  }

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
          <p className="text-slate-500 text-sm mt-1">سجّل دخولك لمتابعة إنتاجيتك</p>
        </div>

        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

        <div>
          <label className="label">الإيميل</label>
          <input
            type="email"
            required
            className="input"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@yas.com"
          />
        </div>
        <div>
          <label className="label">الباسورد</label>
          <input
            type="password"
            required
            className="input"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
          />
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'جاري الدخول…' : 'دخول'}
        </button>

        {import.meta.env.DEV && (
          <div className="border-t border-slate-200 pt-4">
            <p className="text-xs text-slate-400 text-center mb-2">دخول سريع للتجربة (بضغطة واحدة)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  disabled={busy}
                  onClick={() => quickLogin(d)}
                  className="btn-ghost text-sm !px-2"
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  )
}

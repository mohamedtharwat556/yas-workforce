import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../context/AuthContext'

export default function ChangePassword() {
  const { changePassword, profile } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setOk(false)
    if (password.length < 6) {
      setError('كلمة المرور لازم 6 حروف على الأقل.')
      return
    }
    if (password !== confirm) {
      setError('كلمة المرور وتأكيدها مش متطابقين.')
      return
    }
    setBusy(true)
    const { error } = await changePassword(password)
    setBusy(false)
    if (error) {
      setError(`تعذّر تغيير كلمة المرور: ${error.message}`)
      return
    }
    setPassword('')
    setConfirm('')
    setOk(true)
  }

  return (
    <Layout title="كلمة المرور">
      <div className="mx-auto max-w-sm">
        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <h1 className="text-lg font-bold">تغيير كلمة المرور</h1>
            <p className="mt-1 text-sm text-slate-500">
              الحساب: <span className="font-mono" dir="ltr">{profile?.email}</span>
            </p>
          </div>

          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {ok && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              تم تغيير كلمة المرور بنجاح ✅
            </div>
          )}

          <div>
            <label className="label">كلمة المرور الجديدة</label>
            <input
              type="password"
              required
              className="input"
              dir="ltr"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
            />
          </div>
          <div>
            <label className="label">تأكيد كلمة المرور</label>
            <input
              type="password"
              required
              className="input"
              dir="ltr"
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••"
            />
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'جاري الحفظ…' : 'حفظ'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-ghost w-full">
            رجوع
          </button>
        </form>
      </div>
    </Layout>
  )
}

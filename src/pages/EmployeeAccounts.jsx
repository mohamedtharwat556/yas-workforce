import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { buildPassword, buildUsername, emailFor } from '../lib/translit'
import { formatDate } from '../lib/dates'

const ROLE_LABEL = { worker: 'عامل', supervisor: 'مشرف', accountant: 'حسابات', management: 'إدارة' }
const ROLE_OPTIONS = [
  { value: 'worker', label: 'عامل' },
  { value: 'supervisor', label: 'مشرف' },
  { value: 'accountant', label: 'حسابات' },
  { value: 'management', label: 'إدارة' },
]

export default function EmployeeAccounts() {
  const { profile } = useAuth()
  // الأدمن (الحسابات) بس اللي يقدر ينشئ أدوار الحسابات/الإدارة
  const roleOptions = profile?.role === 'accountant' ? ROLE_OPTIONS : ROLE_OPTIONS.slice(0, 2)
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('worker')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [created, setCreated] = useState(null)
  const [filter, setFilter] = useState('')

  const takenUsernames = useMemo(
    () => profiles.map((p) => String(p.email ?? '').split('@')[0]).filter(Boolean),
    [profiles]
  )

  async function loadProfiles() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, status, created_at')
      .order('created_at', { ascending: false })
    if (error) setMsg({ type: 'error', text: error.message })
    setProfiles(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  // توليد اسم المستخدم تلقائيًا من الاسم (لحد ما المستخدم يعدّله بنفسه)
  useEffect(() => {
    if (usernameTouched) return
    setUsername(name.trim() ? buildUsername(name, takenUsernames) : '')
  }, [name, profiles])

  // توليد الباسورد تلقائيًا: yas + آخر 4 أرقام من الموبايل
  useEffect(() => {
    if (passwordTouched) return
    setPassword(phone.replace(/\D/g, '').length >= 4 ? buildPassword(phone) : '')
  }, [phone])

  const email = useMemo(() => (username.trim() ? emailFor(username) : ''), [username])
  const isExisting = takenUsernames.includes(username.trim().toLowerCase())

  function resetForm() {
    setName('')
    setPhone('')
    setRole('worker')
    setUsername('')
    setPassword('')
    setUsernameTouched(false)
    setPasswordTouched(false)
    setMsg(null)
    setCreated(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)
    setCreated(null)
    if (!name.trim()) return setMsg({ type: 'error', text: 'اكتب اسم الموظف.' })
    if (!username.trim()) return setMsg({ type: 'error', text: 'اسم المستخدم مطلوب.' })
    if (!/^[a-z0-9.]+$/.test(username.trim())) {
      return setMsg({ type: 'error', text: 'اسم المستخدم لازم حروف إنجليزي صغيرة وأرقام ونقط بس.' })
    }
    if (password.length < 6) return setMsg({ type: 'error', text: 'الباسورد لازم 6 حروف على الأقل.' })

    setBusy(true)
    const { error } = await supabase.rpc('admin_create_user', {
      p_email: email,
      p_password: password,
      p_full_name: name.trim(),
      p_role: role,
    })
    setBusy(false)

    if (error) {
      const m = error.message || ''
      setMsg({
        type: 'error',
        text: m.includes('غير مسموح')
          ? 'مش مسموح لك بإنشاء حسابات.'
          : m.includes('duplicate')
            ? 'الإيميل ده مستخدم بالفعل.'
            : `تعذّر الحفظ: ${m}`,
      })
      return
    }

    setCreated({ name: name.trim(), email, password, role })
    setMsg({
      type: 'ok',
      text: isExisting ? 'تم تحديث الحساب والباسورد.' : 'تم إنشاء الحساب بنجاح.',
    })
    await loadProfiles()
  }

  function copy(text, label = 'تم النسخ') {
    navigator.clipboard?.writeText(text).then(
      () => setMsg({ type: 'ok', text: label }),
      () => {}
    )
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(
      (p) => p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
    )
  }, [profiles, filter])

  const shareText = created
    ? `بيانات دخولك على تطبيق YAS Workforce:\nاسم المستخدم: ${created.email}\nالباسورد: ${created.password}`
    : ''

  return (
    <Layout title="إدارة الحسابات">
      <div className="grid gap-6 lg:grid-cols-5">
        {/* نموذج الإنشاء */}
        <form onSubmit={handleSubmit} className="card lg:col-span-2 space-y-4 h-fit order-1 lg:order-none">
          <div>
            <h2 className="font-bold text-lg">حساب جديد</h2>
            <p className="text-xs text-slate-500 mt-1">
              اكتب اسم الموظف، والنظام هيولّدله اسم مستخدم وباسورد. لو الاسم موجود بالفعل، الباسورد
              هيتحدّث (إعادة تعيين).
            </p>
          </div>

          {msg && (
            <div className={`text-sm rounded-lg p-3 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {msg.text}
            </div>
          )}

          {created && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2 text-sm">
              <p className="font-medium text-emerald-800">بيانات الدخول جاهزة</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">اسم المستخدم</span>
                <span className="font-mono" dir="ltr">{created.email}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">الباسورد</span>
                <span className="font-mono" dir="ltr">{created.password}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => copy(`اسم المستخدم: ${created.email}\nالباسورد: ${created.password}`)}
                  className="btn-ghost flex-1 !py-2 text-xs"
                >
                  نسخ البيانات
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost flex-1 !py-2 text-center text-xs"
                >
                  إرسال واتساب
                </a>
              </div>
            </div>
          )}

          <div>
            <label className="label">الاسم بالكامل</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="محمد أحمد"
            />
          </div>

          <div>
            <label className="label">رقم الموبايل (لتوليد الباسورد)</label>
            <input
              className="input"
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01012345678"
            />
          </div>

          <div>
            <label className="label">الدور</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">اسم المستخدم (قابل للتعديل)</label>
            <input
              className="input font-mono"
              dir="ltr"
              value={username}
              onChange={(e) => {
                setUsernameTouched(true)
                setUsername(e.target.value.toLowerCase())
              }}
              placeholder="mohamed.ahmed"
            />
            <p className="text-xs text-slate-400 mt-1" dir="ltr">
              {email || '—'}
            </p>
            {isExisting && (
              <p className="text-xs text-amber-600 mt-1">
                الاسم ده مستخدم بالفعل — هيتم تحديث باسورد الموظف.
              </p>
            )}
          </div>

          <div>
            <label className="label">الباسورد (قابل للتعديل)</label>
            <input
              className="input font-mono"
              dir="ltr"
              value={password}
              onChange={(e) => {
                setPasswordTouched(true)
                setPassword(e.target.value)
              }}
              placeholder="yas1234"
            />
            <p className="text-xs text-slate-400 mt-1">الافتراضي: yas + آخر 4 أرقام من الموبايل.</p>
          </div>

          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'جاري الحفظ…' : isExisting ? 'تحديث الحساب' : 'إنشاء الحساب'}
          </button>

          {(name || phone || created) && (
            <button type="button" onClick={resetForm} className="btn-ghost w-full">
              مسح النموذج
            </button>
          )}
        </form>

        {/* قائمة الحسابات */}
        <div className="card lg:col-span-3 order-2 lg:order-none">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-lg">الحسابات ({profiles.length})</h2>
            <input
              className="input w-full sm:w-56"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ابحث بالاسم أو الإيميل…"
            />
          </div>

          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>اسم المستخدم</th>
                  <th>الدور</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">
                      جاري التحميل…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">
                      مفيش حسابات
                    </td>
                  </tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td data-label="الاسم">
                      <div>{p.full_name}</div>
                      <div className="text-xs text-slate-400">{formatDate(p.created_at)}</div>
                    </td>
                    <td data-label="اسم المستخدم">
                      <span className="font-mono text-xs" dir="ltr">
                        {String(p.email ?? '').split('@')[0]}
                      </span>
                    </td>
                    <td data-label="الدور">{ROLE_LABEL[p.role] ?? p.role}</td>
                    <td data-label="الحالة">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : p.status === 'pending'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.status === 'active'
                          ? 'نشط'
                          : p.status === 'pending'
                            ? 'في الانتظار'
                            : p.status === 'inactive'
                              ? 'موقوف'
                              : 'مرفوض'}
                      </span>
                    </td>
                    <td data-label="إجراء">
                      <button
                        type="button"
                        onClick={() => {
                          const u = String(p.email ?? '').split('@')[0]
                          setUsername(u)
                          setUsernameTouched(true)
                          setName(p.full_name ?? '')
                          setRole(p.role ?? 'worker')
                          setPasswordTouched(false)
                          setPhone('')
                          setPassword('')
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        className="btn-ghost !py-1 !px-2 text-xs"
                      >
                        إعادة تعيين
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}

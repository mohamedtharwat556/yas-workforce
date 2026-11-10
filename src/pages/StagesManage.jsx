import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'

// بنولّد كود إنجليزي من الاسم الإنجليزي (حروف صغيرة وأندر سكور)
function slugify(v) {
  return (v || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function emptyForm(sortOrder) {
  return {
    code: '',
    name_ar: '',
    name_en: '',
    sort_order: sortOrder ?? 100,
    is_mandatory: false,
    is_destination: true,
    active: true,
  }
}

export default function StagesManage() {
  const [stages, setStages] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // كود المرحلة اللي بنعدّلها
  const [form, setForm] = useState(emptyForm())
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('stages').select('*').order('sort_order')
    setStages(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // الرقم اللي نبدأ بيه الترتيب للمرحلة الجديدة
  const nextOrder = useMemo(
    () => stages.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0) + 1,
    [stages]
  )

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function startAdd() {
    setEditing(null)
    setForm(emptyForm(nextOrder))
    setMsg(null)
  }

  function startEdit(s) {
    setEditing(s.code)
    setForm({
      code: s.code,
      name_ar: s.name_ar ?? '',
      name_en: s.name_en ?? '',
      sort_order: s.sort_order ?? 0,
      is_mandatory: Boolean(s.is_mandatory),
      is_destination: Boolean(s.is_destination),
      active: Boolean(s.active),
    })
    setMsg(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditing(null)
    setForm(emptyForm(nextOrder))
    setMsg(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)

    const nameAr = form.name_ar.trim()
    if (!nameAr) return setMsg({ type: 'error', text: 'اكتب اسم المرحلة/الوجهة بالعربي.' })

    const code = editing ?? (form.code.trim() || slugify(form.name_en || nameAr))
    if (!code) {
      return setMsg({ type: 'error', text: 'اكتب كود إنجليزي للمرحلة (حروف/أرقام بس).' })
    }

    setBusy(true)
    const payload = {
      code,
      name_ar: nameAr,
      name_en: (form.name_en.trim() || nameAr),
      sort_order: Number(form.sort_order) || 0,
      is_mandatory: Boolean(form.is_mandatory),
      is_destination: Boolean(form.is_destination),
      active: Boolean(form.active),
    }

    const { error } = editing
      ? await supabase.from('stages').update(payload).eq('code', editing)
      : await supabase.from('stages').insert(payload)

    setBusy(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: editing ? 'تم تعديل المرحلة.' : 'تمت إضافة المرحلة.' })
    setEditing(null)
    setForm(emptyForm())
    load()
  }

  // تفعيل/إيقاف مرحلة (الموقوفة متظهرش للموظف في اختيار وجهته)
  async function toggleActive(s) {
    setMsg(null)
    setBusyId(s.code)
    const { error } = await supabase.from('stages').update({ active: !s.active }).eq('code', s.code)
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    load()
  }

  return (
    <Layout title="الوجهات والمراحل">
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={handleSubmit} className="card lg:col-span-2 space-y-4 h-fit">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-lg">{editing ? 'تعديل مرحلة' : 'إضافة مرحلة / وجهة'}</h2>
            {editing && (
              <button type="button" onClick={cancelEdit} className="text-xs underline">
                إلغاء التعديل
              </button>
            )}
          </div>

          {msg && (
            <div className={`text-sm rounded-lg p-3 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {msg.text}
            </div>
          )}

          <div>
            <label className="label">الاسم بالعربي</label>
            <input
              className="input"
              value={form.name_ar}
              onChange={(e) => update('name_ar', e.target.value)}
              placeholder="مثال: الشاشات"
            />
          </div>

          <div>
            <label className="label">الاسم بالإنجليزي</label>
            <input
              className="input"
              dir="ltr"
              value={form.name_en}
              onChange={(e) => update('name_en', e.target.value)}
              placeholder="screens"
            />
          </div>

          <div>
            <label className="label">الكود (إنجليزي — مش بيتغير بعد الإضافة)</label>
            <input
              className="input"
              dir="ltr"
              value={form.code}
              onChange={(e) => update('code', e.target.value)}
              disabled={Boolean(editing)}
              placeholder="screens"
            />
            {!editing && <p className="mt-1 text-xs text-slate-400">لو سيبته فاضي بنولّده تلقائيًا من الاسم الإنجليزي.</p>}
          </div>

          <div>
            <label className="label">الترتيب</label>
            <input
              type="number"
              className="input"
              value={form.sort_order}
              onChange={(e) => update('sort_order', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_destination}
                onChange={(e) => update('is_destination', e.target.checked)}
              />
              وجهة صيانة (تظهر للموظف لما يحدّد «فيه مشكلة»)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_mandatory}
                onChange={(e) => update('is_mandatory', e.target.checked)}
              />
              مرحلة إلزامية في مسار اللاب (لازم تتسجّل قبل الإصدار)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => update('active', e.target.checked)} />
              مفعّلة
            </label>
          </div>

          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'جاري الحفظ…' : editing ? 'حفظ التعديل' : 'إضافة'}
          </button>
        </form>

        <div className="card lg:col-span-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-bold text-lg">المراحل والوجهات</h2>
            <button onClick={startAdd} className="btn-ghost !py-1 !px-3 text-xs">
              + إضافة جديدة
            </button>
          </div>
          <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            الوجهات المفعّلة هي اللي بتظهر للموظف وهو بيسجّل مشكلة اللاب. لو أوقفت مرحلة، مش هتظهر للاختيار الجديد.
          </p>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>الترتيب</th>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>النوع</th>
                  <th>إلزامي</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-6">
                      جاري التحميل…
                    </td>
                  </tr>
                )}
                {!loading && stages.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-6">
                      مفيش مراحل مسجّلة
                    </td>
                  </tr>
                )}
                {stages.map((s) => (
                  <tr key={s.code} className={editing === s.code ? 'bg-blue-50' : ''}>
                    <td data-label="الترتيب">{s.sort_order}</td>
                    <td data-label="الاسم">{s.name_ar}</td>
                    <td data-label="الكود" dir="ltr" className="text-left font-mono text-sm">
                      {s.code}
                    </td>
                    <td data-label="النوع">
                      {s.is_destination ? (
                        <span className="badge bg-amber-100 text-amber-800">وجهة صيانة</span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-600">مرحلة مسار</span>
                      )}
                    </td>
                    <td data-label="إلزامي">{s.is_mandatory ? 'نعم' : 'لا'}</td>
                    <td data-label="الحالة">
                      {s.active ? (
                        <span className="badge bg-emerald-100 text-emerald-700">مفعّلة</span>
                      ) : (
                        <span className="badge bg-slate-200 text-slate-600">موقوفة</span>
                      )}
                    </td>
                    <td data-label="إجراء">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => startEdit(s)} className="btn-ghost !py-1 !px-2 text-xs">
                          تعديل
                        </button>
                        <button
                          onClick={() => toggleActive(s)}
                          disabled={busyId === s.code}
                          className="btn-ghost !py-1 !px-2 text-xs"
                        >
                          {busyId === s.code ? '…' : s.active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      </div>
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

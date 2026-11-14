import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { formatDate, toISODate } from '../lib/dates'
import { exportXlsx } from '../lib/xlsx'

// إدارة أسماء الموظفين — أسماء بس، من غير أي إيميل أو باسورد.
// المشرف هو اللي بيسجّل الإنتاج، فالموظف بقى مجرّد اسم بيتربط بيه الإنتاج.
export default function EmployeeNames() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState(null)
  const [filter, setFilter] = useState('')

  async function loadEmployees() {
    setLoading(true)
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, active, sort_order, created_at')
      .order('sort_order')
      .order('full_name')
    if (error) setMsg({ type: 'error', text: error.message })
    setEmployees(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadEmployees()
  }, [])

  function resetForm() {
    setName('')
    setEditingId(null)
    setMsg(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)
    const full_name = name.trim()
    if (!full_name) return setMsg({ type: 'error', text: 'اكتب اسم الموظف.' })

    setBusy(true)
    if (editingId) {
      const { error } = await supabase.from('employees').update({ full_name }).eq('id', editingId)
      setBusy(false)
      if (error) return setMsg({ type: 'error', text: error.message })
      setMsg({ type: 'ok', text: 'تم تعديل اسم الموظف.' })
    } else {
      const nextSort = employees.reduce((m, x) => Math.max(m, x.sort_order ?? 0), 0) + 1
      const { error } = await supabase.from('employees').insert({ full_name, active: true, sort_order: nextSort })
      setBusy(false)
      if (error) return setMsg({ type: 'error', text: error.message })
      setMsg({ type: 'ok', text: 'تم إضافة الموظف.' })
    }
    resetForm()
    loadEmployees()
  }

  async function toggleActive(emp) {
    setBusyId(emp.id)
    setMsg(null)
    const { error } = await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    setBusyId(null)
    if (error) return setMsg({ type: 'error', text: error.message })
    setMsg({ type: 'ok', text: emp.active ? 'تم إيقاف الموظف.' : 'تم تفعيل الموظف.' })
    loadEmployees()
  }

  async function removeEmployee(emp) {
    if (!window.confirm(`تحذير: هيتحذف «${emp.full_name}» نهائيًا. متأكد؟`)) return
    setBusyId(emp.id)
    setMsg(null)
    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    setBusyId(null)
    if (error) {
      return setMsg({
        type: 'error',
        text: error.message.includes('foreign key')
          ? 'مش ممكن نحذف الموظف ده — فيه إدخالات إنتاج مسجّلة عليه. أوقفه بدل الحذف.'
          : error.message,
      })
    }
    setMsg({ type: 'ok', text: 'تم حذف الموظف.' })
    loadEmployees()
  }

  function startEdit(emp) {
    setEditingId(emp.id)
    setName(emp.full_name ?? '')
    setMsg(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function exportExcel() {
    exportXlsx({
      filename: `yas-employees_${toISODate(new Date())}.xlsx`,
      sheetName: 'أسماء الموظفين',
      headers: ['#', 'الاسم', 'الحالة', 'تاريخ الإضافة'],
      rows: employees.map((e, i) => [i + 1, e.full_name, e.active ? 'نشط' : 'موقوف', formatDate(e.created_at)]),
    })
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) => e.full_name?.toLowerCase().includes(q))
  }, [employees, filter])

  const activeCount = employees.filter((e) => e.active).length

  return (
    <Layout title="أسماء الموظفين">
      <div className="grid gap-6 lg:grid-cols-5">
        {/* نموذج الإضافة/التعديل */}
        <form onSubmit={handleSubmit} className="card lg:col-span-2 space-y-4 h-fit order-1 lg:order-none">
          <div>
            <h2 className="font-bold text-lg">{editingId ? 'تعديل اسم موظف' : 'إضافة موظف جديد'}</h2>
            <p className="text-xs text-slate-500 mt-1">
              اكتب اسم الموظف بس — مفيش إيميل ولا باسورد، المشرف هو اللي بيسجّل الإنتاج باسمه.
            </p>
          </div>

          {msg && (
            <div className={`text-sm rounded-lg p-3 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {msg.text}
            </div>
          )}

          <div>
            <label className="label">اسم الموظف بالكامل</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="محمد أحمد"
              autoFocus
            />
          </div>

          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'جاري الحفظ…' : editingId ? 'حفظ التعديل' : 'إضافة الموظف'}
          </button>

          {(name || editingId) && (
            <button type="button" onClick={resetForm} className="btn-ghost w-full">
              {editingId ? 'إلغاء التعديل' : 'مسح'}
            </button>
          )}
        </form>

        {/* قائمة الموظفين */}
        <div className="card lg:col-span-3 order-2 lg:order-none">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-lg">الموظفون ({employees.length})</h2>
              <p className="text-xs text-slate-500 mt-0.5">{activeCount} موظف نشط</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input w-full sm:w-48"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="ابحث بالاسم…"
              />
              <button onClick={exportExcel} disabled={employees.length === 0} className="btn-ghost !py-1.5 text-sm">
                تصدير Excel
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الاسم</th>
                  <th>الحالة</th>
                  <th>تاريخ الإضافة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">
                      {filter ? 'مفيش نتائج للبحث' : 'مفيش موظفين — ضيف أول موظف من الفورم.'}
                    </td>
                  </tr>
                )}
                {filtered.map((emp, i) => (
                  <tr key={emp.id}>
                    <td data-label="#" className="text-slate-400">{i + 1}</td>
                    <td data-label="الاسم">{emp.full_name}</td>
                    <td data-label="الحالة">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          emp.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {emp.active ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td data-label="تاريخ الإضافة">{formatDate(emp.created_at)}</td>
                    <td data-label="إجراء">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => startEdit(emp)} className="btn-ghost !py-1 !px-2 text-xs">
                          تعديل
                        </button>
                        <button
                          disabled={busyId === emp.id}
                          onClick={() => toggleActive(emp)}
                          className={`${emp.active ? 'btn-danger' : 'btn-accent'} !py-1 !px-3 text-xs`}
                        >
                          {emp.active ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button
                          disabled={busyId === emp.id}
                          onClick={() => removeEmployee(emp)}
                          className="btn-ghost !py-1 !px-2 text-xs text-red-600"
                        >
                          حذف
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

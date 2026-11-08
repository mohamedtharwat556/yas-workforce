import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import EntryDetails from '../components/EntryDetails'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  entryOperationNames,
  entryTotalQty,
  formatDate,
  formatNumber,
  startOfMonth,
  startOfWeek,
  toISODate,
  weightedUnits,
} from '../lib/dates'
import { compressImage } from '../lib/image'

// بنفتكر اتجاه السيريال اللي اختاره العامل عشان نسرّع الإدخال عليه
const LAST_KEY = 'yas:lastEntry'

function readLast() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || '{}')
    return { direction: v.direction === 'in' ? 'in' : 'out' }
  } catch {
    return { direction: 'out' }
  }
}

function emptyForm(overrides = {}) {
  const last = readLast()
  return {
    // بنود الإدخال: كل بند = نوع عملية + عدد (ممكن يكونوا أكتر من واحد)
    lines: [],
    entry_date: toISODate(new Date()),
    notes: '',
    serials: '',
    direction: last.direction,
    ...overrides,
  }
}

export default function WorkerDashboard() {
  const { user, profile } = useAuth()
  const [operations, setOperations] = useState([])
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState(emptyForm())
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  async function loadOperations() {
    const { data } = await supabase
      .from('operations')
      .select('*')
      .eq('active', true)
      .order('sort_order')
    setOperations(data ?? [])
  }

  async function loadEntries() {
    const { data } = await supabase
      .from('production_entries')
      .select('*, operations(name_ar, name_en, weight), entry_operations(operation_id, quantity, operations(name_ar, weight))')
      .eq('worker_id', user.id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setEntries(data ?? [])
  }

  useEffect(() => {
    if (!user) return
    loadOperations()
    loadEntries()
  }, [user])

  const released = useMemo(() => entries.filter((e) => e.status === 'released'), [entries])

  const summary = useMemo(() => {
    const today = toISODate(new Date())
    const weekStart = toISODate(startOfWeek())
    const monthStart = toISODate(startOfMonth())
    const bucket = (from, mode) => {
      const rows = released.filter((e) => (mode === 'day' ? e.entry_date === from : e.entry_date >= from))
      return {
        laps: rows.reduce((s, e) => s + entryTotalQty(e), 0),
        units: weightedUnits(rows),
      }
    }
    return {
      today: bucket(today, 'day'),
      week: bucket(weekStart, 'range'),
      month: bucket(monthStart, 'range'),
    }
  }, [released])

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // بنود الإدخال (اختيار أكتر من عملية)
  function toggleLine(opId, checked) {
    setForm((f) => {
      if (!checked) return { ...f, lines: f.lines.filter((l) => String(l.operation_id) !== String(opId)) }
      if (f.lines.some((l) => String(l.operation_id) === String(opId))) return f
      return { ...f, lines: [...f.lines, { operation_id: String(opId), quantity: '' }] }
    })
  }

  function setLineQty(opId, qty) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (String(l.operation_id) === String(opId) ? { ...l, quantity: qty } : l)),
    }))
  }

  // ضغط الصور المختارة/المصوّرة قبل الإضافة
  async function addFiles(list) {
    const incoming = Array.from(list ?? [])
    if (!incoming.length) return
    setCompressing(true)
    try {
      const out = []
      for (const f of incoming) out.push(await compressImage(f))
      setFiles((prev) => [...prev, ...out])
    } finally {
      setCompressing(false)
    }
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)

    // بنود الإدخال: كل بند لازم عدد صحيح > 0
    const lines = form.lines
      .filter((l) => l.operation_id)
      .map((l) => ({ operation_id: Number(l.operation_id), quantity: Number(l.quantity) }))
    if (!lines.length) return setMsg({ type: 'error', text: 'اختار نوع عملية واحد على الأقل.' })
    if (lines.some((l) => !l.quantity || l.quantity <= 0)) {
      return setMsg({ type: 'error', text: 'اكتب عدد صحيح لكل عملية اخترتها.' })
    }

    const wasEdit = Boolean(editingId)
    setBusy(true)
    try {
      const entryId = editingId ?? crypto.randomUUID()

      // 1) ارفع الصور الجديدة
      const uploaded = []
      for (const file of files) {
        const safe = file.name.replace(/[^\w.\-]+/g, '_')
        const path = `${user.id}/${entryId}/${Date.now()}-${safe}`
        const { error } = await supabase.storage.from('laps').upload(path, file)
        if (error) throw error
        uploaded.push({ storage_path: path, file_type: file.type })
      }

      // الأعمدة القديمة (operation_id/quantity) بنسيبها = أول بند/الإجمالي
      // عشان أي شاشة قديمة تفضل شغالة.
      const base = {
        operation_id: lines[0].operation_id,
        entry_date: form.entry_date,
        quantity: lines.reduce((s, l) => s + l.quantity, 0),
        notes: form.notes || null,
      }

      if (wasEdit) {
        // 2) عدّل الإدخال ورجّعه مسودّة (يمسح الإرجاع السابق)
        const { error: upErr } = await supabase
          .from('production_entries')
          .update({ ...base, status: 'draft', return_reason: null, returned_by: null, returned_at: null })
          .eq('id', entryId)
        if (upErr) throw upErr

        // استبدل السيريالات والبنود بالكامل
        await supabase.from('lap_serials').delete().eq('entry_id', entryId)
        await supabase.from('entry_operations').delete().eq('entry_id', entryId)
      } else {
        // 2) أنشئ الإدخال
        const { error: entryError } = await supabase
          .from('production_entries')
          .insert({ id: entryId, worker_id: user.id, ...base, status: 'draft' })
        if (entryError) throw entryError
      }

      // 2.1) بنود الإدخال (العمليات)
      const { error: linesError } = await supabase
        .from('entry_operations')
        .insert(lines.map((l) => ({ entry_id: entryId, operation_id: l.operation_id, quantity: l.quantity })))
      if (linesError) throw linesError

      // 3) السيريالات
      const serials = form.serials
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (serials.length) {
        const { error } = await supabase.from('lap_serials').insert(
          serials.map((serial) => ({ entry_id: entryId, serial, direction: form.direction }))
        )
        if (error) throw error
      }

      // 4) المرفقات
      if (uploaded.length) {
        const { error } = await supabase
          .from('attachments')
          .insert(uploaded.map((u) => ({ entry_id: entryId, ...u })))
        if (error) throw error
      }

      localStorage.setItem(LAST_KEY, JSON.stringify({ direction: form.direction }))
      setForm(emptyForm({ entry_date: form.entry_date }))
      setFiles([])
      setEditingId(null)
      setMsg({
        type: 'ok',
        text: wasEdit
          ? 'تم تعديل إدخالك وإرساله للمراجعة من جديد.'
          : 'تم تسجيل إدخالك، وهو في انتظار إصدار المشرف.',
      })
      loadEntries()
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'حصل خطأ أثناء الحفظ.' })
    } finally {
      setBusy(false)
    }
  }

  async function startEdit(entry) {
    setMsg(null)
    const [serialsRes, linesRes] = await Promise.all([
      supabase
        .from('lap_serials')
        .select('serial, direction')
        .eq('entry_id', entry.id)
        .order('created_at'),
      supabase
        .from('entry_operations')
        .select('operation_id, quantity')
        .eq('entry_id', entry.id),
    ])
    const serials = serialsRes.data ?? []
    const lines = (linesRes.data ?? []).length
      ? linesRes.data
      : [{ operation_id: entry.operation_id, quantity: entry.quantity }]
    setForm({
      lines: lines.map((l) => ({ operation_id: String(l.operation_id), quantity: String(l.quantity) })),
      entry_date: entry.entry_date,
      notes: entry.notes ?? '',
      serials: serials.map((s) => s.serial).join('\n'),
      direction: serials[0]?.direction ?? 'out',
    })
    setFiles([])
    setEditingId(entry.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setFiles([])
    setForm(emptyForm({ entry_date: form.entry_date }))
  }

  async function removeEntry(entry) {
    if (!window.confirm('متأكد إنك عايز تحذف الإدخال ده؟')) return
    setMsg(null)
    const { data: atts } = await supabase
      .from('attachments')
      .select('storage_path')
      .eq('entry_id', entry.id)
    const { error } = await supabase.from('production_entries').delete().eq('id', entry.id)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    const paths = (atts ?? []).map((a) => a.storage_path)
    if (paths.length) await supabase.storage.from('laps').remove(paths)
    setMsg({ type: 'ok', text: 'تم حذف الإدخال.' })
    loadEntries()
  }

  return (
    <Layout title="إنتاجي اليوم">
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <StatCard label="لابات النهاردة" value={summary.today.laps} sub={`${formatNumber(summary.today.units)} وحدة مرجّحة`} />
        <StatCard label="لابات الأسبوع" value={summary.week.laps} sub={`${formatNumber(summary.week.units)} وحدة مرجّحة`} />
        <StatCard label="لابات الشهر" value={summary.month.laps} sub={`${formatNumber(summary.month.units)} وحدة مرجّحة`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={handleSubmit} className="card lg:col-span-2 space-y-4 h-fit order-1 lg:order-none">
          <h2 className="font-bold text-lg">{editingId ? 'تعديل إدخال' : 'تسجيل إنتاج جديد'}</h2>
          <p className="text-xs text-slate-500">أهلاً {profile?.full_name}، سجّل اللي عملته النهاردة.</p>

          {editingId && (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-orange-50 p-3 text-sm text-orange-800">
              <span>بتعدّل إدخال مُرجّع. بعد الحفظ هيرجع للمشرف للمراجعة من جديد.</span>
              <button type="button" onClick={cancelEdit} className="shrink-0 text-xs underline">
                إلغاء التعديل
              </button>
            </div>
          )}

          {msg && (
            <div className={`text-sm rounded-lg p-3 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {msg.text}
            </div>
          )}

          <div>
            <label className="label">نوع العملية (تقدر تختار أكتر من واحدة)</label>
            <div className="space-y-2">
              {operations.map((o) => {
                const line = form.lines.find((l) => String(l.operation_id) === String(o.id))
                const checked = Boolean(line)
                return (
                  <div
                    key={o.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${checked ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={checked} onChange={(e) => toggleLine(o.id, e.target.checked)} />
                      <span className="text-sm">
                        {o.name_ar} <span className="text-slate-400">(وزن {o.weight})</span>
                      </span>
                    </label>
                    {checked && (
                      <input
                        type="number"
                        min="1"
                        className="input !w-24"
                        placeholder="العدد"
                        value={line.quantity}
                        onChange={(e) => setLineQty(o.id, e.target.value)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-slate-400">حدّد العملية وأكتب عددها — تقدر تحدّد أكتر من عملية في نفس الإدخال.</p>
          </div>

          <div>
            <label className="label">التاريخ</label>
            <input type="date" required className="input" value={form.entry_date} onChange={(e) => update('entry_date', e.target.value)} />
          </div>

          <div>
            <label className="label">السيريالات (كل سيريال في سطر — اختياري)</label>
            <textarea
              className="input font-mono text-sm"
              dir="ltr"
              rows={3}
              value={form.serials}
              onChange={(e) => update('serials', e.target.value)}
              placeholder={'SN-001\nSN-002'}
            />
            <div className="mt-2">
              <label className="label">اتجاه السيريال</label>
              <select className="input" value={form.direction} onChange={(e) => update('direction', e.target.value)}>
                <option value="out">إصدار (خارج)</option>
                <option value="in">استلام (داخل)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">ملاحظات</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="أي تفاصيل أو مشاكل…" />
          </div>

          <div>
            <label className="label">صور (اختياري)</label>
            <div className="flex gap-2">
              <label className="btn-ghost flex-1 cursor-pointer text-center">
                التقاط صورة
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <label className="btn-ghost flex-1 cursor-pointer text-center">
                من المعرض
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">بيتم ضغط الصور أوتوماتيك قبل الرفع.</p>
            {compressing && <p className="text-xs text-slate-500 mt-1">جاري ضغط الصور…</p>}
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate" dir="ltr">
                      {f.name}
                    </span>
                    <span className="shrink-0 text-slate-400">{Math.round(f.size / 1024)}KB</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="shrink-0 text-red-600"
                    >
                      حذف
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'جاري الحفظ…' : 'حفظ الإدخال'}
          </button>
        </form>

        <div className="card lg:col-span-3 order-2 lg:order-none">
          <h2 className="font-bold text-lg mb-3">آخر إدخالاتي</h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>العملية</th>
                  <th>العدد</th>
                  <th>الملاحظة</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-6">
                      مفيش إدخالات لسه
                    </td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(e.id)}>
                    <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                    <td data-label="العملية">{entryOperationNames(e)}</td>
                    <td data-label="العدد">{formatNumber(entryTotalQty(e))}</td>
                    <td data-label="الملاحظة" className="max-w-[200px] truncate" title={e.notes ?? ''}>
                      {e.notes || '-'}
                    </td>
                    <td data-label="الحالة">
                      <StatusBadge status={e.status} />
                      {e.status === 'returned' && e.return_reason && (
                        <p className="mt-1 max-w-[200px] text-xs text-orange-700" title={e.return_reason}>
                          {e.return_reason}
                        </p>
                      )}
                    </td>
                    <td data-label="إجراء" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex gap-2">
                        <button onClick={() => setDetailId(e.id)} className="btn-ghost !py-1 !px-2 text-xs">
                          تفاصيل
                        </button>
                        {(e.status === 'draft' || e.status === 'returned') && (
                          <button onClick={() => startEdit(e)} className="btn-ghost !py-1 !px-2 text-xs">
                            تعديل
                          </button>
                        )}
                        {(e.status === 'draft' || e.status === 'returned') && (
                          <button onClick={() => removeEntry(e)} className="btn-danger !py-1 !px-2 text-xs">
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {detailId && <EntryDetails entryId={detailId} onClose={() => setDetailId(null)} />}
    </Layout>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold mt-1">{formatNumber(value)}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  )
}

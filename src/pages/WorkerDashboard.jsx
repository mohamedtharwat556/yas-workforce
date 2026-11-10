import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import EntryDetails from '../components/EntryDetails'
import SerialScanner, { SCAN_SUPPORTED } from '../components/SerialScanner'
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
} from '../lib/dates'

// أنواع اللابات المتاحة في القائمة المنسدلة
export const LAPTOP_TYPES = [
  'Dell',
  'HP',
  'Lenovo',
  'Apple',
  'Asus',
  'Acer',
  'Toshiba',
  'Samsung',
  'MSI',
  'Fujitsu',
  'Sony',
  'Microsoft',
  'Huawei',
  'Xiaomi',
  'Honor',
  'تاني',
]

function emptyForm(overrides = {}) {
  return {
    // بنود الإدخال: كل بند = نوع عملية + عدد (ممكن يكونوا أكتر من واحد)
    lines: [],
    entry_date: toISODate(new Date()),
    notes: '',
    serials: [],
    // نوع اللاب وموديله (نفس ترتيب السيريالات)
    types: [],
    models: [],
    // وجهة كل لاب (نفس ترتيب السيريالات) — لو فيه مشكلة اللاب يروح فين
    destinations: [],
    // هل اللاب ده فيه مشكلة؟ (خانة اختيار في الواجهة بس — مش بتتخزّن)
    problems: [],
    ...overrides,
  }
}

export default function WorkerDashboard() {
  const { user, profile } = useAuth()
  const [operations, setOperations] = useState([])
  const [destinations, setDestinations] = useState([])
  const [entries, setEntries] = useState([])
  const [summarySource, setSummarySource] = useState([])
  const [retest, setRetest] = useState([])
  const [tab, setTab] = useState('entry')
  const [form, setForm] = useState(emptyForm())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [scanIdx, setScanIdx] = useState(null)

  async function loadOperations() {
    const { data } = await supabase
      .from('operations')
      .select('*')
      .eq('active', true)
      .order('sort_order')
    setOperations(data ?? [])
  }

  // وجهات اللاب (صيانة الشاشات / قطع غيار / الكسور / الرش / البطاريات / تجميع / هالك …)
  async function loadDestinations() {
    const { data } = await supabase
      .from('stages')
      .select('code, name_ar, sort_order')
      .eq('is_destination', true)
      .eq('active', true)
      .order('sort_order')
    setDestinations(data ?? [])
  }

  async function loadEntries() {
    const { data } = await supabase
      .from('production_entries')
      .select('*, operations(name_ar, name_en), entry_operations(operation_id, quantity, operations(name_ar))')
      .eq('worker_id', user.id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setEntries(data ?? [])
  }

  // ملخّص اليوم/الأسبوع/الشهر بيحتاج كل إدخالات الفترة، مش آخر 100 بس —
  // عشان كده بنسحبه باستعلام مخصوص من بداية الأسبوع أو الشهر (الأقدم بينهم).
  async function loadSummarySource() {
    const from = toISODate(startOfWeek() < startOfMonth() ? startOfWeek() : startOfMonth())
    const { data } = await supabase
      .from('production_entries')
      .select('entry_date, status, worker_hidden_at, quantity, operation_id, entry_operations(quantity)')
      .eq('worker_id', user.id)
      .gte('entry_date', from)
    setSummarySource(data ?? [])
  }

  // لابات رجعتلي من الصيانة ومستنية إني أعملها تست من جديد
  async function loadRetest() {
    const { data } = await supabase.rpc('fn_worker_retest_queue')
    setRetest(data ?? [])
  }

  useEffect(() => {
    if (!user) return
    loadOperations()
    loadDestinations()
    loadEntries()
    loadSummarySource()
    loadRetest()
  }, [user])

  // بنحسب الإدخالات المعتمدة من المشرف (وأيضًا المُصدرة) في ملخّص الإنتاجية.
  // الإدخالات اللي الموظف حذفها من أرشيفه (worker_hidden_at) بتتشال من الأرقام كمان.
  // المؤرشفة بس (من غير حذف) بتفضل محسوبة.
  const released = useMemo(
    () => summarySource.filter((e) => (e.status === 'approved' || e.status === 'released') && !e.worker_hidden_at),
    [summarySource]
  )

  const summary = useMemo(() => {
    const today = toISODate(new Date())
    const weekStart = toISODate(startOfWeek())
    const monthStart = toISODate(startOfMonth())
    const bucket = (from, mode) => {
      const rows = released.filter((e) => (mode === 'day' ? e.entry_date === from : e.entry_date >= from))
      return {
        laps: rows.reduce((s, e) => s + entryTotalQty(e), 0),
      }
    }
    return {
      today: bucket(today, 'day'),
      week: bucket(weekStart, 'range'),
      month: bucket(monthStart, 'range'),
    }
  }, [released])

  // الإدخالات الظاهرة في القائمة الرئيسية (من غير اللي الموظف نقلها لأرشيفه)
  const visibleEntries = useMemo(() => entries.filter((e) => !e.worker_archived_at), [entries])

  // ترحيب حسب وقت الدخول (صباح / مساء)
  const greeting = new Date().getHours() < 12 ? 'صباح الخير' : 'مساء الخير'

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

  // نجمّع خانات السيريال حسب نوع العملية: كل عملية يظهر اسمها وتحتها خانات بعددها
  const serialGroups = useMemo(() => {
    let offset = 0
    return form.lines
      .filter((l) => l.operation_id && Number(l.quantity) > 0)
      .map((l) => {
        const op = operations.find((o) => String(o.id) === String(l.operation_id))
        const qty = Number(l.quantity) || 0
        const start = offset
        offset += qty
        return { key: String(l.operation_id), name: op?.name_ar ?? 'عملية', qty, start }
      })
  }, [form.lines, operations])

  function setSerial(idx, value) {
    setForm((f) => {
      const serials = [...f.serials]
      while (serials.length <= idx) serials.push('')
      serials[idx] = value
      return { ...f, serials }
    })
  }

  function setType(idx, value) {
    setForm((f) => {
      const types = [...f.types]
      while (types.length <= idx) types.push('')
      types[idx] = value
      return { ...f, types }
    })
  }

  function setModel(idx, value) {
    setForm((f) => {
      const models = [...f.models]
      while (models.length <= idx) models.push('')
      models[idx] = value
      return { ...f, models }
    })
  }

  function setDestination(idx, value) {
    setForm((f) => {
      const destinations = [...f.destinations]
      while (destinations.length <= idx) destinations.push('')
      destinations[idx] = value
      return { ...f, destinations }
    })
  }

  // تحديد حالة اللاب: سليم (مفيش مشكلة) أو فيه مشكلة تختار وجهتها
  function setProblem(idx, isProblem) {
    setForm((f) => {
      const problems = [...f.problems]
      while (problems.length <= idx) problems.push(false)
      problems[idx] = isProblem

      const destinations = [...f.destinations]
      while (destinations.length <= idx) destinations.push('')
      // لو رجّعناه «سليم» نشيل الوجهة المختارة
      if (!isProblem) destinations[idx] = ''

      return { ...f, problems, destinations }
    })
  }

  // نضمن إن اللاب بالسيريال موجود، وبعدين نسجّل وجهته في مسار اللاب فورًا
  async function routeLaptop(serial, stageCode) {
    const { data: existing } = await supabase
      .from('laptops')
      .select('id')
      .eq('serial', serial)
      .maybeSingle()

    let laptopId = existing?.id
    if (!laptopId) {
      const { data: created, error } = await supabase.rpc('fn_create_laptop', { p_serial: serial })
      if (error) throw new Error(`السيريال «${serial}»: ${error.message}`)
      laptopId = Array.isArray(created) ? created[0]?.id : created?.id
    }
    if (!laptopId) throw new Error(`تعذّر تجهيز لاب السيريال «${serial}».`)

    const { error } = await supabase.rpc('fn_advance_stage', {
      p_laptop_id: laptopId,
      p_stage_code: stageCode,
    })
    if (error) throw new Error(`السيريال «${serial}»: ${error.message}`)
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

    // اللابات في الإدخال: نوع + موديل + سيريال + حالته ووجهته (نفس الترتيب)
    const totalLaps = lines.reduce((s, l) => s + l.quantity, 0)
    const laptopRows = Array.from({ length: totalLaps }, (_, i) => ({
      serial: String(form.serials[i] ?? '').trim(),
      laptop_type: form.types[i] ?? '',
      model: String(form.models[i] ?? '').trim(),
      destination: form.destinations[i] ?? '',
      problem: Boolean(form.problems[i]),
    }))
    if (laptopRows.some((r) => !r.laptop_type || !r.model || !r.serial)) {
      return setMsg({ type: 'error', text: 'كمّل بيانات كل لاب: نوع اللاب والموديل والسيريال.' })
    }
    if (laptopRows.some((r) => r.problem && !r.destination)) {
      return setMsg({ type: 'error', text: 'اختار نوع المشكلة لكل لاب حدّدته «فيه مشكلة».' })
    }

    const wasEdit = Boolean(editingId)
    setBusy(true)
    try {
      const entryId = editingId ?? crypto.randomUUID()

      // الأعمدة القديمة (operation_id/quantity) بنسيبها = أول بند/الإجمالي
      // عشان أي شاشة قديمة تفضل شغالة.
      const base = {
        operation_id: lines[0].operation_id,
        entry_date: form.entry_date,
        quantity: totalLaps,
        notes: form.notes || null,
      }

      if (wasEdit) {
        // عدّل الإدخال ورجّعه مسودّة (يمسح الإرجاع السابق)
        const { error: upErr } = await supabase
          .from('production_entries')
          .update({ ...base, status: 'draft', return_reason: null, returned_by: null, returned_at: null })
          .eq('id', entryId)
        if (upErr) throw upErr

        // استبدل السيريالات والبنود بالكامل
        await supabase.from('lap_serials').delete().eq('entry_id', entryId)
        await supabase.from('entry_operations').delete().eq('entry_id', entryId)
      } else {
        // أنشئ الإدخال
        const { error: entryError } = await supabase
          .from('production_entries')
          .insert({ id: entryId, worker_id: user.id, ...base, status: 'draft' })
        if (entryError) throw entryError
      }

      // بنود الإدخال (العمليات)
      const { error: linesError } = await supabase
        .from('entry_operations')
        .insert(lines.map((l) => ({ entry_id: entryId, operation_id: l.operation_id, quantity: l.quantity })))
      if (linesError) throw linesError

      // اللابات (نوع + موديل + سيريال + وجهة اللاب)
      const { error } = await supabase.from('lap_serials').insert(
        laptopRows.map((r) => ({
          entry_id: entryId,
          serial: r.serial,
          laptop_type: r.laptop_type,
          model: r.model,
          stage_code: r.destination || null,
        }))
      )
      if (error) throw error

      // مسار اللاب: بنسجّل وجهة كل لاب (لو محدّد) في مسار اللاب فورًا
      for (const r of laptopRows) {
        if (r.serial && r.destination) await routeLaptop(r.serial, r.destination)
      }

      setForm(emptyForm({ entry_date: form.entry_date }))
      setEditingId(null)
      setMsg({
        type: 'ok',
        text: wasEdit
          ? 'تم تعديل إدخالك وإرساله للمراجعة من جديد.'
          : 'تم تسجيل إدخالك، وهو في انتظار إصدار المشرف.',
      })
      loadEntries()
      loadSummarySource()
      loadRetest()
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
        .select('serial, laptop_type, model, stage_code')
        .eq('entry_id', entry.id)
        .order('created_at'),
      supabase
        .from('entry_operations')
        .select('operation_id, quantity')
        .eq('entry_id', entry.id),
    ])
    const serialRows = serialsRes.data ?? []
    const lines = (linesRes.data ?? []).length
      ? linesRes.data
      : [{ operation_id: entry.operation_id, quantity: entry.quantity }]

    setForm({
      lines: lines.map((l) => ({ operation_id: String(l.operation_id), quantity: String(l.quantity) })),
      entry_date: entry.entry_date,
      notes: entry.notes ?? '',
      serials: serialRows.map((s) => s.serial),
      types: serialRows.map((s) => s.laptop_type ?? ''),
      models: serialRows.map((s) => s.model ?? ''),
      destinations: serialRows.map((s) => s.stage_code ?? ''),
      problems: serialRows.map((s) => Boolean(s.stage_code)),
    })
    setEditingId(entry.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm({ entry_date: form.entry_date }))
  }

  async function removeEntry(entry) {
    if (!window.confirm('متأكد إنك عايز تحذف الإدخال ده؟')) return
    setMsg(null)
    const { error } = await supabase.from('production_entries').delete().eq('id', entry.id)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: 'تم حذف الإدخال.' })
    loadEntries()
  }

  // نقل إدخال معتمد لأرشيف الموظف (يخفّف زحمة الصفحة — الإدخال بيفضل موجود عند المشرف)
  async function archiveEntry(entry) {
    setMsg(null)
    setBusyId(entry.id)
    const { error } = await supabase.rpc('fn_worker_archive_entry', { p_entry_id: entry.id })
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: 'تم نقل الإدخال لأرشيفك.' })
    loadEntries()
  }

  // اللاب خلص إعادة اختبار وطلع سليم → يتبعت للمشرف على طول (من غير تسجيل إدخال يدوي)
  async function sendRetest(row) {
    setMsg(null)
    setBusyId(row.serial_id)
    const { error } = await supabase.rpc('fn_worker_send_retest', { p_serial_id: row.serial_id })
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: `تم إرسال اللاب «${row.serial}» للمشرف — اللاب سليم وجاهز للاعتماد.` })
    loadRetest()
    loadEntries()
    loadSummarySource()
  }

  // اللاب لسه فيه مشكلة بعد الصيانة → يرجع للصيانة تاني ويتشال من طابور إعادة الاختبار
  async function sendProblem(row) {
    if (!window.confirm(`اللاب «${row.serial}» لسه فيه مشكلة؟ هيرجع للصيانة تاني.`)) return
    setMsg(null)
    setBusyId(row.serial_id)
    const { error } = await supabase.rpc('fn_worker_retest_problem', { p_serial_id: row.serial_id })
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: `تم إرجاع اللاب «${row.serial}» للصيانة تاني.` })
    loadRetest()
  }

  return (
    <Layout title="إنتاجي اليوم">
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <StatCard label="لابات النهاردة" value={summary.today.laps} />
        <StatCard label="لابات الأسبوع" value={summary.week.laps} />
        <StatCard label="لابات الشهر" value={summary.month.laps} />
      </div>

      <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
        <button
          onClick={() => {
            setTab('entry')
            setMsg(null)
          }}
          className={`${tab === 'entry' ? 'btn-primary' : 'btn-ghost'} shrink-0 whitespace-nowrap`}
        >
          تسجيل إنتاج
        </button>
        <button
          onClick={() => {
            setTab('retest')
            setMsg(null)
          }}
          className={`${tab === 'retest' ? 'btn-primary' : 'btn-ghost'} shrink-0 whitespace-nowrap`}
        >
          في انتظار إعادة الاختبار
          {retest.length > 0 && <span className="badge bg-white/20 text-inherit">{retest.length}</span>}
        </button>
      </div>

      {tab === 'entry' && (
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={handleSubmit} className="card lg:col-span-2 space-y-4 h-fit order-1 lg:order-none">
          <h2 className="font-bold text-lg">{editingId ? 'تعديل إدخال' : 'تسجيل إنتاج جديد'}</h2>
          <p className="text-xs text-slate-500">
            {greeting} يا ضلع الشركة {profile?.full_name}، سجّل اللي عملته النهاردة.
          </p>

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
                      <span className="text-sm">{o.name_ar}</span>
                    </label>
                    {checked && (
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        enterKeyHint="done"
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

          {serialGroups.length > 0 && (
            <div>
              <label className="label">بيانات اللابات (النوع والموديل والسيريال والحالة)</label>
              <div className="space-y-4">
                {serialGroups.map((g) => (
                  <div key={g.key}>
                    <p className="mb-1 text-sm font-medium">{g.name}</p>
                    <div className="space-y-2">
                      {Array.from({ length: g.qty }).map((_, i) => {
                        const idx = g.start + i
                        const hasProblem = Boolean(form.problems[idx])
                        return (
                          <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-2">
                            <p className="text-xs text-slate-400">لاب {i + 1}</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <select
                                className="input"
                                value={form.types[idx] ?? ''}
                                onChange={(e) => setType(idx, e.target.value)}
                              >
                                <option value="">نوع اللاب…</option>
                                {LAPTOP_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input"
                                placeholder="الموديل"
                                value={form.models[idx] ?? ''}
                                onChange={(e) => setModel(idx, e.target.value)}
                              />
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <div className="flex flex-1 gap-2">
                                <input
                                  className="input flex-1 font-mono text-sm"
                                  dir="ltr"
                                  inputMode="text"
                                  autoCapitalize="characters"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  enterKeyHint="next"
                                  placeholder={`سيريال ${i + 1}`}
                                  value={form.serials[idx] ?? ''}
                                  onChange={(e) => setSerial(idx, e.target.value)}
                                />
                                {SCAN_SUPPORTED && (
                                  <button
                                    type="button"
                                    onClick={() => setScanIdx(idx)}
                                    className="btn-ghost shrink-0 !px-3"
                                    aria-label={`مسح سيريال اللاب ${i + 1} بالكاميرا`}
                                    title="مسح السيريال بالكاميرا"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="h-5 w-5"
                                      aria-hidden="true"
                                    >
                                      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
                                      <path d="M20 8V6a2 2 0 0 0-2-2h-2" />
                                      <path d="M4 16v2a2 2 0 0 0 2 2h2" />
                                      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
                                      <circle cx="12" cy="12" r="3" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300">
                                <button
                                  type="button"
                                  onClick={() => setProblem(idx, false)}
                                  className={`tap flex-1 px-3 text-sm ${hasProblem ? 'bg-white text-slate-600' : 'bg-emerald-600 text-white'}`}
                                >
                                  سليم
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setProblem(idx, true)}
                                  className={`tap flex-1 px-3 text-sm ${hasProblem ? 'bg-red-600 text-white' : 'bg-white text-slate-600'}`}
                                >
                                  فيه مشكلة
                                </button>
                              </div>
                            </div>
                            {hasProblem && (
                              <select
                                className="input"
                                value={form.destinations[idx] ?? ''}
                                onChange={(e) => setDestination(idx, e.target.value)}
                              >
                                <option value="">اختار المشكلة…</option>
                                {destinations.map((d) => (
                                  <option key={d.code} value={d.code}>
                                    {d.name_ar}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                لكل لاب: اختار نوع اللاب واكتب الموديل والسيريال، وبعدين حدّد حالته: «سليم» (الافتراضي)، أو «فيه مشكلة»
                وتختار وجهته (صيانة الشاشات / ناقص قطع غيار /
                الكسور / الرش / البطاريات / هالك) — وتتسجّل في مسار اللاب فورًا.
              </p>
            </div>
          )}

          <div>
            <label className="label">ملاحظات</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="أي تفاصيل أو مشاكل…" />
          </div>

          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'جاري الحفظ…' : 'حفظ الإدخال'}
          </button>
        </form>

        <div className="card lg:col-span-3 order-2 lg:order-none">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-bold text-lg">آخر إدخالاتي</h2>
            <Link to="/worker/archive" className="btn-ghost !py-1 !px-3 text-xs">
              أرشيف إنتاجي
            </Link>
          </div>
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
                {visibleEntries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-6">
                      مفيش إدخالات لسه
                    </td>
                  </tr>
                )}
                {visibleEntries.map((e) => (
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
                        {(e.status === 'approved' || e.status === 'released') && (
                          <button
                            onClick={() => archiveEntry(e)}
                            disabled={busyId === e.id}
                            className="btn-ghost !py-1 !px-2 text-xs"
                          >
                            {busyId === e.id ? '…' : 'أرشفة'}
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
      )}

      {tab === 'retest' && (
        <div className="card">
          <div className="mb-3">
            <h2 className="font-bold text-lg">في انتظار إعادة الاختبار</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {retest.length === 0
                ? 'مفيش لابات راجعة من الصيانة'
                : `${retest.length} لاب رجع من الصيانة — اعمله تست من جديد.`}
            </p>
          </div>
          <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            اللابات اللي المشرف خلّص صيانتها بترجع لك هنا تلقائيًا. لما تعمل لها تست جديد وتبقى سليمة دوس
            «إرسال للمشرف (سليم)» وهترجع للمشرف على طول عشان يعتمدها، ولو لسه فيها مشكلة دوس «لسه فيه مشكلة» وترجع
            للصيانة تاني.
          </p>
          {msg && (
            <div className={`mb-3 text-sm rounded-lg p-3 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {msg.text}
            </div>
          )}
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>السيريال</th>
                  <th>نوع اللاب</th>
                  <th>الموديل</th>
                  <th>آخر مشكلة</th>
                  <th>اتخلّصت الصيانة</th>
                  <th>اللي خلّصها</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {retest.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-6">
                      مفيش لابات في انتظار إعادة الاختبار
                    </td>
                  </tr>
                )}
                {retest.map((r) => (
                  <tr key={r.serial_id}>
                    <td data-label="السيريال" dir="ltr" className="text-left font-mono text-sm">{r.serial}</td>
                    <td data-label="نوع اللاب">{r.laptop_type || '—'}</td>
                    <td data-label="الموديل">{r.model || '—'}</td>
                    <td data-label="آخر مشكلة">
                      <span className="badge bg-amber-100 text-amber-800">
                        {r.dest_code ? (destinations.find((d) => d.code === r.dest_code)?.name_ar ?? r.dest_code) : '—'}
                      </span>
                    </td>
                    <td data-label="اتخلّصت الصيانة">{r.done_at ? formatDate(r.done_at) : '-'}</td>
                    <td data-label="اللي خلّصها">{r.done_by_name || '—'}</td>
                    <td data-label="إجراء">
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={busyId === r.serial_id}
                          onClick={() => sendRetest(r)}
                          className="btn-accent !py-1 !px-3 text-sm"
                        >
                          {busyId === r.serial_id ? '…' : 'إرسال للمشرف (سليم)'}
                        </button>
                        <button
                          disabled={busyId === r.serial_id}
                          onClick={() => sendProblem(r)}
                          className="btn-danger !py-1 !px-3 text-sm"
                        >
                          لسه فيه مشكلة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {scanIdx !== null && (
        <SerialScanner
          onClose={() => setScanIdx(null)}
          onDetected={(value) => {
            setSerial(scanIdx, value)
            setScanIdx(null)
          }}
        />
      )}

      {detailId && <EntryDetails entryId={detailId} onClose={() => setDetailId(null)} />}
    </Layout>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold mt-1">{formatNumber(value)}</p>
    </div>
  )
}

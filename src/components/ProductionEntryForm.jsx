import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import SerialScanner, { SCAN_SUPPORTED } from './SerialScanner'
import { toISODate } from '../lib/dates'

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
    // بنود الإدخال: كل بند = نوع عملية (تست) + عدد (ممكن يكونوا أكتر من واحد)
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

// نموذج تسجيل الإنتاج اللي المشرف بيستخدمه: يختار الموظف الأول، وبعدين نوع التست، ويسجّل.
export default function ProductionEntryForm({ onSaved }) {
  const [employees, setEmployees] = useState([])
  const [operations, setOperations] = useState([])
  const [destinations, setDestinations] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [form, setForm] = useState(emptyForm())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [scanIdx, setScanIdx] = useState(null)

  async function loadEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name')
      .eq('active', true)
      .order('sort_order')
      .order('full_name')
    setEmployees(data ?? [])
  }

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

  useEffect(() => {
    loadEmployees()
    loadOperations()
    loadDestinations()
  }, [])

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

    if (!employeeId) return setMsg({ type: 'error', text: 'اختار اسم الموظف الأول.' })

    // بنود الإدخال: كل بند لازم عدد صحيح > 0
    const lines = form.lines
      .filter((l) => l.operation_id)
      .map((l) => ({ operation_id: Number(l.operation_id), quantity: Number(l.quantity) }))
    if (!lines.length) return setMsg({ type: 'error', text: 'اختار نوع تست واحد على الأقل.' })
    if (lines.some((l) => !l.quantity || l.quantity <= 0)) {
      return setMsg({ type: 'error', text: 'اكتب عدد صحيح لكل نوع تست اخترته.' })
    }

    // اللابات في الإدخال: نوع + موديل + سيريال + حالته ووجهته (نفس الترتيب)
    const totalLaps = lines.reduce((s, l) => s + l.quantity, 0)
    // نوع التست لكل لاب = العملية اللي بيقع تحتها حسب ترتيب بنود الإدخال
    const opForIndex = Array.from({ length: totalLaps }, () => null)
    let offset = 0
    for (const l of lines) {
      for (let k = 0; k < l.quantity; k += 1) opForIndex[offset + k] = l.operation_id
      offset += l.quantity
    }
    const laptopRows = Array.from({ length: totalLaps }, (_, i) => ({
      serial: String(form.serials[i] ?? '').trim(),
      laptop_type: form.types[i] ?? '',
      model: String(form.models[i] ?? '').trim(),
      destination: form.destinations[i] ?? '',
      problem: Boolean(form.problems[i]),
      operation_id: opForIndex[i] ?? null,
    }))
    if (laptopRows.some((r) => !r.laptop_type || !r.model || !r.serial)) {
      return setMsg({ type: 'error', text: 'كمّل بيانات كل لاب: نوع اللاب والموديل والسيريال.' })
    }
    if (laptopRows.some((r) => r.problem && !r.destination)) {
      return setMsg({ type: 'error', text: 'اختار نوع المشكلة لكل لاب حدّدته «فيه مشكلة».' })
    }

    setBusy(true)
    try {
      const entryId = crypto.randomUUID()

      // الأعمدة القديمة (operation_id/quantity) بنسيبها = أول بند/الإجمالي
      const base = {
        operation_id: lines[0].operation_id,
        entry_date: form.entry_date,
        quantity: totalLaps,
        notes: form.notes || null,
      }

      // الإدخال بيتسجّل باسم الموظف المختار (مش حساب المستخدم)
      const { error: entryError } = await supabase
        .from('production_entries')
        .insert({ id: entryId, worker_id: employeeId, ...base, status: 'draft' })
      if (entryError) throw entryError

      // بنود الإدخال (العمليات)
      const { error: linesError } = await supabase
        .from('entry_operations')
        .insert(lines.map((l) => ({ entry_id: entryId, operation_id: l.operation_id, quantity: l.quantity })))
      if (linesError) throw linesError

      // اللابات (نوع + موديل + سيريال + وجهة اللاب + نوع التست)
      const { error } = await supabase.from('lap_serials').insert(
        laptopRows.map((r) => ({
          entry_id: entryId,
          serial: r.serial,
          laptop_type: r.laptop_type,
          model: r.model,
          stage_code: r.destination || null,
          operation_id: r.operation_id,
        }))
      )
      if (error) throw error

      // مسار اللاب: بنسجّل وجهة كل لاب (لو محدّد) في مسار اللاب فورًا
      for (const r of laptopRows) {
        if (r.serial && r.destination) await routeLaptop(r.serial, r.destination)
      }

      const empName = employees.find((x) => x.id === employeeId)?.full_name ?? 'الموظف'
      setForm(emptyForm({ entry_date: form.entry_date }))
      setEmployeeId('')
      setMsg({ type: 'ok', text: `تم تسجيل إنتاج ${empName} — الإدخال بانتظار الاعتماد.` })
      onSaved?.()
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'حصل خطأ أثناء الحفظ.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div>
        <h2 className="font-bold text-lg">تسجيل إنتاج جديد</h2>
        <p className="text-xs text-slate-500 mt-1">
          اختار اسم الموظف الأول، وبعدين حدّد نوع التست والعدد، وكمّل بيانات اللابات.
        </p>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg p-3 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg.text}
        </div>
      )}

      <div>
        <label className="label">اسم الموظف</label>
        <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">اختار الموظف…</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name}
            </option>
          ))}
        </select>
        {employees.length === 0 && (
          <p className="text-xs text-amber-600 mt-1">
            مفيش موظفين — ضيف أسماء الموظفين من صفحة «أسماء الموظفين».
          </p>
        )}
      </div>

      <div>
        <label className="label">نوع التست (تقدر تختار أكتر من واحد)</label>
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
        <p className="mt-1 text-xs text-slate-400">حدّد نوع التست واكتب عدده — تقدر تحدّد أكتر من نوع في نفس الإدخال.</p>
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
            وتختار وجهته (صيانة الشاشات / ناقص قطع غيار / الكسور / الرش / البطاريات / هالك) — وتتسجّل في مسار اللاب فورًا.
          </p>
        </div>
      )}

      <div>
        <label className="label">ملاحظات</label>
        <textarea className="input" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="أي تفاصيل أو مشاكل…" />
      </div>

      <button type="submit" disabled={busy || !employeeId} className="btn-accent w-full">
        {busy ? 'جاري الحفظ…' : 'حفظ الإدخال'}
      </button>

      {scanIdx !== null && (
        <SerialScanner
          onClose={() => setScanIdx(null)}
          onDetected={(value) => {
            setSerial(scanIdx, value)
            setScanIdx(null)
          }}
        />
      )}
    </form>
  )
}

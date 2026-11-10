import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate, toISODate } from '../lib/dates'
import { exportXlsx } from '../lib/xlsx'

// شرح عربي لكل إجراء مسجّل في سجل الأوديت
const ACTION_LABELS = {
  create_laptop: 'إنشاء لاب',
  submit_entry: 'تسليم إدخال',
  'review_entry:approved': 'اعتماد إدخال',
  'review_entry:rejected': 'رفض إدخال',
  approve_laptop: 'اعتماد لاب',
  'release_laptop:released': 'إصدار لاب',
  'release_laptop:returned': 'إرجاع لاب',
  archive_entry: 'أرشفة إدخال',
  restore_entry: 'استرجاع إدخال',
  delete_all_entries: 'حذف كل الإدخالات',
  close_month: 'إغلاق شهر',
  reopen_month: 'إعادة فتح شهر',
  add_adjustment: 'إضافة تسوية',
}

// نستخرج رسالة الخطأ الحقيقية من رد دالة الحافة (edge function)
async function edgeErrorMessage(error) {
  try {
    const res = error?.context
    if (res && typeof res.clone === 'function') {
      const body = await res.clone().json()
      if (body?.error) return body.error
    }
  } catch {
    /* نتجاهل ونجرّب الرسالة الافتراضية */
  }
  return error?.message || 'تعذّر تشغيل التحليل.'
}

function actionLabel(action, stageMap) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  if (action?.startsWith('advance_stage:')) {
    const code = action.split(':')[1]
    return `نقل مرحلة: ${stageMap?.[code] ?? code}`
  }
  return action ?? '-'
}

function actionTone(action) {
  if (!action) return 'bg-slate-100 text-slate-600'
  if (action.includes('rejected') || action.includes('returned')) return 'bg-red-100 text-red-700'
  if (action.includes('close_month') || action.includes('released') || action.includes('approved'))
    return 'bg-emerald-100 text-emerald-800'
  if (action.includes('reopen') || action.includes('adjustment')) return 'bg-amber-100 text-amber-800'
  return 'bg-blue-100 text-blue-800'
}

function startOfMonthISO() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const LIMIT = 300

export default function AuditLog() {
  const { profile } = useAuth()
  const canDelete = ['supervisor', 'accountant'].includes(profile?.role)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [from, setFrom] = useState(startOfMonthISO())
  const [to, setTo] = useState(toISODate(new Date()))
  const [q, setQ] = useState('')
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [busyAll, setBusyAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [stageMap, setStageMap] = useState({})
  const [ai, setAi] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [topWorker, setTopWorker] = useState(null)

  useEffect(() => {
    supabase
      .from('stages')
      .select('code, name_ar')
      .then(({ data }) => {
        setStageMap(Object.fromEntries((data ?? []).map((s) => [s.code, s.name_ar])))
      })
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('audit_logs')
        .select('*, profiles!audit_logs_actor_id_fkey(full_name, role)')
        .gte('created_at', `${from}T00:00:00`)
        .lte('created_at', `${to}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(LIMIT)
      if (!active) return
      setRows(data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [from, to, reloadKey])

  const filtered = useMemo(() => {
    let list = rows
    if (approvedOnly) list = list.filter((r) => String(r.action ?? '').includes('approved'))
    const term = q.trim().toLowerCase()
    if (!term) return list
    return list.filter((r) =>
      [r.action, r.entity, actionLabel(r.action), r.profiles?.full_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    )
  }, [rows, q, approvedOnly])

  async function removeRow(row) {
    if (!window.confirm('تأكيد حذف السجل ده من سجل الأوديت نهائيًا؟')) return
    setBusyId(row.id)
    const { error } = await supabase.rpc('fn_delete_audit_log', { p_id: row.id })
    setBusyId(null)
    if (error) return window.alert(error.message)
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    setOpenId((id) => (id === row.id ? null : id))
  }

  async function removeAll() {
    if (!rows.length) return
    if (
      !window.confirm(
        `تأكيد حذف كل أحداث السجل من ${from} إلى ${to} نهائيًا؟\nعدد الأحداث: ${rows.length}`
      )
    )
      return
    if (!window.confirm('متأكد؟ الحذف نهائي ومش هينفع ترجع الأحداث تاني.')) return
    setBusyAll(true)
    const { data, error } = await supabase.rpc('fn_delete_all_audit_logs', {
      p_from: `${from}T00:00:00`,
      p_to: `${to}T23:59:59`,
    })
    setBusyAll(false)
    if (error) return window.alert(error.message)
    setOpenId(null)
    setReloadKey((k) => k + 1)
    window.alert(`تم حذف ${data ?? 0} حدث.`)
  }

  function exportExcel() {
    exportXlsx({
      filename: `yas-audit_${from}_${to}.xlsx`,
      sheetName: 'سجل الأوديت',
      meta: [[`الفترة: ${from} ← ${to}`], [`عدد السجلات: ${filtered.length}`]],
      headers: ['التاريخ', 'المستخدم', 'الدور', 'الإجراء', 'الكيان', 'معرّف العنصر'],
      rows: filtered.map((r) => [
        new Date(r.created_at).toLocaleString('ar-EG'),
        r.profiles?.full_name ?? '—',
        r.profiles?.role ?? '—',
        actionLabel(r.action),
        r.entity ?? '—',
        r.entity_id ?? '—',
      ]),
    })
  }

  // شيت اللابات المعتمدة في الفترة (سيريال + موظف + عملية + وجهة + حالة)
  async function exportApprovedLaptops() {
    setExporting(true)
    try {
      const { data, error } = await supabase
        .from('production_entries')
        .select(
          'id, entry_date, quantity, status, stage_code, profiles!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(quantity, operations(name_ar)), lap_serials(serial, laptop_type, model, stage_code)'
        )
        .in('status', ['approved', 'released'])
        .gte('entry_date', from)
        .lte('entry_date', to)
        .order('entry_date', { ascending: true })
      if (error) throw error

      const entries = data ?? []
      const out = []
      for (const e of entries) {
        const worker = e.profiles?.full_name ?? '—'
        const ops = (
          e.entry_operations?.length
            ? e.entry_operations.map((l) => `${l.operations?.name_ar ?? '—'} (${l.quantity})`)
            : [`${e.operations?.name_ar ?? '—'} (${e.quantity})`]
        ).join(' · ')
        const status = e.status === 'released' ? 'مُصدر' : 'معتمد'
        const serials = e.lap_serials ?? []
        if (serials.length) {
          for (const s of serials) {
            const dest = s.stage_code ? (stageMap[s.stage_code] ?? s.stage_code) : 'سليم'
            out.push([s.serial, s.laptop_type ?? '—', s.model ?? '—', e.entry_date, worker, ops, dest, status])
          }
        } else {
          const stage = e.stage_code ? (stageMap[e.stage_code] ?? e.stage_code) : 'سليم'
          out.push(['—', '—', '—', e.entry_date, worker, ops, stage, status])
        }
      }

      if (!out.length) {
        window.alert('مفيش لابات معتمدة في الفترة دي.')
        return
      }

      exportXlsx({
        filename: `yas-approved-laptops_${from}_${to}.xlsx`,
        sheetName: 'لابات معتمدة',
        meta: [[`الفترة: ${from} ← ${to}`], [`عدد الإدخالات: ${entries.length}`]],
        headers: ['السيريال', 'نوع اللاب', 'الموديل', 'التاريخ', 'الموظف', 'العملية', 'الوجهة', 'الحالة'],
        rows: out,
      })
    } catch (err) {
      window.alert(err.message || 'تعذّر تصدير الملف.')
    } finally {
      setExporting(false)
    }
  }

  // تحليل بالذكاء الاصطناعي: ترتيب الموظفين حسب عدد اللابات المعتمدة في الفترة
  async function runAI() {
    setAiBusy(true)
    setAiError('')
    setAi(null)
    setTopWorker(null)
    try {
      const { data, error } = await supabase
        .from('production_entries')
        .select(
          'id, entry_date, quantity, notes, profiles!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(quantity, operations(name_ar))'
        )
        .in('status', ['approved', 'released'])
        .gte('entry_date', from)
        .lte('entry_date', to)
      if (error) throw error

      const byWorker = new Map()
      const notes = []
      let total = 0
      for (const e of data ?? []) {
        const laps = e.entry_operations?.length
          ? e.entry_operations.reduce((s, l) => s + (l.quantity ?? 0), 0)
          : e.quantity ?? 0
        total += laps
        const name = e.profiles?.full_name ?? 'غير معروف'
        byWorker.set(name, (byWorker.get(name) ?? 0) + laps)
        if (e.notes) notes.push({ worker: name, operation: e.operations?.name_ar ?? '', notes: e.notes })
      }
      const workers = [...byWorker.entries()]
        .map(([name, laps]) => ({ name, laps, units: laps }))
        .sort((a, b) => b.laps - a.laps)

      if (!workers.length) throw new Error('مفيش لابات معتمدة في الفترة دي للتحليل.')

      const { data: res, error: fnErr } = await supabase.functions.invoke('ai-analysis', {
        body: {
          period: { start: from, end: to },
          totals: { laps: total, units: total },
          workers,
          entries: notes,
        },
      })
      if (fnErr) throw new Error(await edgeErrorMessage(fnErr))
      if (res?.error) throw new Error(res.error)

      setTopWorker(workers[0])
      setAi(res)
    } catch (err) {
      setAiError(err.message || 'تعذّر تشغيل التحليل. تأكد من نشر دالة ai-analysis.')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <Layout title="سجل الأوديت">
      <div className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="label">من</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">إلى</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">بحث</label>
          <input
            className="input w-56"
            placeholder="إجراء / كيان / مستخدم…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">&nbsp;</label>
          <button
            type="button"
            onClick={() => setApprovedOnly((v) => !v)}
            className={approvedOnly ? 'btn-accent' : 'btn-ghost'}
          >
            {approvedOnly ? '✓ الإدخالات المعتمدة فقط' : 'عرض المعتمدة فقط'}
          </button>
        </div>
        <div className="flex-1" />
        <button onClick={runAI} disabled={aiBusy} className="btn-primary">
          {aiBusy ? 'جاري التحليل…' : 'تحليل AI'}
        </button>
        <button onClick={exportApprovedLaptops} disabled={exporting} className="btn-ghost">
          {exporting ? 'جاري التصدير…' : 'لابات معتمدة (Excel)'}
        </button>
        <button onClick={exportExcel} disabled={filtered.length === 0} className="btn-ghost">
          تصدير السجل Excel
        </button>
        {canDelete && (
          <button onClick={removeAll} disabled={busyAll || rows.length === 0} className="btn-danger">
            {busyAll ? '…' : 'حذف الكل'}
          </button>
        )}
      </div>

      {(ai || aiError || aiBusy) && (
        <div className={`card mb-6 ${aiError ? 'border-red-200 bg-red-50' : ''}`}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold text-lg">تحليل الذكاء الاصطناعي</h2>
            {!aiBusy && (
              <button
                onClick={() => {
                  setAi(null)
                  setAiError('')
                  setTopWorker(null)
                }}
                className="btn-ghost !px-2 !py-1 text-xs"
              >
                إغلاق
              </button>
            )}
          </div>
          {aiBusy ? (
            <p className="text-sm text-slate-400">جاري التحليل…</p>
          ) : aiError ? (
            <p className="text-sm text-red-700">{aiError}</p>
          ) : (
            <>
              {topWorker && (
                <p className="mb-2 text-sm text-slate-700">
                  أعلى موظف في الفترة ({from} ← {to}):{' '}
                  <span className="font-semibold text-slate-900">{topWorker.name}</span> —{' '}
                  {topWorker.laps} لاب
                </p>
              )}
              <div className="text-sm leading-7 whitespace-pre-wrap text-slate-700">{ai.summary}</div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="font-bold text-lg mb-3">
          آخر الأحداث <span className="text-sm font-normal text-slate-400">({filtered.length})</span>
        </h2>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستخدم</th>
                <th>الإجراء</th>
                <th>الكيان</th>
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
                  <td colSpan={5} className="text-center text-slate-400 py-6">مفيش أحداث في الفترة دي</td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="التاريخ">{formatDate(r.created_at)}</td>
                  <td data-label="المستخدم">
                    {r.profiles?.full_name ?? '—'}
                    <span className="text-xs text-slate-400"> · {r.profiles?.role ?? '—'}</span>
                  </td>
                  <td data-label="الإجراء">
                    <span className={`badge ${actionTone(r.action)}`}>{actionLabel(r.action, stageMap)}</span>
                  </td>
                  <td data-label="الكيان" className="text-xs text-slate-500">{r.entity ?? '—'}</td>
                  <td data-label="إجراء" className="whitespace-nowrap">
                    <div className="flex gap-2">
                      {(r.before || r.after) && (
                        <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="btn-ghost !px-2 !py-1 text-xs">
                          {openId === r.id ? 'إخفاء' : 'تفاصيل'}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => removeRow(r)}
                          disabled={busyId === r.id}
                          className="btn-danger !px-2 !py-1 text-xs"
                        >
                          {busyId === r.id ? '…' : 'حذف'}
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

      {openId && (
        <AuditDetails
          row={filtered.find((r) => r.id === openId)}
          stageMap={stageMap}
          onClose={() => setOpenId(null)}
        />
      )}
    </Layout>
  )
}

function AuditDetails({ row, stageMap, onClose }) {
  if (!row) return null
  const isEntry = row.entity === 'production_entries' && Boolean(row.entity_id)
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl md:my-8 md:max-w-3xl md:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{actionLabel(row.action, stageMap)}</h2>
          <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-sm">إغلاق</button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {row.profiles?.full_name ?? '—'} · {new Date(row.created_at).toLocaleString('ar-EG')} · {row.entity ?? '—'}
        </p>
        {isEntry && <EntryLaptops entryId={row.entity_id} after={row.after} stageMap={stageMap} />}
        <DiffTable before={row.before} after={row.after} stageMap={stageMap} />
      </div>
    </div>
  )
}

// اللابات في الإدخال: مين عملها، العمليات والأعداد، الوجهة، والسيريالات
function EntryLaptops({ entryId, after, stageMap }) {
  const [loading, setLoading] = useState(true)
  const [entry, setEntry] = useState(null)
  const [serials, setSerials] = useState([])

  useEffect(() => {
    let active = true
    async function load() {
      if (!entryId) {
        setLoading(false)
        return
      }
      const [entryRes, serialsRes] = await Promise.all([
        supabase
          .from('production_entries')
          .select(
            'entry_date, quantity, status, stage_code, notes, profiles!production_entries_worker_id_fkey(full_name, role), operations(name_ar), entry_operations(quantity, operations(name_ar))'
          )
          .eq('id', entryId)
          .maybeSingle(),
        supabase
          .from('lap_serials')
          .select('serial, laptop_type, model, stage_code')
          .eq('entry_id', entryId)
          .order('created_at'),
      ])
      if (!active) return
      setEntry(entryRes.data ?? null)
      setSerials(serialsRes.data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [entryId])

  // نرجّع للـ payload المسجّل في الأوديت لو الإدخال نفسه مش موجود (اتحذف/اتأرشف)
  const info = entry ?? after ?? {}
  const worker = info.profiles?.full_name ?? '—'
  const role = info.profiles?.role ? ` (${VALUE_LABELS[info.profiles.role] ?? info.profiles.role})` : ''
  const ops = info.entry_operations?.length
    ? info.entry_operations.map((l) => `${l.operations?.name_ar ?? '—'} (${l.quantity})`).join(' · ')
    : info.operations?.name_ar
      ? `${info.operations.name_ar} (${info.quantity ?? '—'})`
      : '—'
  const stage = info.stage_code ? (stageMap?.[info.stage_code] ?? info.stage_code) : 'سليم'

  return (
    <div className="mb-4 rounded-lg bg-slate-50 p-3">
      <h3 className="mb-2 text-sm font-bold">اللابات في الإدخال ده</h3>
      {loading ? (
        <p className="text-xs text-slate-400">جاري التحميل…</p>
      ) : (
        <>
          <div className="mb-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
            <p>
              الموظف: <span className="font-semibold text-slate-800">{worker}</span>
              {role}
            </p>
            <p>تاريخ الإدخال: {info.entry_date ?? '—'}</p>
            <p>العدد: {info.quantity ?? '—'}</p>
            <p>الوجهة: {stage}</p>
          </div>
          <p className="mb-2 text-xs text-slate-600">العمليات: {ops}</p>
          {info.notes ? <p className="mb-2 text-xs text-slate-600">ملاحظات: {info.notes}</p> : null}
          {serials.length ? (
            <div className="space-y-1">
              {serials.map((s) => (
                <div key={s.serial} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-700">{s.laptop_type ?? '—'}</span>
                  <span className="text-slate-500">{s.model ?? '—'}</span>
                  <span dir="ltr" className="rounded bg-white px-2 py-1 font-mono text-xs">
                    {s.serial}
                  </span>
                  {s.stage_code ? (
                    <span className="badge bg-red-100 text-red-700">
                      {stageMap?.[s.stage_code] ?? s.stage_code}
                    </span>
                  ) : (
                    <span className="badge bg-emerald-100 text-emerald-800">سليم</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">مفيش لابات مسجّلة للإدخال ده.</p>
          )}
        </>
      )}
    </div>
  )
}

// أسماء الحقول بالعربي
const FIELD_LABELS = {
  status: 'الحالة',
  notes: 'الملاحظات',
  quantity: 'العدد',
  entry_date: 'تاريخ الإدخال',
  operation_id: 'العملية',
  stage_code: 'المرحلة',
  created_at: 'تاريخ الإنشاء',
  submitted_at: 'تاريخ التسليم',
  reviewed_at: 'تاريخ المراجعة',
  released_at: 'تاريخ الإصدار',
  returned_at: 'تاريخ الإرجاع',
  return_reason: 'سبب الإرجاع',
  full_name: 'الاسم',
  email: 'الإيميل',
  role: 'الدور',
  serial: 'السيريال',
  laptop_type: 'نوع اللاب',
  model: 'الموديل',
  current_status: 'الحالة الحالية',
  current_stage: 'المرحلة الحالية',
  approved_at: 'تاريخ الاعتماد',
  reason: 'السبب',
  decision: 'القرار',
  notes_text: 'ملاحظات',
  deleted: 'عدد المحذوف',
}

// قيم ثابتة بالعربي (حالات/أدوار)
const VALUE_LABELS = {
  draft: 'مسودّة',
  submitted: 'مُسلَّم',
  approved: 'معتمد',
  released: 'مُصدر',
  returned: 'مُرتجع',
  archived: 'مؤرشف',
  pending: 'قيد المراجعة',
  active: 'نشط',
  inactive: 'موقوف',
  rejected: 'مرفوض',
  closed: 'مقفول',
  open: 'مفتوح',
  worker: 'موظف',
  supervisor: 'مشرف',
  accountant: 'حسابات',
  received: 'مُستلم',
  in_progress: 'قيد التنفيذ',
  awaiting_release: 'بانتظار الإصدار',
  on_hold: 'موقوف مؤقتًا',
}

// حقول معرّفات/تقنية مش مفيدة في العرض
const HIDDEN_FIELDS = new Set([
  'id',
  'worker_id',
  'laptop_id',
  'entry_id',
  'operation_id',
  'created_by',
  'released_by',
  'returned_by',
  'reviewed_by',
  'approved_by',
  'actor_id',
  'qr_token',
  'created_at',
  'updated_at',
])

function humanize(key, value, stageMap) {
  if (value === null || value === undefined || value === '') return '—'
  if (key === 'status' || key === 'role' || key === 'current_status') return VALUE_LABELS[value] ?? String(value)
  if ((key === 'current_stage' || key === 'stage_code') && stageMap?.[value]) return stageMap[value]
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (key.endsWith('_at') || key.endsWith('_date')) {
    const d = new Date(value)
    return isNaN(d) ? String(value) : d.toLocaleString('ar-EG')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function DiffTable({ before, after, stageMap }) {
  const b = before ?? {}
  const a = after ?? {}
  const isUpdate = Boolean(before && after)
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => !HIDDEN_FIELDS.has(k))
  const shown = (isUpdate ? keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])) : keys)
    .filter((k) => b[k] !== undefined || a[k] !== undefined)
    // في الإجراءات اللي ملهاش «قبل» بنخفي القيم الفاضية عشان مانعرضش صفوف ملهاش قيمة
    .filter((k) => isUpdate || (a[k] !== null && a[k] !== undefined && a[k] !== ''))

  if (!shown.length) {
    return <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">مفيش تفاصيل مسجّلة للإجراء ده.</p>
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>الحقل</th>
            {isUpdate && <th>قبل</th>}
            <th>بعد</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((k) => (
            <tr key={k}>
              <td className="whitespace-nowrap text-slate-500">{FIELD_LABELS[k] ?? k}</td>
              {isUpdate && <td className="text-red-600">{humanize(k, b[k], stageMap)}</td>}
              <td className="text-emerald-700">{humanize(k, a[k], stageMap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

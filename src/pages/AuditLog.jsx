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

function actionLabel(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  if (action?.startsWith('advance_stage:')) return `نقل مرحلة: ${action.split(':')[1]}`
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
          'id, entry_date, quantity, status, stage_code, profiles!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(quantity, operations(name_ar)), lap_serials(serial)'
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
        const stage = e.stage_code ? (stageMap[e.stage_code] ?? e.stage_code) : 'سليم'
        const status = e.status === 'released' ? 'مُصدر' : 'معتمد'
        const serials = (e.lap_serials ?? []).map((s) => s.serial)
        if (serials.length) {
          for (const s of serials) out.push([s, e.entry_date, worker, ops, stage, status])
        } else {
          out.push(['—', e.entry_date, worker, ops, stage, status])
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
        headers: ['السيريال', 'التاريخ', 'الموظف', 'العملية', 'الوجهة', 'الحالة'],
        rows: out,
      })
    } catch (err) {
      window.alert(err.message || 'تعذّر تصدير الملف.')
    } finally {
      setExporting(false)
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
                    <span className={`badge ${actionTone(r.action)}`}>{actionLabel(r.action)}</span>
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
  const isEntryReview =
    row.entity === 'production_entries' && String(row.action ?? '').startsWith('review_entry')
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
          <h2 className="text-lg font-bold">{actionLabel(row.action)}</h2>
          <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-sm">إغلاق</button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {row.profiles?.full_name ?? '—'} · {new Date(row.created_at).toLocaleString('ar-EG')} · {row.entity ?? '—'}
        </p>
        {isEntryReview && <EntryLaptops entryId={row.entity_id} after={row.after} stageMap={stageMap} />}
        <DiffTable before={row.before} after={row.after} />
      </div>
    </div>
  )
}

// اللابات (السيريالات) المرتبطة بالإدخال المعتمد
function EntryLaptops({ entryId, after, stageMap }) {
  const [loading, setLoading] = useState(true)
  const [serials, setSerials] = useState([])
  const info = after ?? {}

  useEffect(() => {
    let active = true
    async function load() {
      if (!entryId) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('lap_serials')
        .select('serial')
        .eq('entry_id', entryId)
        .order('created_at')
      if (!active) return
      setSerials((data ?? []).map((s) => s.serial))
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [entryId])

  const stage = info.stage_code ? (stageMap?.[info.stage_code] ?? info.stage_code) : 'سليم'

  return (
    <div className="mb-4 rounded-lg bg-slate-50 p-3">
      <h3 className="mb-2 text-sm font-bold">اللابات في الإدخال ده</h3>
      <p className="mb-2 text-xs text-slate-500">
        العدد: {info.quantity ?? '—'} · الوجهة: {stage}
      </p>
      {loading ? (
        <p className="text-xs text-slate-400">جاري التحميل…</p>
      ) : serials.length ? (
        <div className="flex flex-wrap gap-2">
          {serials.map((s) => (
            <span key={s} dir="ltr" className="rounded bg-white px-2 py-1 font-mono text-xs">
              {s}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">مفيش سيريالات مسجّلة للإدخال ده.</p>
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
  current_status: 'الحالة الحالية',
  current_stage: 'المرحلة الحالية',
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
}

// حقول معرّفات مش مفيدة في العرض
const HIDDEN_FIELDS = new Set(['id', 'worker_id', 'laptop_id', 'created_by', 'released_by', 'returned_by', 'reviewed_by', 'actor_id'])

function humanize(key, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (key === 'status' || key === 'role' || key === 'current_status') return VALUE_LABELS[value] ?? String(value)
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (key.endsWith('_at') || key.endsWith('_date')) {
    const d = new Date(value)
    return isNaN(d) ? String(value) : d.toLocaleString('ar-EG')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function DiffTable({ before, after }) {
  const b = before ?? {}
  const a = after ?? {}
  const isUpdate = Boolean(before && after)
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => !HIDDEN_FIELDS.has(k))
  const shown = (isUpdate ? keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])) : keys).filter(
    (k) => b[k] !== undefined || a[k] !== undefined
  )

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
              {isUpdate && <td className="text-red-600">{humanize(k, b[k])}</td>}
              <td className="text-emerald-700">{humanize(k, a[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

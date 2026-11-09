import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
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
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [from, setFrom] = useState(startOfMonthISO())
  const [to, setTo] = useState(toISODate(new Date()))
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)

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
  }, [from, to])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) =>
      [r.action, r.entity, actionLabel(r.action), r.profiles?.full_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    )
  }, [rows, q])

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
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={filtered.length === 0} className="btn-ghost">
          تصدير Excel
        </button>
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
                <th></th>
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
                  <td data-label="تفاصيل">
                    {(r.before || r.after) && (
                      <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="btn-ghost !px-2 !py-1 text-xs">
                        {openId === r.id ? 'إخفاء' : 'تفاصيل'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && <AuditDetails row={filtered.find((r) => r.id === openId)} onClose={() => setOpenId(null)} />}
    </Layout>
  )
}

function AuditDetails({ row, onClose }) {
  if (!row) return null
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
        <DiffTable before={row.before} after={row.after} />
      </div>
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
}

// قيم ثابتة بالعربي (حالات/أدوار)
const VALUE_LABELS = {
  draft: 'مسودّة',
  submitted: 'مُسلَّم',
  approved: 'معتمد',
  released: 'مُصدر',
  returned: 'مُرتجع',
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

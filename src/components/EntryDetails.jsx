import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, entryLines, entryOperationNames } from '../lib/dates'

// نافذة تفاصيل الإدخال: العملية + السيريالات + الملاحظات
export default function EntryDetails({ entryId, onClose, onApprove }) {
  const [entry, setEntry] = useState(null)
  const [serials, setSerials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      const [e, s] = await Promise.all([
        supabase
          .from('production_entries')
          .select(
            '*, profiles!production_entries_worker_id_fkey(full_name), operations(name_ar, name_en), entry_operations(quantity, operations(name_ar, name_en))'
          )
          .eq('id', entryId)
          .single(),
        supabase.from('lap_serials').select('serial').eq('entry_id', entryId).order('created_at'),
      ])
      if (!active) return

      if (e.error) {
        setError(e.error.message)
        setLoading(false)
        return
      }

      setEntry(e.data)
      setSerials(s.data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [entryId])

  useEffect(() => {
    function onKey(ev) {
      if (ev.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lines = entry ? entryLines(entry) : []
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl md:my-8 md:max-w-2xl md:rounded-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="sticky -top-4 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-100 bg-white px-4 pt-4 md:static md:mx-0 md:border-0 md:px-0 md:pt-0">
          <h2 className="text-lg font-bold">تفاصيل الإدخال</h2>
          <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-sm">
            إغلاق
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-slate-400">جاري التحميل…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {entry && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <Field label="العامل" value={entry.profiles?.full_name ?? '-'} />
              <Field label="التاريخ" value={formatDate(entry.entry_date)} />
              <Field label="الحالة" value={<StatusBadge status={entry.status} />} />
              <Field label="العمليات" value={entryOperationNames(entry)} />
              <Field label="عدد اللابات" value={formatNumber(totalQty)} />
            </div>

            <Section title={`العمليات (${lines.length})`}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>العملية</th>
                      <th>العدد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={`${l.operation_id}-${i}`}>
                        <td>{l.name}</td>
                        <td>{formatNumber(l.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={`السيريالات (${serials.length})`}>
              {serials.length === 0 ? (
                <p className="text-sm text-slate-400">مفيش سيريالات مسجّلة.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {serials.map((s) => (
                    <span
                      key={s.serial}
                      className="badge bg-slate-100 font-mono text-slate-700"
                      dir="ltr"
                    >
                      {s.serial}
                    </span>
                  ))}
                </div>
              )}
            </Section>

            <Section title="الملاحظات">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{entry.notes || '—'}</p>
            </Section>

            {entry.status === 'returned' && (
              <Section title="سبب الإرجاع">
                <p className="whitespace-pre-wrap rounded-lg bg-orange-50 p-3 text-sm text-orange-800">
                  {entry.return_reason || 'المشرف رجّع الإدخال للتعديل (بدون سبب مكتوب).'}
                </p>
              </Section>
            )}

            {onApprove && ['draft', 'submitted'].includes(entry.status) && (
              <button onClick={() => onApprove(entry)} className="btn-primary w-full">
                موافقة واعتماد
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-slate-700">{title}</h3>
      {children}
    </div>
  )
}

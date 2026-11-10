import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import EntryDetails from '../components/EntryDetails'
import { useAuth } from '../context/AuthContext'
import { supabase, fetchAll } from '../lib/supabase'
import { entryOperationNames, entryTotalQty, formatDate, formatNumber } from '../lib/dates'

// أرشيف الموظف: الإدخالات المعتمدة اللي الموظف نقلها من صفحته الرئيسية.
// الحذف هنا بيخفيها عن الموظف بس — مفيش حذف فعلي وبتفضل موجودة عند المشرف/الحسابات.
export default function WorkerArchive() {
  const { user, profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState(null)
  const [detailId, setDetailId] = useState(null)

  async function loadEntries() {
    setLoading(true)
    try {
      // بنسحب على دفعات عشان الأرشيف الكبير مايتقطعش عند 1000 صف
      const rows = await fetchAll(() =>
        supabase
          .from('production_entries')
          .select('*, operations(name_ar, name_en), entry_operations(operation_id, quantity, operations(name_ar))')
          .eq('worker_id', user.id)
          .not('worker_archived_at', 'is', null)
          .is('worker_hidden_at', null)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
      )
      setEntries(rows)
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'حصل خطأ أثناء تحميل الأرشيف.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return
    loadEntries()
  }, [user])

  async function hideEntry(entry) {
    if (
      !window.confirm(
        'تأكيد الحذف النهائي من عندك؟ الإدخال هيتشال نهائيًا من أرشيفك ومن أرقامك، ويفضل موجود عند المشرف والحسابات.'
      )
    )
      return
    setMsg(null)
    setBusyId(entry.id)
    const { error } = await supabase.rpc('fn_worker_hide_entry', { p_entry_id: entry.id })
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: 'تم الحذف النهائي من عندك.' })
    loadEntries()
  }

  return (
    <Layout title="أرشيف إنتاجي">
      <div className="card mb-4">
        <h2 className="font-bold text-lg">أرشيف إنتاجي</h2>
        <p className="mt-1 text-xs text-slate-500">
          أهلاً {profile?.full_name}، هنا الإدخالات اللي نقلتها من صفحتك الرئيسية عشان تخفّف الزحمة.
          «الحذف النهائي» بيشيل الإدخال من عندك نهائيًا (من الأرشيف ومن أرقامك) — وبيفضل موجود عند المشرف والحسابات.
        </p>
      </div>

      {msg && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="card">
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
              {loading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    جاري التحميل…
                  </td>
                </tr>
              )}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    أرشيفك فاضي.
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
                  </td>
                  <td data-label="إجراء" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex gap-2">
                      <button onClick={() => setDetailId(e.id)} className="btn-ghost !px-2 !py-1 text-xs">
                        تفاصيل
                      </button>
                      <button
                        onClick={() => hideEntry(e)}
                        disabled={busyId === e.id}
                        className="btn-danger !px-2 !py-1 text-xs"
                      >
                        {busyId === e.id ? '…' : 'حذف نهائي'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailId && <EntryDetails entryId={detailId} onClose={() => setDetailId(null)} />}
    </Layout>
  )
}

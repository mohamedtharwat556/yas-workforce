import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import EntryDetails from '../components/EntryDetails'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, toISODate, entryOperationNames, entryTotalQty } from '../lib/dates'
import { exportXlsx, exportXlsxSheets } from '../lib/xlsx'

const TABS = [
  { key: 'release', label: 'إدخالات للمراجعة' },
  { key: 'users', label: 'المستخدمون' },
]

export default function SupervisorDashboard() {
  const { user, profile } = useAuth()
  // الأدمن (الحسابات) بس اللي يقدر يمنح دور الحسابات
  const canGrantAdmin = profile?.role === 'accountant'
  const [tab, setTab] = useState('release')
  const [entries, setEntries] = useState([])
  const [users, setUsers] = useState([])
  const [stageMap, setStageMap] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [returning, setReturning] = useState(null)
  const [reason, setReason] = useState('')

  async function loadAll() {
    const [e, u, st] = await Promise.all([
      supabase
        .from('production_entries')
        .select('*, profiles!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(operation_id, quantity, operations(name_ar)), lap_serials(serial, laptop_type, model, stage_code)')
        .in('status', ['draft', 'submitted'])
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('stages').select('code, name_ar'),
    ])
    setEntries(e.data ?? [])
    setUsers(u.data ?? [])
    setStageMap(Object.fromEntries((st.data ?? []).map((s) => [s.code, s.name_ar])))
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function approveEntry(entry) {
    setBusyId(entry.id)
    const { error } = await supabase.rpc('fn_review_entry', {
      p_entry_id: entry.id,
      p_decision: 'approved',
      p_reason: null,
    })
    setBusyId(null)
    if (error) setMsg({ type: 'error', text: error.message })
    else setMsg({ type: 'ok', text: 'تم اعتماد الإدخال — بانتظار إصدار الحسابات.' })
    loadAll()
  }

  async function submitReturn(e) {
    e.preventDefault()
    if (!returning) return
    setBusyId(returning.id)
    const { error } = await supabase.rpc('fn_review_entry', {
      p_entry_id: returning.id,
      p_decision: 'rejected',
      p_reason: reason.trim() || null,
    })
    setBusyId(null)
    if (error) setMsg({ type: 'error', text: error.message })
    else setMsg({ type: 'ok', text: 'تم إرجاع الإدخال للموظف عشان يعدّله.' })
    setReturning(null)
    setReason('')
    loadAll()
  }

  function exportPendingEntries() {
    // ورقة الإدخالات (لكل إدخال) + ورقة تفصيل اللابات (لكل لاب: النوع/الموديل/السيريال/الحالة)
    const laptopRows = entries.flatMap((e) =>
      (e.lap_serials ?? []).map((s) => [
        e.profiles?.full_name ?? '-',
        e.entry_date,
        entryOperationNames(e),
        s.laptop_type ?? '—',
        s.model ?? '—',
        s.serial,
        s.stage_code ? (stageMap[s.stage_code] ?? s.stage_code) : 'سليم',
      ])
    )
    exportXlsxSheets({
      filename: `yas-pending-entries_${toISODate(new Date())}.xlsx`,
      sheets: [
        {
          sheetName: 'إدخالات للمراجعة',
          headers: ['الموظف', 'التاريخ', 'العملية', 'العدد', 'الملاحظة', 'الحالة'],
          rows: entries.map((e) => [
            e.profiles?.full_name ?? '-',
            e.entry_date,
            entryOperationNames(e),
            entryTotalQty(e),
            e.notes ?? '',
            e.status,
          ]),
        },
        {
          sheetName: 'تفصيل اللابات',
          headers: ['الموظف', 'التاريخ', 'العملية', 'نوع اللاب', 'الموديل', 'السيريال', 'الحالة'],
          rows: laptopRows,
        },
      ],
    })
  }

  function exportUsers() {
    exportXlsx({
      filename: `yas-users_${toISODate(new Date())}.xlsx`,
      sheetName: 'المستخدمون',
      headers: ['الاسم', 'الإيميل', 'الدور', 'الحالة', 'تاريخ الإنشاء'],
      rows: users.map((u) => [u.full_name, u.email, u.role, u.status, formatDate(u.created_at)]),
    })
  }

  async function updateUser(id, patch) {
    setBusyId(id)
    setMsg(null)
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    setBusyId(null)
    if (error) setMsg({ type: 'error', text: error.message })
    else setMsg({ type: 'ok', text: 'تم تحديث بيانات المستخدم.' })
    loadAll()
  }

  return (
    <Layout title="لوحة المشرف">
      <div className="flex gap-2 mb-4 overflow-x-auto -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key)
              setMsg(null)
            }}
            className={`${tab === t.key ? 'btn-primary' : 'btn-ghost'} shrink-0 whitespace-nowrap`}
          >
            {t.label}
            {t.key === 'release' && entries.length > 0 && (
              <span className="badge bg-white/20 text-inherit">{entries.length}</span>
            )}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`text-sm rounded-lg p-3 mb-4 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg.text}
        </div>
      )}

      {tab === 'release' && (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-lg">إدخالات في انتظار المراجعة</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {entries.length === 0 ? 'مفيش إدخالات معلّقة' : `${entries.length} إدخال في انتظار اعتماد المشرف`}
              </p>
            </div>
            <button onClick={exportPendingEntries} disabled={entries.length === 0} className="btn-ghost !py-1.5 text-sm">
              تصدير Excel
            </button>
          </div>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>التاريخ</th>
                  <th>العملية</th>
                  <th>العدد</th>
                  <th>الملاحظة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-6">
                      مفيش إدخالات معلّقة
                    </td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(e.id)}>
                    <td data-label="الموظف">{e.profiles?.full_name ?? '-'}</td>
                    <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                    <td data-label="العملية">{entryOperationNames(e)}</td>
                    <td data-label="العدد">{formatNumber(entryTotalQty(e))}</td>
                    <td data-label="الملاحظة" className="max-w-[220px] truncate" title={e.notes ?? ''}>{e.notes || '-'}</td>
                    <td data-label="إجراء" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex gap-2">
                        <button onClick={() => setDetailId(e.id)} className="btn-ghost !py-1 !px-2 text-xs">
                          تفاصيل
                        </button>
                        <button disabled={busyId === e.id} onClick={() => approveEntry(e)} className="btn-primary !py-1 !px-3 text-sm">
                          اعتماد
                        </button>
                        <button
                          disabled={busyId === e.id}
                          onClick={() => setReturning(e)}
                          className="btn-danger !py-1 !px-3 text-sm"
                        >
                          إرجاع
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

      {tab === 'users' && (
        <div className="card">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-lg">إدارة المستخدمين</h2>
            <button onClick={exportUsers} disabled={users.length === 0} className="btn-ghost !py-1.5 text-sm">
              تصدير Excel
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            عدد المستخدمين: {users.length} — تقدر تفعّل/توقف أي حساب أو تغيّر الدور.
          </p>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الإيميل</th>
                  <th>الدور</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">مفيش مستخدمين</td>
                  </tr>
                )}
                {users.map((u) => {
                  const self = u.id === user.id
                  return (
                    <tr key={u.id}>
                      <td data-label="الاسم">
                        {u.full_name}
                        {self && <span className="text-xs text-slate-400"> (إنت)</span>}
                      </td>
                      <td data-label="الإيميل" dir="ltr" className="text-left">{u.email}</td>
                      <td data-label="الدور">
                        <select
                          className="input !w-32 !py-1 text-sm"
                          value={u.role}
                          disabled={busyId === u.id || self}
                          onChange={(e) => updateUser(u.id, { role: e.target.value })}
                        >
                          <option value="worker">موظف</option>
                          <option value="supervisor">مشرف</option>
                          {canGrantAdmin && <option value="accountant">حسابات</option>}
                        </select>
                      </td>
                      <td data-label="الحالة">
                        <StatusBadge status={u.status} />
                      </td>
                      <td data-label="إجراء">
                        <div className="flex gap-2">
                          {u.status !== 'active' && (
                            <button
                              disabled={busyId === u.id}
                              onClick={() => updateUser(u.id, { status: 'active' })}
                              className="btn-accent !py-1 !px-3 text-xs"
                            >
                              تفعيل
                            </button>
                          )}
                          {u.status === 'active' && (
                            <button
                              disabled={busyId === u.id || self}
                              onClick={() => updateUser(u.id, { status: 'inactive' })}
                              className="btn-danger !py-1 !px-3 text-xs"
                            >
                              إيقاف
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {returning && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
          onClick={() => setReturning(null)}
          role="dialog"
          aria-modal="true"
        >
          <form onSubmit={submitReturn} className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl md:my-8 md:max-w-lg md:rounded-xl" onClick={(ev) => ev.stopPropagation()}>
            <h2 className="text-lg font-bold">إرجاع الإدخال للموظف</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              {returning.profiles?.full_name ?? 'الموظف'} — {entryOperationNames(returning)} · العدد {formatNumber(entryTotalQty(returning))}
            </p>
            <label className="label">سبب الإرجاع (اختياري)</label>
            <textarea
              className="input"
              rows={3}
              autoFocus
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder="مثال: عدد اللابات غير مطابق للسيريالات…"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReturning(null)} className="btn-ghost">
                إلغاء
              </button>
              <button type="submit" disabled={busyId === returning.id} className="btn-danger">
                {busyId === returning.id ? 'جاري الإرجاع…' : 'تأكيد الإرجاع'}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailId && (
        <EntryDetails
          entryId={detailId}
          onClose={() => setDetailId(null)}
          onApprove={async (entry) => {
            await approveEntry(entry)
            setDetailId(null)
          }}
        />
      )}
    </Layout>
  )
}

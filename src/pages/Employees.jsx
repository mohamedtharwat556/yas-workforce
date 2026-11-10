import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, toISODate } from '../lib/dates'
import { exportXlsxSheets } from '../lib/xlsx'

export default function Employees() {
  const [workers, setWorkers] = useState([])
  const [entries, setEntries] = useState([])
  const [stageMap, setStageMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [query, setQuery] = useState('')

  async function loadAll() {
    setLoading(true)
    const [w, e, st] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, status').eq('role', 'worker').order('full_name'),
      supabase
        .from('production_entries')
        .select(
          'id, worker_id, entry_date, status, profiles!production_entries_worker_id_fkey(full_name), lap_serials(serial, laptop_type, model, stage_code, maintenance_status)'
        ),
      supabase.from('stages').select('code, name_ar'),
    ])
    setWorkers(w.data ?? [])
    setEntries(e.data ?? [])
    setStageMap(Object.fromEntries((st.data ?? []).map((s) => [s.code, s.name_ar])))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  // كل اللابات مع اسم الموظف اللي سجّلها
  const laptops = useMemo(() => {
    const rows = []
    for (const e of entries) {
      for (const s of e.lap_serials ?? []) {
        rows.push({
          worker_id: e.worker_id,
          worker_name: e.profiles?.full_name ?? '—',
          entry_date: e.entry_date,
          status: e.status,
          serial: s.serial,
          laptop_type: s.laptop_type,
          model: s.model,
          stage_code: s.stage_code,
          maintenance_status: s.maintenance_status,
        })
      }
    }
    return rows.sort((a, b) => (b.entry_date ?? '').localeCompare(a.entry_date ?? ''))
  }, [entries])

  // إحصائيات كل موظف: عدد اللابات + سليم + تحت الصيانة + آخر إدخال
  const stats = useMemo(() => {
    const map = {}
    for (const w of workers) map[w.id] = { worker: w, total: 0, healthy: 0, maintenance: 0, lastDate: null }
    for (const l of laptops) {
      const st = map[l.worker_id]
      if (!st) continue
      st.total += 1
      if (l.stage_code) st.maintenance += 1
      else st.healthy += 1
      if (l.entry_date && (!st.lastDate || l.entry_date > st.lastDate)) st.lastDate = l.entry_date
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [workers, laptops])

  const q = query.trim().toLowerCase()

  // اللابات الظاهرة حسب فلتر الموظف + البحث (اسم الموظف أو السيريال)
  const filteredLaptops = useMemo(
    () =>
      laptops.filter((l) => {
        if (employeeId && l.worker_id !== employeeId) return false
        if (!q) return true
        return (l.serial ?? '').toLowerCase().includes(q) || (l.worker_name ?? '').toLowerCase().includes(q)
      }),
    [laptops, employeeId, q]
  )

  // الموظفون الظاهرون: حسب الفلتر + البحث؛ لو البحث بسيريال بنعرض الموظف اللي عنده السيريال ده
  const filteredStats = useMemo(
    () =>
      stats.filter((s) => {
        if (employeeId && s.worker.id !== employeeId) return false
        if (!q) return true
        if ((s.worker.full_name ?? '').toLowerCase().includes(q)) return true
        return filteredLaptops.some((l) => l.worker_id === s.worker.id)
      }),
    [stats, employeeId, q, filteredLaptops]
  )

  const totals = useMemo(
    () =>
      filteredStats.reduce(
        (acc, s) => ({ total: acc.total + s.total, maintenance: acc.maintenance + s.maintenance }),
        { total: 0, maintenance: 0 }
      ),
    [filteredStats]
  )

  function statusLabel(l) {
    if (l.stage_code) return { text: stageMap[l.stage_code] ?? l.stage_code, cls: 'bg-amber-100 text-amber-800' }
    if (l.maintenance_status === 'returned_to_worker') return { text: 'رجع من الصيانة', cls: 'bg-blue-100 text-blue-700' }
    return { text: 'سليم', cls: 'bg-emerald-100 text-emerald-700' }
  }

  // تصدير Excel — بيصدّر الظاهر حاليًا (كل الموظفين أو موظف واحد مفلتر + نتيجة البحث)
  function exportExcel() {
    const scope = employeeId ? workers.find((w) => w.id === employeeId)?.full_name ?? 'موظف' : 'كل الموظفين'
    exportXlsxSheets({
      filename: `yas-employees_${toISODate(new Date())}.xlsx`,
      sheets: [
        {
          sheetName: 'الموظفين',
          title: `تقرير الموظفين — ${scope}`,
          headers: ['الموظف', 'عدد اللابات', 'سليم', 'تحت الصيانة', 'آخر إدخال'],
          rows: filteredStats.map((s) => [
            s.worker.full_name ?? '-',
            s.total,
            s.healthy,
            s.maintenance,
            s.lastDate ?? '-',
          ]),
        },
        {
          sheetName: 'اللابات',
          title: `لابات الموظفين — ${scope}`,
          headers: ['الموظف', 'السيريال', 'نوع اللاب', 'الموديل', 'الحالة', 'التاريخ'],
          rows: filteredLaptops.map((l) => [
            l.worker_name,
            l.serial,
            l.laptop_type ?? '—',
            l.model ?? '—',
            statusLabel(l).text,
            l.entry_date ?? '-',
          ]),
        },
      ],
    })
  }

  return (
    <Layout title="الموظفين">
      <div className="card mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-1">
            <label className="label">الموظف</label>
            <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">كل الموظفين</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">بحث</label>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اسم الموظف أو سيريال اللاب"
            />
          </div>
          <div className="md:col-span-1 flex items-end">
            <button onClick={exportExcel} disabled={filteredLaptops.length === 0} className="btn-accent w-full">
              تصدير Excel
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="badge bg-slate-100 text-slate-600">{filteredStats.length} موظف</span>
          <span className="badge bg-slate-100 text-slate-600">{formatNumber(totals.total)} لاب</span>
          <span className="badge bg-amber-100 text-amber-800">{formatNumber(totals.maintenance)} تحت الصيانة</span>
          {(employeeId || query) && (
            <button
              onClick={() => {
                setEmployeeId('')
                setQuery('')
              }}
              className="btn-ghost !py-1 !px-2 text-xs"
            >
              مسح الفلتر
            </button>
          )}
        </div>
      </div>

      {/* الموظفون + عدد لابات كل واحد */}
      <div className="card mb-6">
        <h2 className="font-bold text-lg mb-3">الموظفون</h2>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>الموظف</th>
                <th>عدد اللابات</th>
                <th>سليم</th>
                <th>تحت الصيانة</th>
                <th>آخر إدخال</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 py-6">
                    جاري التحميل…
                  </td>
                </tr>
              )}
              {!loading && filteredStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 py-6">
                    مفيش موظفين مطابقين
                  </td>
                </tr>
              )}
              {filteredStats.map((s) => (
                <tr
                  key={s.worker.id}
                  className={`cursor-pointer hover:bg-slate-50 ${employeeId === s.worker.id ? 'bg-blue-50' : ''}`}
                  onClick={() => setEmployeeId(employeeId === s.worker.id ? '' : s.worker.id)}
                >
                  <td data-label="الموظف">{s.worker.full_name ?? '-'}</td>
                  <td data-label="عدد اللابات">{formatNumber(s.total)}</td>
                  <td data-label="سليم">{formatNumber(s.healthy)}</td>
                  <td data-label="تحت الصيانة">
                    {s.maintenance > 0 ? (
                      <span className="badge bg-amber-100 text-amber-800">{formatNumber(s.maintenance)}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td data-label="آخر إدخال">{s.lastDate ? formatDate(s.lastDate) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* تفاصيل اللابات */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-lg">اللابات</h2>
          <p className="text-xs text-slate-500">
            {filteredLaptops.length === 0 ? 'مفيش لابات مطابقة' : `${formatNumber(filteredLaptops.length)} لاب`}
          </p>
        </div>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>الموظف</th>
                <th>السيريال</th>
                <th>نوع اللاب</th>
                <th>الموديل</th>
                <th>الحالة</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {filteredLaptops.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-6">
                    مفيش لابات مطابقة
                  </td>
                </tr>
              )}
              {filteredLaptops.map((l, i) => {
                const st = statusLabel(l)
                return (
                  <tr key={`${l.serial}-${i}`}>
                    <td data-label="الموظف">{l.worker_name}</td>
                    <td data-label="السيريال" dir="ltr" className="text-left font-mono text-sm">
                      {l.serial}
                    </td>
                    <td data-label="نوع اللاب">{l.laptop_type || '—'}</td>
                    <td data-label="الموديل">{l.model || '—'}</td>
                    <td data-label="الحالة">
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </td>
                    <td data-label="التاريخ">{l.entry_date ? formatDate(l.entry_date) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}

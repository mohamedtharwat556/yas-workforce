// تقرير PDF: يُبنى كصفحة HTML منسّقة (RTL) ثم تُفتح نافذة الطباعة
// المستخدم يختار "حفظ كـ PDF" من نافذة الطباعة — الطريقة الأضمن لدعم العربي.

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function fmt(n) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(n) || 0)
}

function fmtDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function printReport({
  title,
  period,
  currency = 'EGP',
  totals,
  rows = [],
  byOperation = [],
  rowsTitle = 'الإنتاجية والحافز لكل عامل',
  rowsLabel = 'العامل',
}) {
  const win = window.open('', '_blank', 'width=1000,height=760')
  if (!win) {
    window.alert('من فضلك اسمح بالنوافذ المنبثقة (Pop-ups) عشان نقدر نصدّر الـ PDF.')
    return
  }

  const workerRows = rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td class="name">${esc(r.name)}</td><td>${fmt(r.laps)}</td><td>${fmt(
          r.units
        )}</td><td class="money">${fmt(r.incentive)}</td></tr>`
    )
    .join('')

  const opRows = byOperation
    .map((o) => `<tr><td class="name">${esc(o.name)}</td><td>${fmt(o.laps)}</td><td>${fmt(o.units)}</td></tr>`)
    .join('')

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 22px; font-weight: 800; }
  .brand small { display: block; font-size: 12px; font-weight: 400; color: #64748b; margin-top: 2px; }
  .meta { text-align: left; font-size: 12px; color: #475569; line-height: 1.7; }
  h1 { font-size: 18px; margin: 0 0 14px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .cards { display: flex; gap: 12px; margin-bottom: 6px; }
  .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; background: #f8fafc; }
  .card .lbl { font-size: 12px; color: #64748b; }
  .card .val { font-size: 22px; font-weight: 800; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 7px 9px; text-align: right; }
  th { background: #1d4ed8; color: #fff; font-weight: 600; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .money { font-weight: 700; }
  .total-row td { background: #e2e8f0; font-weight: 800; }
  .foot { margin-top: 26px; font-size: 11px; color: #94a3b8; text-align: center; }
  @page { size: A4; margin: 14mm; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">YAS Workforce<small>نظام الإنتاجية والحوافز</small></div>
    <div class="meta">
      الفترة: ${esc(period?.start ?? '-')} ← ${esc(period?.end ?? '-')}<br />
      تاريخ الإصدار: ${esc(new Date().toLocaleString('ar-EG'))}
    </div>
  </div>

  <h1>${esc(title)}</h1>

  <div class="cards">
    <div class="card"><div class="lbl">إجمالي اللابات</div><div class="val">${fmt(totals?.laps)}</div></div>
    <div class="card"><div class="lbl">الوحدات المرجّحة</div><div class="val">${fmt(totals?.units)}</div></div>
    <div class="card"><div class="lbl">إجمالي الحافز (${esc(currency)})</div><div class="val">${fmt(totals?.incentive)}</div></div>
  </div>

  <h2>${esc(rowsTitle)}</h2>
  <table>
    <thead>
      <tr><th>#</th><th>${esc(rowsLabel)}</th><th>عدد اللابات</th><th>الوحدات المرجّحة</th><th>الحافز (${esc(currency)})</th></tr>
    </thead>
    <tbody>
      ${workerRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">لا توجد بيانات في الفترة</td></tr>'}
      ${
        rows.length
          ? `<tr class="total-row"><td colspan="2">الإجمالي</td><td>${fmt(totals?.laps)}</td><td>${fmt(
              totals?.units
            )}</td><td>${fmt(totals?.incentive)}</td></tr>`
          : ''
      }
    </tbody>
  </table>

  <h2>التفصيل حسب نوع العملية</h2>
  <table>
    <thead>
      <tr><th>العملية</th><th>عدد اللابات</th><th>الوحدات المرجّحة</th></tr>
    </thead>
    <tbody>
      ${opRows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8">لا توجد بيانات في الفترة</td></tr>'}
    </tbody>
  </table>

  <div class="foot">تم إنشاء هذا التقرير آليًا من نظام YAS Workforce</div>

  <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };</script>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  // احتياطي لو onload ما اشتغلش
  setTimeout(() => {
    try {
      win.print()
    } catch {
      /* المتصفح طبّع تلقائيًا */
    }
  }, 800)
}

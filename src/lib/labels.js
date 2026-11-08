// توليد ملصقات QR + باركود (Code128) للابات + صفحة طباعة A4
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'

// الرابط اللي بيتحط جوه الـ QR — يفتح مسار اللاب مباشرة بعد المسح
export function laptopUrl(token) {
  return `${window.location.origin}/l/${token}`
}

// تحويل نص QR لصورة (data URL)
export async function makeQrDataUrl(text, size = 240) {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: size })
}

// توليد باركود Code128 للسيريال (data URL)
export function makeBarcodeDataUrl(text, { width = 2, height = 40 } = {}) {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, String(text ?? ''), {
    format: 'CODE128',
    displayValue: false,
    width,
    height,
    margin: 0,
  })
  return canvas.toDataURL('image/png')
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// يفتح نافذة طباعة فيها ملصقات جاهزة (كل ملصق: QR + سيريال + باركود)
export function printLabels(labels, { title = 'ملصقات لابات YAS' } = {}) {
  const win = window.open('', '_blank', 'width=900,height=760')
  if (!win) {
    window.alert('من فضلك اسمح بالنوافذ المنبثقة (Pop-ups) عشان نقدر نطبع الملصقات.')
    return
  }

  const cells = labels
    .map(
      (l) => `
      <div class="label">
        <img class="qr" src="${l.qr}" alt="QR" />
        <div class="info">
          <div class="serial">${esc(l.serial)}</div>
          ${l.barcode ? `<img class="bar" src="${l.barcode}" alt="${esc(l.serial)}" />` : ''}
          ${l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ''}
        </div>
      </div>`
    )
    .join('')

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 8mm; color: #0f172a; }
  h1 { font-size: 15px; margin: 0 0 6mm; }
  .labels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .label { display: flex; align-items: center; gap: 5px; height: 34mm; padding: 5px;
           border: 1px dashed #94a3b8; border-radius: 6px; page-break-inside: avoid; }
  .qr { width: 26mm; height: 26mm; flex: 0 0 auto; }
  .info { min-width: 0; flex: 1; }
  .serial { font-weight: 800; font-size: 12px; direction: ltr; text-align: left; white-space: nowrap; overflow: hidden; }
  .bar { width: 100%; height: 9mm; object-fit: contain; margin: 2px 0; }
  .sub { font-size: 10px; color: #475569; white-space: nowrap; overflow: hidden; }
  @page { size: A4; margin: 8mm; }
</style>
</head>
<body>
  <h1>${esc(title)} — ${esc(new Date().toLocaleDateString('ar-EG'))}</h1>
  <div class="labels">${cells}</div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => {
    try {
      win.print()
    } catch {
      /* المتصفح طبّع تلقائيًا */
    }
  }, 900)
}

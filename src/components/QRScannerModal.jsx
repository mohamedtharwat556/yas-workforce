import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const REGION_ID = 'yas-qr-scan-region'

// نافذة مسح QR بكاميرا الموبايل — بترجّع النص الممسوح للمكوّن الأب
export default function QRScannerModal({ onClose, onResult }) {
  const [error, setError] = useState('')
  const scannerRef = useRef(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const scanner = new Html5Qrcode(REGION_ID)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          if (doneRef.current) return
          doneRef.current = true
          onResult(text)
        },
        () => {
          /* تجاهل أخطاء الإطارات اللي مفيش فيها كود */
        }
      )
      .catch((e) => setError(e?.message || 'تعذّر تشغيل الكاميرا — اتأكد من السماح للمتصفح.'))

    return () => {
      const s = scannerRef.current
      if (!s) return
      s.stop()
        .then(() => s.clear())
        .catch(() => {})
    }
  }, [onResult])

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 md:items-center md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card w-full max-w-md rounded-b-none rounded-t-2xl md:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1">مسح QR للاب</h2>
        <p className="text-sm text-slate-500 mb-3">وجّه الكاميرا ناحية ملصق الـ QR.</p>
        <div id={REGION_ID} className="overflow-hidden rounded-lg bg-black min-h-[240px]" />
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-ghost">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}

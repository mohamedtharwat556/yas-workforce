import { useEffect, useRef, useState } from 'react'

// تنسيقات الباركود/QR المتوقعة على ملصقات السيريال
const FORMATS = [
  'code_128',
  'code_39',
  'code_93',
  'ean_13',
  'ean_8',
  'itf',
  'codabar',
  'upc_a',
  'upc_e',
  'qr_code',
  'data_matrix',
  'pdf417',
]

// هل المتصفح بيدعم قراءة الباركود أصلاً؟ (كروم/إيدج على أندرويد)
export const SCAN_SUPPORTED = typeof window !== 'undefined' && 'BarcodeDetector' in window

// نافذة مسح السيريال بالكاميرا — بتقرأ الباركود/QR وترجّع القيمة لوحدها
export default function SerialScanner({ onDetected, onClose, title = 'مسح السيريال بالكاميرا' }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(0)
  const doneRef = useRef(false)
  const onDetectedRef = useRef(onDetected)
  const [error, setError] = useState('')

  onDetectedRef.current = onDetected

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!SCAN_SUPPORTED) {
        setError('المسح بالكاميرا مش مدعوم في المتصفح ده. استخدم كروم على أندرويد، أو اكتب السيريال يدويًا.')
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('مش قادر أوصل للكاميرا على الجهاز ده.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }

        // بنفلتر التنسيقات المدعومة على الجهاز قبل ما نبني الكاشف
        let formats = FORMATS
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats()
          formats = FORMATS.filter((f) => supported.includes(f))
        } catch {
          // بنكمّل بالتنسيقات الافتراضية
        }
        let detector
        try {
          detector = new window.BarcodeDetector(formats.length ? { formats } : undefined)
        } catch {
          detector = new window.BarcodeDetector()
        }

        const tick = async () => {
          if (cancelled || doneRef.current || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const value = codes?.[0]?.rawValue?.trim()
            if (value) {
              doneRef.current = true
              onDetectedRef.current?.(value)
              return
            }
          } catch {
            // أخطاء الإطار الواحد بتتجاهل ونكمّل
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        setError('مش قادر أفتح الكاميرا. اتأكد إنك سمحت للتطبيق بالوصول للكاميرا.')
      }
    }

    start()
    document.body.classList.add('no-scroll')
    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      document.body.classList.remove('no-scroll')
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-sm">
            إغلاق
          </button>
        </div>
        <div className="p-4">
          {error ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} className="h-64 w-full object-cover" playsInline muted autoPlay />
                <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500/80" />
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">
                وجّه الكاميرا على باركود أو QR السيريال — بيتسجّل لوحده أول ما يتقرأ.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

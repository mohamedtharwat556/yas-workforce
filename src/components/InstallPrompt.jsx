import { useEffect, useState } from 'react'

// بانر "ثبّت التطبيق" — بيظهر لما المتصفح يسمح بالتثبيت (أندرويد/كروم أساسًا)
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // لو التطبيق مثبّت بالفعل أو المستخدم قافله قبل كده
    if (window.matchMedia?.('(display-mode: standalone)').matches) return
    if (localStorage.getItem('yas:installHidden') === '1') return

    function onPrompt(e) {
      e.preventDefault()
      setDeferred(e)
      setVisible(true)
    }
    function onInstalled() {
      setVisible(false)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!deferred) return
    deferred.prompt()
    try {
      await deferred.userChoice
    } catch {
      // تجاهل
    }
    setDeferred(null)
    setVisible(false)
  }

  function hide() {
    localStorage.setItem('yas:installHidden', '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 md:inset-x-auto md:bottom-4 md:left-4 md:w-80">
      <div className="rounded-xl bg-blue-700 p-3 text-white shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">ثبّت تطبيق YAS على تليفونك</p>
          <button onClick={hide} className="shrink-0 text-blue-100" aria-label="إخفاء">
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-blue-100">
          هيفتح أسرع زي أي تطبيق، وتقدر تدخل إنتاجك على طول.
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={install} className="btn-accent flex-1 !py-2 text-sm">
            تثبيت
          </button>
          <button onClick={hide} className="btn-ghost flex-1 !py-2 text-sm">
            بعدين
          </button>
        </div>
      </div>
    </div>
  )
}

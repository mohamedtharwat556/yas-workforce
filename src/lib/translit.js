// أدوات لتوليد اسم مستخدم (username) من الاسم العربي + باسورد ثابت

// خريطة تحويل الحروف العربية للإنجليزي (تقريبية ومقروءة)
const MAP = {
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ٱ: 'a', ى: 'a', ة: 'a', ء: '',
  ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', و: 'w', ي: 'y', ؤ: 'w', ئ: 'y',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
}

// يحوّل الاسم العربي لحروف إنجليزي بحروف صغيرة
export function translit(name) {
  return String(name ?? '')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // شيل التشكيل والتطويل
    .split('')
    .map((ch) => (MAP[ch] !== undefined ? MAP[ch] : ch))
    .join('')
}

// يبني اسم مستخدم من الاسم الكامل (الاسم الأول.باقي الاسم)، ويضمن إنه مش مكرر
export function buildUsername(fullName, taken = []) {
  const takenSet = new Set((taken ?? []).map((u) => String(u).toLowerCase()))
  const parts = translit(fullName)
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean)

  const base = (parts.length ? parts.join('.') : 'user').slice(0, 26)
  let username = base
  let i = 2
  while (takenSet.has(username)) {
    username = `${base}${i++}`
  }
  return username
}

// الإيميل اللي Supabase Auth بيتعامل بيه (الاسم@yas.local)
export function emailFor(username) {
  const u = String(username ?? '').trim().toLowerCase()
  return `${u}@yas.local`
}

// الباسورد الثابت: yas + آخر 4 أرقام من رقم الموبايل
export function buildPassword(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  const last4 = digits.slice(-4).padStart(4, '0')
  return `yas${last4}`
}

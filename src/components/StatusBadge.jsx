export const STATUS_MAP = {
  // حالات الإدخال
  draft: ['bg-amber-100 text-amber-800', 'مسودّة'],
  submitted: ['bg-blue-100 text-blue-800', 'مُقدَّم للمراجعة'],
  approved: ['bg-indigo-100 text-indigo-800', 'معتمد'],
  released: ['bg-emerald-100 text-emerald-800', 'مُصدر'],
  returned: ['bg-orange-100 text-orange-800', 'مُرجّع'],
  archived: ['bg-slate-200 text-slate-600', 'مؤرشف'],
  // حالات اللاب
  received: ['bg-sky-100 text-sky-800', 'مستلم'],
  in_progress: ['bg-amber-100 text-amber-800', 'تحت التنفيذ'],
  awaiting_release: ['bg-violet-100 text-violet-800', 'بانتظار الإصدار'],
  on_hold: ['bg-slate-200 text-slate-600', 'معلّق'],
  // حالات الحساب
  pending: ['bg-amber-100 text-amber-800', 'قيد الانتظار'],
  active: ['bg-emerald-100 text-emerald-800', 'نشط'],
  inactive: ['bg-slate-200 text-slate-600', 'موقوف'],
  rejected: ['bg-red-100 text-red-700', 'مرفوض'],
}

export default function StatusBadge({ status }) {
  const [cls, text] = STATUS_MAP[status] ?? ['bg-slate-100 text-slate-600', status]
  return <span className={`badge ${cls}`}>{text}</span>
}

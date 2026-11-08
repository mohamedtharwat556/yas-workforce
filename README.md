# YAS Workforce

نظام تسجيل إنتاجية اللابات للموظفين + تقارير أسبوعية/شهرية + حافز مرجّح + تحليل بالذكاء الاصطناعي.

**React (Vite) + Tailwind + Supabase.** بدون Backend مخصص.

---

## المتطلبات

- Node.js 18+
- حساب Supabase (مجاني يكفي للبداية)

## 1) إعداد Supabase

1. اعمل مشروع جديد على [supabase.com](https://supabase.com).
2. من **SQL Editor** → New query → شغّل ملفات `supabase/` بالترتيب:
   - [schema.sql](supabase/schema.sql) — الجداول الأساسية + RLS + أنواع العمليات + بكت الصور.
   - [phase1-foundation.sql](supabase/phase1-foundation.sql) — مسار اللاب + الأدوار الأربعة + دوال RPC.
   - [phase2-accounting.sql](supabase/phase2-accounting.sql) — محرك الحافز + الفترات + الأوديت.
   - [phase3-notifications.sql](supabase/phase3-notifications.sql) — الإشعارات داخل التطبيق.
   - [phase3-realtime.sql](supabase/phase3-realtime.sql) — تفعيل التحديث اللحظي.
3. من **Project Settings → API** انسخ:
   - `Project URL`
   - `anon public key`

> **مهم:** من **Authentication → Providers → Email** اقفل خيار **Confirm email** عند إنشاء الحسابات
> (كده الموظف يقدر يدخل فورًا بعد إنشاء حسابه من صفحة إدارة الحسابات).

## 2) إنشاء أول حساب مشرف

1. من **Supabase Dashboard → Authentication → Users → Add user** أنشئ مستخدم بالإيميل والباسورد
   (هيتعمل له صف في `profiles` تلقائيًا بحالة `pending` عن طريق الـ trigger).
2. حوّل الحساب لمشرف من SQL Editor:

```sql
update public.profiles
set role = 'supervisor', status = 'active'
where email = 'your-supervisor@yas.com';
```

3. سجّل دخول بحساب المشرف → أنشئ باقي الحسابات (عمال/حسابات/إدارة) من صفحة **إدارة الحسابات**.

### إنشاء باقي الحسابات

بعد ما تدخل بحساب المشرف، افتح **إدارة الحسابات** من القائمة → اكتب اسم الموظف ورقم الموبايل،
والنظام يولّد اسم المستخدم والباسورد تلقائيًا ويضيف الحساب نشط مباشرة (عن طريق دالة `admin_create_user`).

> التسجيل العام (self-signup) **مقفول** — كل الحسابات بتُنشأ من صفحة إدارة الحسابات.

## 3) إعداد الفرونت

```bash
# انسخ ملف البيئة
copy .env.example .env     # ويندوز
# أو: cp .env.example .env  # ماك/لينكس
```

حط القيم في `.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxx
```

```bash
npm install
npm run dev
```

هيفتح على `http://localhost:5173`.

## 4) دالة الذكاء الاصطناعي (لتقرير AI)

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set GEMINI_API_KEY=...   # من https://aistudio.google.com/app/apikey
supabase functions deploy ai-analysis
```

- بتستخدم **Google Gemini** (الموديل الافتراضي `gemini-2.5-flash`، قابل للتغيير بمتغير `GEMINI_MODEL`).
- الدالة بتتحقق من دور المستخدم (مشرف/حسابات) قبل ما تشتغل، وبتخزّن كل تقرير في جدول `ai_insights`.

## 5) التحديث اللحظي (Realtime)

شغّل [supabase/phase3-realtime.sql](supabase/phase3-realtime.sql) في SQL Editor لتفعيل التحديث اللحظي
على جداول `notifications` / `laptops` / `production_entries` (من غيرها الجرس واللوحات بتعتمد على تحديث دوري).

## هيكل المشروع

```
src/
  lib/supabase.js            عميل Supabase
  lib/dates.js               حسابات التواريخ + الوحدات المرجّحة
  lib/xlsx.js                تصدير Excel
  lib/report.js              تقارير PDF/طباعة
  lib/labels.js              ملصقات QR/باركود
  context/AuthContext.jsx    المصادقة والحالة (+ تغيير كلمة المرور)
  components/                Layout / ProtectedRoute / NotificationBell / QRScannerModal
  pages/
    Login.jsx                دخول
    Pending.jsx              انتظار موافقة المشرف
    ChangePassword.jsx       تغيير كلمة المرور
    WorkerDashboard.jsx      إدخال إنتاجي اليومي + ملاحظات + صور + سيريال يدوي
    WorkerIncentives.jsx     حوافز العامل
    SupervisorDashboard.jsx  الموافقات + الإصدار + الأوزان
    AccountantDashboard.jsx  التقارير + الحافز + AI
    IncentiveLocks.jsx       اعتماد/إغلاق فترات الحوافز + التسويات
    EmployeeAccounts.jsx     إنشاء وإدارة الحسابات
    LaptopJourney.jsx        مسار اللاب (Timeline)
    LaptopQR.jsx             طباعة ملصقات A4
    ScanLanding.jsx          صفحة الوصول عبر QR
    ManagementDashboard.jsx  لوحة الإدارة + التحليلات المتقدمة
    AuditLog.jsx             سجل الأوديت
supabase/
  schema.sql                 الجداول والصلاحيات
  phase1-foundation.sql      جداول ومسار اللاب + RPC
  phase2-accounting.sql      محرك الحافز + الفترات + الأوديت
  phase3-notifications.sql   الإشعارات داخل التطبيق
  phase3-realtime.sql        تفعيل التحديث اللحظي
  functions/ai-analysis/     دالة التحليل (Gemini)
```

## الأدوار

| الدور | يقدر يعمل إيه |
|---|---|
| worker | يدخل إنتاجه اليومي، ويشوف إنتاجه هو فقط |
| supervisor | يوافق على الحسابات والإدخالات، يعتمد اللابات للإصدار، يعدّل الأوزان وسعر الوحدة |
| accountant | التقارير والحوافز، إصدار اللابات، إغلاق/فتح الفترات والتسويات، التحليل بالـ AI |
| management | لوحة الإدارة والتحليلات المتقدمة — **قراءة فقط** |

## معادلة الحافز

```
وحدات مرجّحة = Σ (عدد اللابات × وزن العملية)
الحافز       = الوحدات المرجّحة × سعر الوحدة
```

يُحتسب فقط على الإدخالات بحالة **released**.

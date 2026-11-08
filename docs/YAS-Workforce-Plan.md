# YAS Workforce — وثيقة التنفيذ النهائية

نظام تسجيل إنتاجية اللابات (Labs) للموظفين + تقارير أسبوعية/شهرية + تحليل ذكي.
الهدف: مسؤول الحسابات يفتح داشبورد واحدة، يشوف كل العمال عملوا كام لاب، ويطلع تقرير شهري/أسبوعي جاهز — بدون Excel وبدون شغل يدوي.

---

## 1. القرارات المعتمدة (نهائي)

| البند | القرار |
|---|---|
| طريقة التسجيل | **Individual** — كل موظف يسجّل بنفسه (مفتوح داخل الشركة) |
| الاعتماد | **Supervisor** — المشرف **وحده** يوافق على حسابات الموظفين ويراجع الإدخالات |
| الحافز | **Weighted** — حافز مرجّح لكل نوع عملية، يُحسب بـ **Formula** |
| تتبّع اللابات | **Serial** — بكل لاب رقم Serial، والتتبّع **Both** (عند الاستلام + عند الإصدار) |
| الأقسام | **One** — قسم واحد فقط، مفيش تفرّع أقسام |
| عدد المشرفين | **One** — مشرف واحد |
| احتساب الإنتاج | **Release** — اللاب يُحسب إنتاجية عند الإصدار (Release) فقط |
| موضوع النقاط/الـ Gamification | **ملغي** — أُزيل بالكامل. التركيز على الإنتاجية + الحافز + التقارير |

> ملاحظة مهمة: الـ "النقاط" اللي كانت موجودة اتشالت. اللي فاضل هو **الحافز المرجّح** بس، ويعني حساب مالي/إنتاجي واضح — مش نظام تحفيز نفسي.

---

## 2. المستخدمون والصلاحيات

| الدور | مين | الصلاحيات |
|---|---|---|
| **Worker** (عامل) | ~40 موظف | يسجّل دخول، يدخل إنتاجه اليومي، يضيف ملاحظات وصور، يشوف إنتاجه هو فقط |
| **Supervisor** (مشرف) | شخص واحد | يوافق على الحسابات الجديدة، يصدر (Release) الإدخالات، يشوف إنتاجية كل العمال، يعدّل الأوزان |
| **Accountant** (حسابات) | شخص/اثنين | يشوف الداشبورد الكاملة، التقارير الأسبوعية/الشهرية، الحوافز المحسوبة، تقارير الـ AI (قراءة فقط) |

**بوابة الدخول:** أي موظف يخش بـ **إيميل + باسورد** بسيط (مثال: `mohamed@yas.com` / `mohamed123`).
مفيش Backend مخصص — **Supabase Auth** هو اللي شايل الموضوع.

---

## 3. تدفّق العمل (Flows)

### 3.1 تسجيل حساب جديد
1. الموظف يفتح الموقع → "تسجيل جديد".
2. يدخل: الاسم، الإيميل، الباسورد.
3. الحساب يتخزّن بحالة `pending`.
4. **المشرف** يفتح صفحة "طلبات التسجيل" → يوافق أو يرفض.
5. بعد الموافقة الحالة تبقى `active` ويقدر يخش ويسجّل إنتاجه.

### 3.2 إدخال إنتاج يومي (Worker)
1. يسجّل دخول → صفحة "إنتاجي اليوم".
2. يختار نوع العملية (Test خفيف / Test تقيل / صيانة خفيفة / صيانة تقيلة / تجميع …).
3. يدخل **عدد اللابات** + **السيريالات** (Serial لكل لاب).
4. يضيف ملاحظة (اختياري) + صور (اختياري).
5. يحفظ → الحالة `draft` (مسودّة) لحد ما المشرف يعمل **Release** → تبقى `released` وتُحتسب إنتاجية.

### 3.3 مراجعة وإصدار (Supervisor)
1. يشوف كل الإدخالات المعلّقة.
2. يعمل Release أو يرجّع للموظف بتصحيح.
3. اللحظة دي الإنتاجية **تُحتسب** وتدخل التقارير والحافز.

### 3.4 تقرير (Accountant)
1. يفتح الداشبورد → فلتر (هذا الأسبوع / هذا الشهر / موظف معيّن).
2. يشوف: عدد اللابات لكل موظف، إجماليات، الحافز المتوقّع.
3. يضغط "تقرير AI" → تحليل تلقائي مكتوب بالعربي + ملخّص الملاحظات.

---

## 4. نموذج البيانات (Supabase / Postgres)

```sql
-- 1) البروفايلات (مربوطة بـ auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'worker',      -- worker | supervisor | accountant
  status text not null default 'pending',   -- pending | active | rejected
  supervisor_id uuid references profiles(id),
  created_at timestamptz default now()
);

-- 2) أنواع العمليات + وزن كل عملية (Weighted)
create table operations (
  id serial primary key,
  name_ar text not null,          -- "Test خفيف"
  name_en text not null,          -- "light_test"
  weight numeric not null,        -- وزن الحافز
  active boolean default true
);

-- 3) إدخال إنتاجي يومي
create table production_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references profiles(id) not null,
  operation_id int references operations(id) not null,
  entry_date date not null,
  quantity int not null,                     -- عدد اللابات
  notes text,
  status text not null default 'draft',      -- draft | released
  released_by uuid references profiles(id),
  released_at timestamptz,
  created_at timestamptz default now()
);

-- 4) السيريالات (Serial: both — استلام + إصدار)
create table lap_serials (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references production_entries(id) on delete cascade,
  serial text not null,
  direction text not null,        -- in (استلام) | out (إصدار)
  created_at timestamptz default now()
);

-- 5) المرفقات (صور/ملفات)
create table attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references production_entries(id) on delete cascade,
  storage_path text not null,
  file_type text,
  created_at timestamptz default now()
);

-- 6) قواعد الحافز (Formula)
create table incentive_rules (
  id serial primary key,
  unit_rate numeric not null default 1,   -- سعر الوحدة المرجّحة
  period text not null default 'monthly',
  updated_at timestamptz default now()
);

-- 7) تقارير الـ AI
create table ai_insights (
  id uuid primary key default gen_random_uuid(),
  period_start date, period_end date,
  scope text,                 -- weekly | monthly | worker
  content jsonb,              -- التحليل + النص العربي
  created_at timestamptz default now()
);
```

الصور تتخزّن في **Supabase Storage** (bucket اسمه `laps`) والمرفقات بتسجّل الـ path بس.

---

## 5. الشاشات

**واجهة الموظف (Worker)**
- تسجيل دخول / تسجيل جديد.
- اختيار سريع للعمليات كأزرار كبيرة (Test خفيف / Test تقيل / صيانة خفيفة / صيانة تقيلة / تجميع).
- كارت لكل عملية: عدد اللابات + خانة Serial + ملاحظة + زر صور.
- "إنتاجي": ملخّص يومي/أسبوعي/شهري + حالة كل إدخال (مسودّة/مُصدر).

**واجهة المشرف (Supervisor)**
- طلبات التسجيل (موافقة/رفض) — لوحده.
- قائمة الإدخالات المعلّقة → Release.
- تعديل أوزان العمليات.

**واجهة الحسابات (Accountant) — الداشبورد الرئيسية**
- نظرة عامة: إجمالي اللابات اليوم/الأسبوع/الشهر، عدد العمال النشطين.
- جدول لكل موظف: عدد اللابات، موزّعة على العمليات، الحافز المتوقّع.
- فلاتر: أسبوع / شهر / موظف / نوع عملية.
- زر **تقرير AI** + تصدير (Excel/PDF لاحقاً — مرحلة ثانية).

---

## 6. معادلة الحافز (Weighted Formula)

**الوحدات المرجّحة للموظف:**

```
WeightedUnits(w) = Σ ( quantity_i × weight_i )     لكل إدخال مُصدر (released)
```

**الحافز:**

```
Incentive(w) = WeightedUnits(w) × unit_rate
```

- `weight_i` يتحدّد لكل نوع عملية (قابل للتعديل من المشرف).
- القيم المقترحة كنقطة بداية (قابلة للتغيير):

| العملية | الوزن المقترح |
|---|---|
| Test خفيف | 1 |
| Test تقيل | 2 |
| صيانة خفيفة | 1.5 |
| صيانة تقيلة | 3 |
| تجميع | 2 |

- `unit_rate` سعر الوحدة — يحدّده الحسابات.
- **الاحتساب يستخدم الإدخالات بحالة `released` فقط.**

---

## 7. وحدة الذكاء الاصطناعي (AI Analysis)

- تشتغل على **Edge Function في Supabase** (عشان مفتاح الـ API ما يظهرش في الفرونت).
- بتاخد بيانات الفترة (إجماليات + اتجاهات + الملاحظات) → تبعتهم للموديل.
- الموديل المقترح: **OpenAI GPT-4o-mini** أو **Anthropic Claude Haiku** (رخيص ومناسب للتحليل).
  - اشتراك مدفوع مطلوب (API key) — مستخدم يقول هندفع، تمام.
- المخرجات بالعربي:
  - ملخّص عام: "الأسبوع ده الإنتاجية زادت 12%".
  - أفضل/أقل موظف إنتاجية.
  - أنماط: "الصيانة التقيلة بترتفع آخر الشهر".
  - تنبيهات: "العامل X عنده تدني مستمر 3 أسابيع".
  - ملخّص عام للملاحظات والصور المرصودة.

النتيجة تتخزّن في `ai_insights` وتتعرض في الداشبورد.

---

## 8. التقنيات

| الطبقة | الاختيار |
|---|---|
| الواجهة | **React** (Vite) + Tailwind |
| المصادقة + قاعدة البيانات + Storage | **Supabase** |
| منطق الحماية + AI | Supabase Edge Functions (Deno) |
| الرسم البياني | Recharts |
| النشر | Vercel (مربوط بـ GitHub) |

---

## 9. خطة التنفيذ

**المرحلة 1 — الأساس (MVP)**
1. مشروع Supabase + جداول القسم 4.
2. Auth: تسجيل فردي + موافقة المشرف + الأدوار.
3. واجهة الموظف: إدخال إنتاجي اليومي + الملاحظات + الصور.
4. واجهة المشرف: الموافقات + Release.

**المرحلة 2 — التقارير**
5. داشبورد الحسابات (يومي/أسبوعي/شهري).
6. حساب الحافز المرجّح.

**المرحلة 3 — الذكاء**
7. Edge Function للـ AI + عرض التقرير.
8. تصدير Excel/PDF.

---

## 10. ملاحظات أمان

- كل مفتاح API يبقى في Edge Function مش في الفرونت.
- Row Level Security (RLS): العامل يشوف إدخالاته هو بس؛ المشرف والحسابات يشوفوا الكل.
- Idempotency للسيريالات: منع تكرار نفس السيريال مرتين.

---

**الخلاصة:** نظام بسيط = بوابة دخول + إدخال إنتاجية + موافقة مشرف + داشبورد حسابات + تحليل AI.
بدون نقاط، بدون تعقيد، التركيز على صلب الشغل: **كام لاب عمل العامل، وإنتاجه محسوب صح.**

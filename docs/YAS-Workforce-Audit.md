# YAS Workforce — التقرير الفني (Technical Audit)

**المشروع:** `athrkhwohpjixocygnlb` · **المسار:** `c:\Users\yas\Documents\trae_projects\work`
**تاريخ المراجعة:** 2026-11-08
**الوضع:** قراءة فقط — **لم يتم أي تعديل أو migration على قاعدة البيانات**.

> ### ⚠️ تحديث لاحق (2026-11-08 — بعد التنفيذ)
> - **الثغرات S1–S4 اتصلّحت** على الداتابيز (سياسات مصلّحة + سحب صلاحيات + مسح `seed_demo_user`)، واتأكدت باختبار حقيقي.
> - **اتمسحت الحسابات التجريبية الأربعة**؛ باقي `supervisor@yas.com` بس.
> - **القرارات اتفقنا عليها** — تفاصيلها في القسم 6.
> - **الـ AI:** نكمل بـ **Google Gemini** (شغّال ومجاني ومختبَر).
> - **المرحلة 1 (الأساس) اتطبّقت واتاختبرت end-to-end**: 9 جداول جديدة + 8 دوال RPC + RLS + دور `management` (قراءة فقط) + صفحة «مسار اللاب» + لوحة الإدارة. الملفات: `supabase/phase1-foundation.sql` + صفحات `LaptopJourney.jsx` و`ManagementDashboard.jsx`.
> - الأقسام 2–5 تحت بتمثّل حالة **ما قبل** التنفيذ (تاريخية).

---

## 1. الملخص التنفيذي

النظام الحالي **MVP شغّال**: مصادقة، إدخال إنتاج، موافقة مشرف، تقارير، وحافز مرجّح. فيه **0 سجلات إنتاج حقيقية** (كل الإنتاج فاضي)، فده وقت مثالي لتطوير المخطط بأمان بدون فقدان بيانات.

لكن **المواصفات في ملف `YAS WORK` تطلب نظام أكبر بكتير** (مسار لاب كامل، QR، Release بحسابات منفصل، أوديت، إشعارات، إدارة، AI بالـ OpenAI). الفرق الأساسي إن النظام الحالي **إدخال بالكمية بموافقة واحدة**، والمواصفات عايزة **عملية لكل لاب بموافقتين (مشرف + حسابات)**.

**⚠️ لقيت 3 ثغرات أمنية حرجة** لازم تتصلّح قبل أي شغل حقيقي (تفاصيلها في القسم 5).

**التوصية:** التطوير **تدريجيًا** مع الحفاظ على الجداول والبيانات الحالية (بدون حذف)، وإضافة الجداول الناقصة، وتصليح RLS فورًا.

---

## 2. ما تم فحصه — المشروع الحالي (Frontend)

| الطبقة | الحالة |
|---|---|
| Stack | React 18 + Vite 5 + Tailwind 3 + React Router 6 + Recharts + `@supabase/supabase-js` |
| الصفحات | Login, Register, Pending, WorkerDashboard, WorkerIncentives, SupervisorDashboard, AccountantDashboard, IncentiveLocks, **EmployeeAccounts** |
| المكوّنات | Layout (تنقّل موبايل سفلي + سطح مكتب)، ProtectedRoute، StatusBadge، EntryDetails، InstallPrompt |
| المكتبات | `supabase.js`, `dates.js`, `report.js` (طباعة)، `image.js` (ضغط)، `translit.js` |
| PWA | `manifest.webmanifest` + `sw.js` + أيقونات 192/512/maskable — **مكتمل** |
| الأداء | Code-splitting مطبّق؛ حِمل العامل الأولي ≈ 420KB (gzip ≈ 120KB) بدل 857KB |
| اللغة | عربي RTL + خط Tajawal؛ مفيش تبديل إنجليزي (PRD §15 يطلب تجهيزه) |

**الفجوات في الواجهة مقابل المواصفات:** مفيش Laptop Journey، مفيش QR/باركود، مفيش لوحة إدارة (4th role)، مفيش مركز إشعارات، مفيش شاشة أوديت، مفيش Release Review منفصل للحسابات، مفيش تصدير Excel (فيه طباعة PDF بس).

---

## 3. حالة Supabase الحالية (فحص فعلي)

### 3.1 الجداول (8 جداول / public)

| الجدول | أعمدة | يقابل في المواصفات | ملاحظة |
|---|---|---|---|
| `profiles` | 7 | `profiles` | role مقصور على worker/supervisor/accountant |
| `operations` | 6 | `work_types` | فيها `weight` + `name_ar/en` + `active` + `sort_order` |
| `production_entries` | 13 | `production_records` | فيها حالة `draft/released/returned` + كمية |
| `lap_serials` | 5 | `production_serials` | unique على (serial, direction) |
| `attachments` | 5 | `production_attachments` | |
| `incentive_rules` | 5 | `incentive_settings` | **صف واحد متغيّر** (مفيش history) |
| `incentive_snapshots` | 12 | `incentive_periods` (جزئي) | عندها locked_by/locked_at |
| `ai_insights` | 6 | — | تقارير AI |

**ناقص بالكامل:** `approvals`, `laptop_movements`, `laptop registry`, `release_records`, `audit_logs`, `notifications`, `incentive_adjustments`, `incentive_periods` (كجدول مستقل).

### 3.2 البيانات الحالية

| الجدول | عدد السجلات |
|---|---|
| `profiles` / `auth.users` | **5 / 5** ← كلها حسابات تجريبية (seed demo) |
| `operations` | 5 (بذور) |
| `incentive_rules` | 1 |
| `production_entries`, `lap_serials`, `attachments`, `incentive_snapshots` | **0** |
| `ai_insights` | 1 |

> يعني: **مفيش إنتاج حقيقي**. لكن فيه **5 حسابات تجريبية مكتوبة في `seed-demo-users.sql`** — مخالفة صريحة لقاعدة §18.5 "Do not hardcode employee accounts".

### 3.3 الدوال (4 دوال في `public`)

| الدالة | خطورة |
|---|---|
| `current_role()` | سليمة (تُستخدم في RLS) |
| `handle_new_user()` | trigger على `auth.users` — سليمة |
| `admin_create_user(...)` | ✅ بتتحقق من دور المستدعي (supervisor/accountant) |
| `seed_demo_user(...)` | 🔴 **بدون أي تحقق صلاحية** — انظر القسم 5 |

### 3.4 Storage

- Bucket واحد: **`laps`** (private).
- سياسات: `laps_upload`/`laps_read`/`laps_delete`.

### 3.5 Edge Functions

- دالة واحدة: **`ai-analysis`** (ACTIVE، `verify_jwt=true`، v8).
- **تعارض:** المواصفات تطلب **OpenAI**، والمنفّذ حاليًا **Google Gemini** (`GEMINI_API_KEY`).

### 3.6 إعدادات Auth

| الإعداد | القيمة | التقييم |
|---|---|---|
| `disable_signup` | `false` | تسجيل مفتوح للعموم (بيتخفّف بحالة pending) |
| `mailer_autoconfirm` | `false` | تأكيد الإيميل مطلوب |
| `site_url` | `http://localhost:3000` | 🔴 **غلط** (Vite على 5173، والإنتاج مش مضبوط) |
| `uri_allow_list` | فاضي | روابط إعادة التوجيه غير مضبوطة |

### 3.7 الإضافات (Extensions)

`pgcrypto`, `uuid-ossp`, `plpgsql`, `pg_stat_statements`, `supabase_vault`.

---

## 4. تحليل الفجوات (Gap Analysis)

| # | المواصفات تطلب | الحالي | الفرق |
|---|---|---|---|
| 1 | موافقتان: مشرف (Review) + حسابات (Release) | موافقة واحدة (`released` = مشرف) | **جوهري** |
| 2 | احتساب الإنتاج بعد Release الحسابات فقط | بيُحتسب فورًا عند `released` | **جوهري** |
| 3 | عملية لكل لاب بسيريال واحد + مراحل متعددة | إدخال بالكمية + سيريالات حرة | **جوهري** |
| 4 | Laptop Journey + Timeline | غير موجود | ناقص |
| 5 | QR Code + Barcode | غير موجود | ناقص |
| 6 | جدول `approvals`/`release_records` | أعمدة حالة على الإدخال | ناقص |
| 7 | `audit_logs` شامل | غير موجود | ناقص |
| 8 | `notifications` | غير موجود | ناقص |
| 9 | `incentive_periods` + `incentive_adjustments` | snapshots فقط | ناقص |
| 10 | حفظ إعدادات الحافز التاريخية | صف واحد قابل للتغيير | ناقص |
| 11 | دور Management (4 أدوار) | 3 أدوار | ناقص |
| 12 | OpenAI | Gemini | تعارض |
| 13 | تصدير Excel | طباعة/PDF بس | ناقص |
| 14 | منع السيريال المكرر حسب "المرحلة" | unique على (serial,direction) عالمي | **متعارض** |
| 15 | حالات اللاب (7 حالات) | 3 حالات للإدخال | ناقص |
| 16 | Pagination / Indexes | مفيش فهارس على حقول البحث | ناقص |

---

## 5. المخاطر الأمنية (حرجة — موصى بتصليحها فورًا)

| # | الثغرة | الأثر | الدليل | الحالة |
|---|---|---|---|---|
| 🔴 **S1** | `seed_demo_user` دالة `security definer` **بدون تحقق دور**، وقابلة للتنفيذ من أي مستخدم مُصادَق | أي عامل يقدر ينشئ حساب **مشرف** لنفسه → **تصعيد صلاحيات كامل** | `seed-demo-users.sql` | ✅ اتصلّحت (الدالة اتمسحت) |
| 🔴 **S2** | سياسة `profiles_update_self` تسمح للمستخدم بتحديث **كل الأعمدة** في صفه (`with_check: id = auth.uid()`) | عامل يعدّل `role` بتاعه لـ **supervisor** → تصعيد صلاحيات | `pg_policies` | ✅ اتصلّحت + مختبَرة |
| 🔴 **S3** | سياسة `entries_update` الـ `with_check` بتسمح بتحديث أي قيمة للصف (‏`worker_id = auth.uid()`) | عامل يقدر يحوّل حالته لـ **`released`** (يوافق على إدخاله بنفسه) → مخالفة §18.9 | `pg_policies` | ✅ اتصلّحت + مختبَرة |
| 🟠 S4 | `laps_read` تسمح لأي مستخدم مُصادَق بقراءة **كل صور** البكت | عامل يشوف صور موظفين تانيين (عكس RLS الجدول) | `schema.sql` | ✅ اتصلّحت |
| 🟠 S5 | token الإدارة `sbp_...` ظهر في المحادثة | سرّي، لازم يتعمل له revoke | — | ⏳ لازم تعمله revoke |
| 🟡 S6 | `site_url` = localhost:3000 | روابط تأكيد/إعادة تعيين الإيميل هتفشل في الإنتاج | auth config | ⏳ مستني الدومين |
| 🟡 S7 | مفيش `audit_logs` | مفيش تتبّع للعمليات المالية/الموافقات (مخالفة §13) | — | ⏳ ضمن المرحلة 1/2 |
| 🟡 S8 | مفيش transactions للموافقة/الـ Release | احتمال حالة غير متسقة (مخالفة §16) | — | ⏳ ضمن المرحلة 1 |

---

## 6. القرارات المعتمدة (اتفقنا عليها 2026-11-08)

| # | البند | القرار |
|---|---|---|
| 1 | **نموذج الإدخال** | **عملية لكل لاب + مراحل** — كل لاب له سجل وسيريال، والعمليات تتسجّل عليه بالتتابع |
| 2 | **السيريال المكرر** | **فريد عالميًا** — ما يتكررش أبدًا |
| 3 | **استحقاق Release** | **كل المراحل الإلزامية تخلص + موافقة المشرف** |
| 4 | **المراحل** | **قائمة مستقلة** عن أنواع العمليات (مش هي نفسها العمليات) |
| 5 | **المراحل الإلزامية (6)** | **استلام، فحص، صيانة، اختبار، تجميع، جاهز للإصدار** (كلها إلزامية) |
| 6 | **سعر الوحدة** | **لكل نوع عملية** + سعر عام افتراضي (fallback) |
| 7 | **دور Management** | **دور رابع جديد، قراءة فقط** |
| 8 | **أسماء الجداول** | **نُبقي الحالية** (`operations`/`production_entries`/`lap_serials`) ونضيف الجديد |
| 9 | **الـ AI** | **Google Gemini** (شغّال ومجاني) |
| 10 | **الحسابات** | **19 حساب** (مشرف + 18 موظف) — باسورد موحّد مؤقتًا `yas1234` (يتغيّر قبل الإنتاج) |

**لسه مفتوح:** QR/باركود — إلزامي من المرحلة 1 ولا نأجّله للمرحلة 3؟ ومين مسؤول طباعة الملصق؟

---

## 7. خطة المخطط المقترحة (Proposal — بدون تنفيذ)

**المبدأ:** إضافة > تعديل > حذف. الحفاظ على كل الجداول والبيانات الحالية، وإضافة اللي ناقص.

### 7.1 تعديلات خفيفة على الموجود

- `profiles`: إضافة `management` للـ check، + عمود `updated_at`.
- `operations` (=work_types): إضافة `description`, `unit_value` (لو هنخلي السعر لكل نوع)، `updated_at`.
- `production_entries`: إضافة `laptop_id`, `stage_code`, `submitted_at`, `reviewed_by`, `reviewed_at`.
- `incentive_rules`: تحويلها لـ **versioned** (صف جديد لكل تغيير + `effective_from`).

### 7.2 جداول جديدة

| الجدول | الغرض |
|---|---|
| `laptops` | سجل اللاب: `serial` (unique), `qr_token` (uuid آمن), `current_status`, `current_stage` |
| `laptop_movements` | Timeline: كل حركة (استلام/مرحلة/إصدار) مع الفاعل والوقت |
| `approvals` | قرارات المشرف: `record_id`, `decision(approved/rejected)`, `reason`, `actor`, `at` |
| `release_records` | قرارات الإصدار من الحسابات: `laptop_id`, `decision`, `reason`, `actor`, `at` |
| `incentive_periods` | فترات مالية: `start`, `end`, `status(open/closed)`, `closed_by/at` |
| `incentive_adjustments` | التسويات اليدوية بعد الإغلاق مع السبب والمرفق |
| `audit_logs` | `actor`, `action`, `entity`, `entity_id`, `before`, `after`, `at` |
| `notifications` | `user_id`, `type`, `title`, `body`, `read_at`, `created_at` |

### 7.3 كل الحسابات المالية server-side

- الحافز يُحسب في **دالة Postgres** (`calculate_incentive(period)`)، والواجهة تعرض الناتج بس — ممنوع حساب مالي في الفرونت.
- الموافقة/الـ Release في **دالة فيها transaction** (تتحقق من الصلاحية + تسجّل في `approvals`/`release_records`/`audit_logs` ذرّيًا).

### 7.4 خطة RLS

- تصليح S1/S2/S3/S4 فورًا.
- **قاعدة:** كل عمود حسّاس (`role`, `status`, الحالات المالية) يتغيّر **من RPC فقط** — مع منع التحديث المباشر عبر RLS.
- `management`: SELECT على مستوى الشركة، بدون أي كتابة.
- اللاب/الحركات/القرارات: قراءة حسب الدور، وكتابة عبر RPC.

### 7.5 فهارس مقترحة

`production_entries(worker_id, entry_date)`, `production_entries(status)`, `lap_serials(serial)`, `laptops(serial)`, `approvals(record_id)`, `notifications(user_id, read_at)`, `audit_logs(created_at)`.

---

## 8. خريطة التنفيذ (Roadmap)

| المرحلة | المحتوى | ملاحظة |
|---|---|---|
| **0 — تصليح أمني** | S1–S4 + إعداد Auth + revoke التوكن | ✅ اتعمل (فاضل revoke التوكن + الدومين) |
| **1 — الأساس** | الدادابات الجديدة + RPC الموافقات/Release + Laptop Journey + الأدوار الأربعة | ✅ اتعمل (مختبَر end-to-end) |
| **2 — المحاسبة** | Release Review + محرك الحافز + الفترات المغلقة + الأوديت + تصدير Excel | ✅ اتعمل (`fn_period_report`/`fn_close_month`/`fn_reopen_month`/`fn_add_adjustment` + صفحة الأوديت + تصدير XLSX) |
| **3 — عمليات متقدمة** | QR/Barcode + إشعارات + تحليلات متقدمة | 🔄 **QR/Barcode ✅** (ملصقات A4 + مسح بالكاميرا + مسار `/l/:token`) + **الإشعارات ✅** (`supabase/phase3-notifications.sql`: `fn_notify`/`fn_notify_role` + ربطها بالاعتماد/الإرجاع/الإصدار/إغلاق الشهر + جرس بعدّاد في الهيدر) — التحليلات المتقدمة لسه |
| **4 — الذكاء** | ملخّصات أسبوعية بالـ Gemini + تحليلات متقدمة | Gemini معتمد |

---

## 9. المطلوب منك قبل التنفيذ

1. ✅ الموافقة على **القرارات** (القسم 6) — اتعملت.
2. ✅ قرار **تصليح الثغرات الحرجة S1–S4** — اتعملت.
3. ✅ قرار **أسماء الجداول** — نُبقي الحالية.
4. ⏳ **revoke** للتوكن `sbp_...` بعد ما نخلّص.
5. ⏳ تحديد **رابط الإنتاج** لضبط `site_url`.
6. ⏳ قرار **QR** (إلزامي من المرحلة 1 ولا متأخر؟).

> **أي migration جديد للداتابيز محتاج موافقتك قبل التطبيق.**

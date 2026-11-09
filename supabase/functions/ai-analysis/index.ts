// Supabase Edge Function: ai-analysis
// التحليل التلقائي للإنتاجية بالذكاء الاصطناعي (Google Gemini — مجاني)
// النشر: supabase functions deploy ai-analysis
// المفتاح: supabase secrets set GEMINI_API_KEY=...
// جيب المفتاح من: https://aistudio.google.com/app/apikey

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// موديلات جوجل الحديثة بتاخد وقت طويل في الرد أحيانًا (يمكن يعدّي الدقيقة)،
// فبناخد مهلة كبيرة لكن أقل من الحد الأقصى للدالة عشان نرجّع رسالة خطأ واضحة بدل ما تعلّق.
const GEMINI_TIMEOUT_MS = 70000

// نداء موديل واحد مع مهلة زمنية — يرجّع إمّا الملخص أو خطأ واضح (بدون ما يعلّق الدالة)
async function callGemini(model: string, key: string, prompt: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'أنت محلل بيانات دقيق ومختصر، تكتب بالعربية.' }],
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
        signal: ctrl.signal,
      },
    )
    if (!res.ok) {
      return { ok: false as const, status: res.status, text: await res.text() }
    }
    const out = await res.json()
    const summary =
      out?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
    return { ok: true as const, summary }
  } catch (err) {
    return { ok: false as const, status: 0, text: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

function buildPrompt(body: any): string {
  const { period, totals, workers, entries } = body ?? {}
  const notes = (entries ?? [])
    .filter((e: any) => e?.notes)
    .map((e: any) => `- ${e.worker} (${e.operation}): ${e.notes}`)
    .slice(0, 40)
    .join('\n')

  return `أنت محلل بيانات إنتاجية في شركة صيانة/تجميع لابات.
حلّل البيانات التالية واكتب تقرير موجز بالعربي (فقرة أو نقاط)، يشمل:
1) ملخّص عام لأداء الفترة.
2) أعلى وأقل العمال إنتاجية (بالوحدات المرجّحة).
3) أي أنماط أو ملاحظات مهمة.
4) توصيات عملية للمشرف/الحسابات.

الفترة: من ${period?.start} إلى ${period?.end}
الإجماليات: عدد اللابات = ${totals?.laps}، الوحدات المرجّحة = ${totals?.units}
بيانات العمال: ${JSON.stringify(workers ?? [])}
ملاحظات العمال:
${notes || '(لا توجد ملاحظات)'}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')

    if (!geminiKey) return json({ error: 'GEMINI_API_KEY غير مضبوط في أسرار الدالة.' }, 500)

    // 1) التحقق من المستخدم
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return json({ error: 'غير مصرح.' }, 401)

    // 2) التحقق من الدور (مشرف أو حسابات)
    const admin = createClient(supabaseUrl, serviceKey)
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!profile || !['supervisor', 'accountant'].includes(profile.role)) {
      return json({ error: 'غير مسموح لك بالوصول للتحليل.' }, 403)
    }

    const body = await req.json()
    const prompt = buildPrompt(body)

    // 3) نداء الموديل (Google Gemini) — مع مهلة وإعادة محاولة وموديل بديل لو السيرفر مزحوم
    const preferred = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash'
    const models = Array.from(new Set([preferred, 'gemini-flash-lite-latest']))
    let lastErr = ''
    let summary = ''

    outer: for (const model of models) {
      const attempts = 1
      for (let attempt = 0; attempt < attempts; attempt++) {
        const r = await callGemini(model, geminiKey, prompt)
        if (r.ok) {
          summary = r.summary
          break outer
        }
        lastErr = `[${model}] ${r.text}`
        if (r.status === 404) break // الموديل مش موجود — جرّب اللي بعده
        if (attempt < attempts - 1) await new Promise((res) => setTimeout(res, 1500))
      }
    }

    if (!summary) {
      return json(
        { error: `تعذّر تشغيل التحليل دلوقتي (موديل جوجل مزحوم). جرّب تاني بعد شوية.\n${lastErr}` },
        502,
      )
    }

    // 4) خزّن التقرير
    await admin.from('ai_insights').insert({
      period_start: body?.period?.start ?? null,
      period_end: body?.period?.end ?? null,
      scope: 'period',
      content: { summary, totals: body?.totals ?? null },
    })

    return json({ summary })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

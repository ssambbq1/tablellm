import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// 기본 필드 (클라이언트가 안 보내면 이 목록 사용)
const DEFAULT_FIELDS = [
  'manufacturer',
  'pump model name',
  'rated flow',
  'max flow',
  'min flow',
  'normal flow',
  'TDH',
  'casing material',
  'shaft material',
  'impeller material',
  'shaft power',
  'pump efficiency',
  'shutoff TDH',
];

function coerceToPlainJson(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return {};
}

function normalizeFields(obj: any, requested: string[]) {
  const result: Record<string, string> = {};
  for (const key of requested) {
    result[key] = (obj?.[key] ?? '').toString();
  }
  return result;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function heuristicExtract(markdown: string, requested: string[]) {
  const text = (markdown || '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim());

  function findValueByKeys(keys: string[]) {
    const pattern = new RegExp(
      `^(?:\\|\\s*)?(?:${keys.map(k => escapeRegex(k)).join('|')})\\s*(?:\\||:|=|-)?\\s*([^|]+?)(?:\\|.*)?$`,
      'i'
    );
    for (const line of lines) {
      const m = line.match(pattern);
      if (m && m[1]) return m[1].trim();
    }
    // 파이프 테이블: | key | value |
    for (const line of lines) {
      if (line.startsWith('|') && line.split('|').length >= 3) {
        const cells = line.split('|').slice(1).map(c => c.trim());
        if (cells.length >= 2) {
          const left = cells[0].toLowerCase();
          if (keys.some(k => left.includes(k.toLowerCase()))) {
            return cells[1];
          }
        }
      }
    }
    return '';
  }

  const out: Record<string, string> = {};
  for (const key of requested) {
    const syn = SYNONYMS[key];
    const keys = syn?.match?.length ? syn.match : [key];
    const exclude = syn?.exclude ?? [];
    let value = findValueByKeys(keys);
    if (
      exclude.length > 0 &&
      value &&
      !keys.some(k => value.toLowerCase().includes(k.toLowerCase())) &&
      exclude.some(ex => value.toLowerCase().includes(ex.toLowerCase()))
    ) {
      value = '';
    }
    out[key] = value;
  }
  return out;
}

// 영문 기반 동의어(인코딩 이슈 방지)
const SYNONYMS: Record<string, { match: string[]; exclude: string[]; specialInstruction?: string }> = {
  manufacturer: { match: ['manufacturer', 'maker', 'brand', 'company'], exclude: [] },
  'pump model name': { match: ['pump model name', 'model', 'pump model', 'model name'], exclude: [] },
  'rated flow': { match: ['rated flow', 'q rated', 'q at rated', 'flow'], exclude: ['nominal flow', 'flow (nominal)'] },
  'normal flow': { match: ['normal flow', 'nominal flow', 'flow (nominal)', 'q nominal'], exclude: ['rated flow'] },
  TDH: { match: ['tdh', 'total dynamic head', 'head', 'head (at qmax.-qnominal-qmin.)', 'shutoff head'], exclude: [] },
  'casing material': { match: ['casing material', 'pump casing material', 'casing'], exclude: [] },
  'shaft material': { match: ['shaft material', 'shaft material (pump)', 'shaft'], exclude: [] },
  'impeller material': { match: ['impeller material', 'impeller'], exclude: [] },
  'shaft power': { match: ['shaft power', 'shaft power (p2)', 'p2', 'power (shaft)'], exclude: [] },
  'pump efficiency': { match: ['pump efficiency', 'max. pump efficiency', 'efficiency'], exclude: [] },
  'max flow': { match: ['max flow', 'q max', 'maximum flow'], exclude: [] },
  'min flow': { match: ['min flow', 'q min', 'minimum flow'], exclude: [] },
  'shutoff TDH': { match: ['shutoff tdh', 'shut-off head', 'shut off head', 'head at shutoff'], exclude: ['head at QMax', 'head at QMin', 'TDH'] },
};

function buildFieldInstructions(syns: typeof SYNONYMS) {
  const instructions: string[] = [];
  for (const key of Object.keys(syns)) {
    const v = syns[key];
    if (v && Array.isArray(v.match) && Array.isArray(v.exclude)) {
      instructions.push(
        `For the field '${key}', prefer matches: ${JSON.stringify(v.match)}, and ignore values matching: ${JSON.stringify(v.exclude)}.`
      );
    }
  }
  return instructions.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let markdown = body?.markdown as string;
    // 사용자 정의 필드/별칭
    const requestedFields: string[] = Array.isArray(body?.fields) && body.fields.length > 0
      ? body.fields.map((s: any) => String(s))
      : DEFAULT_FIELDS;
    const aliases: Record<string, string> = (body?.aliases && typeof body.aliases === 'object') ? body.aliases : {};

    if (typeof markdown !== 'string' || !markdown.trim()) {
      return NextResponse.json({ error: 'markdown is required in body' }, { status: 400 });
    }

    if (markdown.length > 20000) {
      markdown = markdown.slice(0, 20000);
    }

    // 요청 필드에 해당하는 동의어만 포함
    const filteredSynonyms: typeof SYNONYMS = {} as any;
    for (const k of requestedFields) {
      if (SYNONYMS[k]) (filteredSynonyms as any)[k] = SYNONYMS[k];
    }
    const matchExcludePrompt = Object.entries(filteredSynonyms)
      .map(([key, value]) => {
        const m = value.match?.length ? `For '${key}', prefer: ${JSON.stringify(value.match)}.` : '';
        const e = value.exclude?.length ? `For '${key}', exclude: ${JSON.stringify(value.exclude)}.` : '';
        return [m, e].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join('\n');
    const fieldInstructions = buildFieldInstructions(filteredSynonyms);

    const instruction = [
      'You will receive Markdown that contains one or more tables describing a pump and motor.',
      'Map the content to the following fixed fields. Use semantic matching and reasonable synonyms.',
      'Units should be preserved if present. If a field is missing, use an empty string.',
      matchExcludePrompt,
      fieldInstructions,
      (Object.keys(aliases).length > 0
        ? `If the markdown uses any of these old names ${JSON.stringify(Object.keys(aliases))}, map them to these new field names before returning.`
        : ''),
      'Return STRICT JSON with exactly these keys and string values only:',
      `${JSON.stringify(requestedFields)}`,
      'Do not include any extra keys or commentary. JSON only.',
    ].filter(Boolean).join('\n');

    let parsed: any = {};
    let usageInfo = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set');
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `${instruction}\n\nMARKDOWN:\n${markdown}` }],
        temperature: 0,
      });

      const raw = response.choices[0]?.message?.content || '';
      parsed = coerceToPlainJson(raw);
      usageInfo = {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      };
    } catch (apiErr) {
      // 모델 실패 시 휴리스틱으로 대체
    }

    if (!parsed || Object.keys(parsed).length === 0) {
      parsed = heuristicExtract(markdown, requestedFields);
    }

    // 별칭(이전명→새이름) 적용
    if (aliases && typeof aliases === 'object') {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed || {})) {
        const mappedKey = (aliases as any)[k] || k;
        mapped[mappedKey] = v as any;
      }
      parsed = mapped;
    }

    const fields = normalizeFields(parsed || {}, requestedFields);
    const safe: Record<string, string> = {};
    for (const k of requestedFields) safe[k] = (fields[k] ?? '').toString();

    return NextResponse.json({ fields: safe, order: requestedFields, usage: usageInfo });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to extract fields', details: err?.message || String(err) },
      { status: 500 }
    );
  }
}


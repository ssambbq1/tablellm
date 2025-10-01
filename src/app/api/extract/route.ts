import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

// Fields to normalize and return in a fixed order
const REQUIRED_FIELDS = [
  'manufacturer',
  'rated flow',
  'normal flow',
  'TDH',
  'casing material',
  'shaft material',
  'impeller material',
  'shaft power',
  'pump efficiency',
  'max flow',
  'min flow',
  'shutoff TDH',
  'pump model name',
];

function coerceToPlainJson(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {}
  // Try to extract JSON chunk between first { and last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return {};
}

function normalizeFields(obj: any) {
  const result: any = {};
  for (const key of REQUIRED_FIELDS) {
    result[key] = (obj?.[key] ?? '').toString();
  }
  return result;
}

function escapeRegex(s: string) { 
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

function heuristicExtract(markdown: string) {
  const text = (markdown || '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim());

  // Helper to find value after key in lines or pipe tables
  function findValueByKeys(keys: string[]) {
    const pattern = new RegExp(`^(?:\\|\\s*)?(?:${keys.map(k => escapeRegex(k)).join('|')})\\s*(?:\\||:|=|-)?\\s*([^|]+?)(?:\\|.*)?$`, 'i');
    for (const line of lines) {
      const m = line.match(pattern);
      if (m && m[1]) return m[1].trim();
    }
    // Also scan table rows where key may be in first cell and value in second
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

  const synonyms: { [key: string]: string[] } = {
    'manufacturer': ['manufacturer', 'maker', 'brand', 'company', '제조사', '브랜드', '회사'],
    'rated flow': ['rated flow', 'q rated', 'q at rated', 'flow (max.-nominal-min.)', 'flow', '정격 유량'],
    'normal flow': ['normal flow', 'nominal flow', 'q nominal', '보통 유량', '정상 유량', '정격유량'],
    'TDH': ['tdh', 'total dynamic head', 'head', 'head (at qmax.-qnominal-qmin.)', 'shutoff head', '전양정', '양정'],
    'casing material': ['casing material', 'pump casing material', 'casing', '케이싱 재질', '케이싱'],
    'shaft material': ['shaft material', 'shaft material (pump)', 'shaft', '샤프트 재질', '축 재질'],
    'impeller material': ['impeller material', 'impeller', '임펠러 재질'],
    'shaft power': ['shaft power', 'shaft power (p2)', 'p2', 'power (shaft)', '축 동력'],
    'pump efficiency': ['pump efficiency', 'max. pump efficiency', 'efficiency', '펌프 효율', '효율'],
    'max flow': ['max flow', 'q max', 'maximum flow', '최대 유량'],
    'min flow': ['min flow', 'q min', 'minimum flow', '최소 유량'],
    'shutoff TDH': ['shutoff tdh', 'shut-off head', 'shut off head', 'head at shutoff', '차단양정'],
    'pump model name': ['pump model name', 'model', 'pump model', 'model name', '모델', '모델명'],
  };

  const out: any = {};
  for (const key of REQUIRED_FIELDS) {
    const keys = synonyms[key] || [key];
    out[key] = findValueByKeys(keys);
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[/api/extract] request received');
    const body = await request.json();
    let markdown = body?.markdown;
    
    if (typeof markdown !== 'string' || !markdown.trim()) {
      return NextResponse.json(
        { error: 'markdown is required in body' },
        { status: 400 }
      );
    }
    
    // Guard extremely long payloads
    if (markdown.length > 20000) {
      console.log('Trimming markdown from', markdown.length, 'chars');
      markdown = markdown.slice(0, 20000);
    }

    const instruction = [
      'You will receive Markdown that contains one or more tables describing a pump and motor.',
      'Map the content to the following fixed fields. Use semantic matching and reasonable synonyms.',
      'Units should be preserved if present. If a field is missing, use an empty string.',
      'Return STRICT JSON with exactly these keys and string values only:',
      `${JSON.stringify(REQUIRED_FIELDS)}`,
      'Do not include any extra keys or commentary. JSON only.',
    ].join('\n');

    const message = new HumanMessage({
      content: [
        { type: 'text', text: instruction },
        { type: 'text', text: `\n\nMARKDOWN:\n${markdown}` },
      ],
    });

    let parsed = {};
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set');
      }
      
      const model = new ChatOpenAI({ 
        model: 'gpt-4o-mini', 
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY
      });
      
      const response = await model.invoke([message]);
      const raw = typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n').trim()
          : '';
      parsed = coerceToPlainJson(raw);
      console.log('[/api/extract] model JSON keys:', Object.keys(parsed || {}));
    } catch (apiErr: any) {
      console.error('Model extraction failed, falling back to heuristics:', apiErr?.message || apiErr);
    }

    // If model output empty, try heuristic extraction from markdown
    if (!parsed || Object.keys(parsed).length === 0) {
      parsed = heuristicExtract(markdown);
      console.log('[/api/extract] heuristic result keys:', Object.keys(parsed || {}));
    }

    const fields = normalizeFields(parsed || {});
    // Final safety: ensure object shape
    const safe: any = {};
    for (const k of REQUIRED_FIELDS) safe[k] = (fields[k] ?? '').toString();
    console.log('[/api/extract] sending response');
    return NextResponse.json({ fields: safe, order: REQUIRED_FIELDS });
  } catch (err: any) {
    console.error('Extraction error:', err);
    return NextResponse.json(
      { error: 'Failed to extract fields', details: err.message },
      { status: 500 }
    );
  }
}

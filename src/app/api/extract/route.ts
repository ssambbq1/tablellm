import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import OpenAI from 'openai';

// Fields to normalize and return in a fixed order
const REQUIRED_FIELDS = [
   'manufacturer', 'pump model name', 'rated flow',
      'max flow', 'min flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency', 'shutoff TDH'
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

  // synonyms를 파일 상단에 선언된 것으로 통합
  const out: any = {};
  for (const key of REQUIRED_FIELDS) {
    let keys: string[] = [];
    let exclude: string[] = [];
    const syn = synonyms[key];
    if (Array.isArray(syn)) {
      keys = syn;
    } else if (syn && typeof syn === 'object' && (syn as any).match && (syn as any).exclude) {
      keys = (syn as any).match;
      exclude = (syn as any).exclude;
    } else {
      keys = [key];
    }
    let value = findValueByKeys(keys);
    // match에 포함된 값은 exclude에 있어도 걸러지지 않도록 수정
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

// Synonyms for semantic matching
const synonyms: { [key: string]: { match: string[], exclude: string[] } } = {
  'manufacturer': {
    match: ['manufacturer', 'maker', 'brand', 'company', '제조사', '브랜드', '회사'],
    exclude: []
  },
  'rated flow': {
    match: ['rated flow', 'q rated', 'q at rated', 'flow', '정격 유량'],
    exclude: ['nominal flow', 'flow (nominal)']
  },
  'normal flow': {
    match: ['normal flow', 'nominal flow', 'flow (nominal)', 'q nominal', '보통 유량', '정상 유량', '정격유량'],
    exclude: ['rated flow']
  },
  'TDH': {
    match: ['tdh', 'total dynamic head', 'head', 'head (at qmax.-qnominal-qmin.)', 'shutoff head', '전양정', '양정'],
    exclude: []
  },
  'casing material': {
    match: ['casing material', 'pump casing material', 'casing', '케이싱 재질', '케이싱'],
    exclude: []
  },
  'shaft material': {
    match: ['shaft material', 'shaft material (pump)', 'shaft', '샤프트 재질', '축 재질'],
    exclude: []
  },
  'impeller material': {
    match: ['impeller material', 'impeller', '임펠러 재질'],
    exclude: []
  },
  'shaft power': {
    match: ['shaft power', 'shaft power (p2)', 'p2', 'power (shaft)', '축 동력'],
    exclude: []
  },
  'pump efficiency': {
    match: ['pump efficiency', 'max. pump efficiency', 'efficiency', '펌프 효율', '효율'],
    exclude: []
  },
  'max flow': {
    match: ['max flow', 'q max', 'maximum flow', '최대 유량'],
    exclude: []
  },
  'min flow': {
    match: ['min flow', 'q min', 'minimum flow', '최소 유량'],
    exclude: []
  },
  'shutoff TDH': {
    match: ['shutoff tdh', 'shut-off head', 'shut off head', 'head at shutoff', '차단양정'],
    exclude: ['head at QMax', 'head at QMin', 'TDH']
  },
  'pump model name': {
    match: ['pump model name', 'model', 'pump model', 'model name', '모델', '모델명'],
    exclude: []
  }
};

function buildFieldInstructions(synonyms: any) {
  let instructions = [];
  for (const key of Object.keys(synonyms)) {
    const value = synonyms[key];
    if (value && typeof value === 'object' && value.match && value.exclude) {
      instructions.push(
        `For the field '${key}', use only values matching: ${JSON.stringify(value.match)}, and ignore any values matching: ${JSON.stringify(value.exclude)}.`
      );
    }
  }
  return instructions.join('\n');
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

    // Build extra instructions for match/exclude fields
    const fieldInstructions = buildFieldInstructions(synonyms);
    const instruction = [
      'You will receive Markdown that contains one or more tables describing a pump and motor.',
      'Map the content to the following fixed fields. Use semantic matching and reasonable synonyms.',
      'Units should be preserved if present. If a field is missing, use an empty string.',
      fieldInstructions, // <-- Insert match/exclude instructions here
      'Return STRICT JSON with exactly these keys and string values only:',
      `${JSON.stringify(REQUIRED_FIELDS)}`,
      'Do not include any extra keys or commentary. JSON only.',
    ].filter(Boolean).join('\n');

    let parsed = {};
    let usageInfo = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
    
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set');
      }
      
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `${instruction}\n\nMARKDOWN:\n${markdown}`
          }
        ],
        temperature: 0,
      });
      
      console.log('[/api/extract] OpenAI response received');
      console.log('[/api/extract] Token usage:', response.usage);
      
      const raw = response.choices[0]?.message?.content || '';
      parsed = coerceToPlainJson(raw);
      
      // Extract token usage information from response
      usageInfo = {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0
      };
      
      console.log('[/api/extract] model JSON keys:', Object.keys(parsed || {}));
      console.log('[/api/extract] token usage:', usageInfo);
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
    return NextResponse.json({ fields: safe, order: REQUIRED_FIELDS, usage: usageInfo });
  } catch (err: any) {
    console.error('Extraction error:', err);
    return NextResponse.json(
      { error: 'Failed to extract fields', details: err.message },
      { status: 500 }
    );
  }
}

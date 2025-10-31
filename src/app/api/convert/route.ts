import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Ensure Node.js runtime for binary/PDF processing
export const runtime = 'nodejs';

// Initialize both LangChain model and direct OpenAI client
let model: ChatOpenAI | null = null;
let openai: OpenAI | null = null;

try {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }
  
  // LangChain model
  model = new ChatOpenAI({ 
    model: 'gpt-4o-mini', 
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY
  });
  
  // Direct OpenAI client for token tracking
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
  console.log('OpenAI model and client initialized successfully');
} catch (error) {
  if (error instanceof Error) {
    console.error('Failed to initialize OpenAI model:', error.message);
  } else {
    console.error('Failed to initialize OpenAI model:', String(error));
  }
}


export async function POST(request: NextRequest) {
  try {
    console.log('Received conversion request');
    const contentType = request.headers.get('content-type') || '';
    const url = new URL(request.url);
    const sp = url.searchParams;
    const envMaxPages = Number(process.env.PDF_MAX_PAGES) || 20;
    const envScale = Number(process.env.PDF_RENDER_SCALE) || 2;
    const envConcurrency = Number(process.env.PDF_CONCURRENCY) || 2;
    const maxPagesParam = Number(sp.get('maxPages'));
    const scaleParam = Number(sp.get('scale'));
    const startParam = Number(sp.get('start'));
    const endParam = Number(sp.get('end'));
    const concurrencyParam = Number(sp.get('concurrency'));
    const pagesSpec = (sp.get('pages') || '').trim();
    const excludeSpec = (sp.get('exclude') || '').trim();
    // Default to all pages if no explicit max provided
    const maxPagesCfg = Number.isFinite(maxPagesParam) && maxPagesParam > 0 ? Math.min(maxPagesParam, 50) : Number.POSITIVE_INFINITY;
    const scaleCfg = Number.isFinite(scaleParam) && scaleParam >= 1 && scaleParam <= 4 ? scaleParam : envScale;
    const startPageCfg = Number.isFinite(startParam) && startParam > 0 ? Math.floor(startParam) : 1;
    const endPageCfgRaw = Number.isFinite(endParam) && endParam > 0 ? Math.floor(endParam) : undefined;
    const concurrencyCfg = Number.isFinite(concurrencyParam) && concurrencyParam >= 1 && concurrencyParam <= 5 ? Math.floor(concurrencyParam) : envConcurrency;

    let mode: 'image' | 'pdf' | null = null;
    let imageDataUrl: string | null = null;
    let pdfData: Uint8Array | null = null;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      const dataUrl = body?.dataUrl;
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        mode = 'image';
        imageDataUrl = dataUrl;
      } else {
        return NextResponse.json(
          { error: 'Invalid payload. Provide image dataUrl for JSON requests.' },
          { status: 400 }
        );
      }
    } else if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: 'No file field found in form-data (expected name: "file").' },
          { status: 400 }
        );
      }

      const fileType = (file.type || '').toLowerCase();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (fileType.startsWith('image/')) {
        const base64 = buffer.toString('base64');
        imageDataUrl = `data:${fileType};base64,${base64}`;
        mode = 'image';
      } else if (fileType === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) {
        // Store PDF bytes as Uint8Array for pdfjs
        pdfData = new Uint8Array(arrayBuffer);
        mode = 'pdf';
      } else {
        return NextResponse.json(
          { error: `Unsupported file type: ${fileType || 'unknown'}. Use image/* or application/pdf.` },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Unsupported Content-Type. Use application/json (with image dataUrl) or multipart/form-data (with file).' },
        { status: 415 }
      );
    }

    const openaiClient = openai;
    if (!openaiClient) {
      return NextResponse.json(
        { error: 'OpenAI client not initialized' },
        { status: 500 }
      );
    }

    let markdown = '';
    let usageInfo = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    if (mode === 'image' && imageDataUrl) {
      console.log('Building vision prompt...');
      const prompt = [
        'You are an expert at reading tables from images.',
        'Extract all tabular data present in the image and output ONLY GitHub-Flavored Markdown (GFM) tables.',
        'Guidelines:',
        '- Reconstruct headers and multi-row cells faithfully.',
        '- If merged cells exist, replicate with repeated values or add footnotes.',
        '- Preserve number formatting and units; do not invent data.',
        '- If multiple tables exist, output them sequentially with a blank line between.',
        '- Do not include any explanations or prose, only Markdown tables.',
        '- If no tables are found, return "No tables detected in the image."',
      ].join('\n');

      console.log('Calling OpenAI API for image...');
      const response = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0,
      });
      console.log('OpenAI API response (image) received');
      markdown = response.choices[0]?.message?.content || 'No content extracted';
      usageInfo = {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      };
    } else if (mode === 'pdf' && pdfData) {
      console.log('Rendering PDF pages to images...');

      // Helper to render PDF pages to image data URLs
      // parse page specification like "1,3,5-7"
      function parsePageSpec(spec: string, total: number): number[] {
        if (!spec) return [];
        const set = new Set<number>();
        const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
          if (/^\d+$/.test(p)) {
            const n = parseInt(p, 10);
            if (n >= 1 && n <= total) set.add(n);
          } else {
            const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
              let a = parseInt(m[1], 10);
              let b = parseInt(m[2], 10);
              if (a > b) [a, b] = [b, a];
              a = Math.max(1, a);
              b = Math.min(total, b);
              for (let i = a; i <= b; i++) set.add(i);
            }
          }
        }
        return Array.from(set).sort((a, b) => a - b);
      }

      // Build absolute URLs for assets so Node's fetch can resolve them in Vercel
      const reqUrl = new URL(request.url);
      const origin = `${reqUrl.protocol}//${reqUrl.host}`;

      async function pdfToImageDataUrls(data: Uint8Array): Promise<{ page: number; dataUrl: string }[]> {
        const { createCanvas } = await import('@napi-rs/canvas');
        // Ensure pdfjs fake worker can be resolved in Node/Turbopack
        await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
        const loadingTask = (pdfjsLib as any).getDocument({
          data,
          // Prefer system fonts in Node; fallback to served assets
          useSystemFonts: true,
          // Serve these from Next public/ if available
          standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
          cMapUrl: `${origin}/pdfjs/cmaps/`,
          cMapPacked: true,
          // Allow fetch usage in worker/fake-worker
          useWorkerFetch: true,
        });
        const pdf = await loadingTask.promise;
        const dataUrls: { page: number; dataUrl: string }[] = [];

        const totalPages = pdf.numPages;
        const lastByMax = Math.min(totalPages, startPageCfg + (isFinite(maxPagesCfg) ? maxPagesCfg : Number.MAX_SAFE_INTEGER) - 1);
        const lastByEnd = endPageCfgRaw ? Math.min(endPageCfgRaw, totalPages) : totalPages;
        const lastPage = Math.min(lastByMax, lastByEnd);
        const firstPage = Math.min(Math.max(1, startPageCfg), lastPage);

        let selectedPages: number[];
        const includeList = parsePageSpec(pagesSpec, totalPages);
        const excludeList = new Set(parsePageSpec(excludeSpec, totalPages));
        if (includeList.length > 0) {
          selectedPages = includeList.filter(p => p >= firstPage && p <= lastPage && !excludeList.has(p));
        } else {
          const tmp: number[] = [];
          for (let i = firstPage; i <= lastPage; i++) if (!excludeList.has(i)) tmp.push(i);
          selectedPages = tmp;
        }

        if (selectedPages.length === 0) {
          throw new Error('No pages selected after applying include/exclude.');
        }

        for (const i of selectedPages) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: scaleCfg });

          const width = Math.ceil(viewport.width);
          const height = Math.ceil(viewport.height);
          const canvas = createCanvas(width, height);
          const ctx = canvas.getContext('2d');

          const renderContext = {
            canvasContext: ctx as any,
            viewport,
            // Provide a minimal canvasFactory compatible with pdfjs
            canvasFactory: {
              create(w: number, h: number) {
                const c = createCanvas(w, h);
                const context = c.getContext('2d');
                return { canvas: c, context } as any;
              },
              reset(obj: any, w: number, h: number) {
                obj.canvas.width = w;
                obj.canvas.height = h;
              },
              destroy(obj: any) {
                obj.canvas.width = 0;
                obj.canvas.height = 0;
              },
            },
          } as any;

          await (page as any).render(renderContext).promise;
          const dataUrl = canvas.toDataURL('image/png');
          dataUrls.push({ page: i, dataUrl });
        }
        return dataUrls;
      }

      const pageImages = await pdfToImageDataUrls(pdfData);
      console.log(`Rendered ${pageImages.length} page images`);

      const basePrompt = [
        'You are an expert at reading tables from images.',
        'Extract all tabular data present in the image and output ONLY GitHub-Flavored Markdown (GFM) tables.',
        'Guidelines:',
        '- Reconstruct headers and multi-row cells faithfully.',
        '- If merged cells exist, replicate with repeated values or add footnotes.',
        '- Preserve number formatting and units; do not invent data.',
        '- If multiple tables exist, output them sequentially with a blank line between.',
        '- Do not include any explanations or prose, only Markdown tables.',
        '- If no tables are found, return "No tables detected in the image."',
      ].join('\n');

      // Concurrency-limited OpenAI calls per page
      async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
        const results: R[] = new Array(items.length);
        let nextIndex = 0;
        let active = 0;
        return new Promise((resolve, reject) => {
          const launchNext = () => {
            while (active < limit && nextIndex < items.length) {
              const cur = nextIndex++;
              active++;
              fn(items[cur], cur)
                .then((res) => { results[cur] = res; active--; launchNext(); })
                .catch(reject);
            }
            if (nextIndex >= items.length && active === 0) resolve(results);
          };
          launchNext();
        });
      }

      const pageResults = await mapLimit(pageImages, concurrencyCfg, async ({ page, dataUrl }, idx) => {
        console.log(`Calling OpenAI for PDF page ${page} (${idx + 1}/${pageImages.length})`);
        const response = await openaiClient.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: basePrompt },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0,
        });
        usageInfo.prompt_tokens += response.usage?.prompt_tokens || 0;
        usageInfo.completion_tokens += response.usage?.completion_tokens || 0;
        usageInfo.total_tokens += response.usage?.total_tokens || 0;

        const content = response.choices[0]?.message?.content?.trim() || '';
        return { page, content };
      });

      // Combine with per-page headers and filter empty/no-table responses
      const parts: string[] = pageResults
        .filter(r => r.content && !/No tables detected/i.test(r.content))
        .sort((a, b) => a.page - b.page)
        .map(r => `### Page ${r.page}\n\n${r.content}`);

      markdown = parts.length > 0 ? parts.join('\n\n') : 'No tables detected in the document.';
    } else {
      return NextResponse.json(
        { error: 'Invalid request: no valid image or PDF content found.' },
        { status: 400 }
      );
    }
    
    console.log('Extracted markdown length:', markdown.length);
    console.log('Token usage:', usageInfo);
    return NextResponse.json({ markdown, usage: usageInfo });
  } catch (err: any) {
    console.error('Conversion error:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    return NextResponse.json(
      { 
        error: 'Failed to convert to Markdown.',
        details: err.message 
      },
      { status: 500 }
    );
  }
}

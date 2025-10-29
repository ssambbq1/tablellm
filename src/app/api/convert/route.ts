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
    const maxPagesParam = Number(sp.get('maxPages'));
    const scaleParam = Number(sp.get('scale'));
    const maxPagesCfg = Number.isFinite(maxPagesParam) && maxPagesParam > 0 ? Math.min(maxPagesParam, 50) : envMaxPages;
    const scaleCfg = Number.isFinite(scaleParam) && scaleParam >= 1 && scaleParam <= 4 ? scaleParam : envScale;

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
      async function pdfToImageDataUrls(data: Uint8Array): Promise<string[]> {
        const { createCanvas } = await import('@napi-rs/canvas');
        // Ensure pdfjs fake worker can be resolved in Node/Turbopack
        await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
        const loadingTask = (pdfjsLib as any).getDocument({
          data,
          // Prefer system fonts in Node; fallback to served assets
          useSystemFonts: true,
          // Serve these from Next public/ if available
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          // Allow fetch usage in worker/fake-worker
          useWorkerFetch: true,
        });
        const pdf = await loadingTask.promise;
        const dataUrls: string[] = [];

        // Limit pages to avoid excessive API calls for very large PDFs
        const maxPages = Math.min(pdf.numPages, maxPagesCfg);
        for (let i = 1; i <= maxPages; i++) {
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
          dataUrls.push(dataUrl);
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

      const parts: string[] = [];
      for (let idx = 0; idx < pageImages.length; idx++) {
        const imageUrl = pageImages[idx];
        console.log(`Calling OpenAI for PDF page ${idx + 1}/${pageImages.length}`);
        const response = await openaiClient.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: basePrompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          temperature: 0,
        });

        const pageMarkdown = response.choices[0]?.message?.content?.trim() || '';
        if (pageMarkdown && !/No tables detected/i.test(pageMarkdown)) {
          parts.push(pageMarkdown);
        }

        usageInfo.prompt_tokens += response.usage?.prompt_tokens || 0;
        usageInfo.completion_tokens += response.usage?.completion_tokens || 0;
        usageInfo.total_tokens += response.usage?.total_tokens || 0;
      }

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

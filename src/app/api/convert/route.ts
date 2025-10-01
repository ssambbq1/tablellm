import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

// Initialize the model with proper error handling
let model: ChatOpenAI | null = null;
try {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }
  model = new ChatOpenAI({ 
    model: 'gpt-4o-mini', 
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('OpenAI model initialized successfully');
} catch (error) {
  if (error instanceof Error) {
    console.error('Failed to initialize OpenAI model:', error.message);
  } else {
    console.error('Failed to initialize OpenAI model:', String(error));
  }
}

function buildVisionMessage(dataUrl: string) {
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

  return new HumanMessage({
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    console.log('Received conversion request');
    const body = await request.json();
    const dataUrl = body?.dataUrl;

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      console.log('Invalid image data provided');
      return NextResponse.json(
        { error: 'No image provided. Send JSON with "dataUrl".' },
        { status: 400 }
      );
    }

    const m = model;
    if (!m) {
      return NextResponse.json(
        { error: 'OpenAI model not initialized' },
        { status: 500 }
      );
    }

    console.log('Building vision message...');
    const msg = buildVisionMessage(dataUrl);
    
    console.log('Calling OpenAI API...');
    const response = await m.invoke([msg]);
    console.log('OpenAI API response received');

    // LangChain returns an AIMessage; .content may be string or array depending on model
    const markdown = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n').trim()
        : '';

    console.log('Extracted markdown length:', markdown.length);
    return NextResponse.json({ markdown });
  } catch (err: any) {
    console.error('Conversion error:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    return NextResponse.json(
      { 
        error: 'Failed to convert image to Markdown.',
        details: err.message 
      },
      { status: 500 }
    );
  }
}

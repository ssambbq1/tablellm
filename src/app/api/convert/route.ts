import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import OpenAI from 'openai';

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
    const body = await request.json();
    const dataUrl = body?.dataUrl;

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      console.log('Invalid image data provided');
      return NextResponse.json(
        { error: 'No image provided. Send JSON with "dataUrl".' },
        { status: 400 }
      );
    }

    const openaiClient = openai;
    if (!openaiClient) {
      return NextResponse.json(
        { error: 'OpenAI client not initialized' },
        { status: 500 }
      );
    }

    console.log('Building vision message...');
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
    
    console.log('Calling OpenAI API directly...');
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
    });
    
    console.log('OpenAI API response received');
    console.log('Token usage:', response.usage);

    // Extract markdown content from OpenAI response
    const markdown = response.choices[0]?.message?.content || 'No content extracted';
    
    // Extract token usage information from response
    const usageInfo = {
      prompt_tokens: response.usage?.prompt_tokens || 0,
      completion_tokens: response.usage?.completion_tokens || 0,
      total_tokens: response.usage?.total_tokens || 0
    };

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
        error: 'Failed to convert image to Markdown.',
        details: err.message 
      },
      { status: 500 }
    );
  }
}

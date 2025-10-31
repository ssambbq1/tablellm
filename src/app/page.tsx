'use client';

import { useState, useRef, useCallback, useEffect, SelectHTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Copy, Download, Loader2, FileText, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

interface ExtractedFields {
  [key: string]: string;
}

const CASE_OPTIONS = ['case1', 'case2', 'case3'];

export default function Home() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [pdfTotalPages, setPdfTotalPages] = useState<number | null>(null);
  const [includePages, setIncludePages] = useState<string>('');
  const [excludePages, setExcludePages] = useState<string>('');
  const [pdfPageImages, setPdfPageImages] = useState<{ page: number; url: string }[]>([]);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [markdown, setMarkdown] = useState<string>('');
  const [cases, setCases] = useState<{ [caseName: string]: ExtractedFields | null }>({});
  const [selectedCase, setSelectedCase] = useState<string>(CASE_OPTIONS[0]);
  const [isConverting, setIsConverting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [tableCopySuccess, setTableCopySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [caseOptions, setCaseOptions] = useState<string[]>(CASE_OPTIONS);
  const [changedFields, setChangedFields] = useState<{ [caseName: string]: Set<string> }>({});
  const [editingCell, setEditingCell] = useState<{ caseName: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const { addToast } = useToast();

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleImageBlob = useCallback(async (blob: Blob) => {
    const fakeFile = new File([blob], 'pasted.png', { type: blob.type || 'image/png' });
    const url = await fileToDataUrl(fakeFile);
    setDataUrl(url);
    setUploadedFile(null);
    setImageDataUrls(prev => [...prev, url]);
  }, [fileToDataUrl]);

  const handleRemoveImage = useCallback((index: number) => {
    setImageDataUrls(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setDataUrl(null);
      }
      return next;
    });
  }, []);

  const handleFileChange = useCallback(async (file: File) => {
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const url = await fileToDataUrl(file);
      setDataUrl(url);
      setUploadedFile(null);
      setImageDataUrls(prev => [...prev, url]);
      setPdfTotalPages(null);
      setIncludePages('');
      setExcludePages('');
      setPdfPageImages([]);
    } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      setUploadedFile(file);
      setDataUrl(null);
      setImageDataUrls([]);
      setPdfPageImages([]);
      setIncludePages('');
      setExcludePages('');
      // Count total pages of the selected PDF
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        if ((pdfjsLib as any)?.GlobalWorkerOptions) {
          (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
        }
        const data = new Uint8Array(await file.arrayBuffer());
        const loadingTask = (pdfjsLib as any).getDocument({
          data,
          useWorkerFetch: true,
          useSystemFonts: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
        });
        const pdf = await loadingTask.promise;
        setPdfTotalPages(pdf.numPages || null);
        // Auto-render all pages preview by default
        const total = pdf.numPages;
        const results: { page: number; url: string }[] = [];
        for (let p = 1; p <= total; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          const renderTask: any = (page as any).render({ canvasContext: ctx, viewport });
          await renderTask.promise;
          const url = canvas.toDataURL('image/png');
          results.push({ page: p, url });
        }
        setPdfPageImages(results);
      } catch (e: any) {
        console.error('Failed to read PDF page count:', e);
        setPdfTotalPages(null);
        addToast({
          title: 'PDF ?òÏù¥ÏßÄ ?ΩÍ∏∞ ?§Ìå®',
          description: e?.message || '?åÏùº???ïÏù∏?¥Ï£º?∏Ïöî.',
          type: 'error'
        });
      }
    }
  }, [fileToDataUrl]);

  // Parse page spec: e.g., "1,3,5-7"
  const parsePageSpec = useCallback((spec: string, total: number): number[] => {
    if (!spec) return [];
    const set = new Set<number>();
    spec.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
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
    });
    return Array.from(set).sort((a, b) => a - b);
  }, []);

  const handleRenderPdfPreview = useCallback(async () => {
    if (!uploadedFile) return;
    setIsRenderingPdf(true);
    setPdfPageImages([]);
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      if ((pdfjsLib as any)?.GlobalWorkerOptions) {
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
      }
      const data = new Uint8Array(await uploadedFile.arrayBuffer());
      const loadingTask = (pdfjsLib as any).getDocument({
        data,
        useWorkerFetch: true,
        useSystemFonts: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
      });
      const pdf = await loadingTask.promise;
      const total = pdf.numPages;
      const include = parsePageSpec(includePages, total);
      const exclude = new Set(parsePageSpec(excludePages, total));
      let selected: number[];
      if (include.length > 0) {
        selected = include.filter(n => !exclude.has(n));
      } else {
        selected = Array.from({ length: total }, (_, i) => i + 1).filter(n => !exclude.has(n));
      }
      const MAX_PREVIEW = 10;
      const previewPages = selected.slice(0, MAX_PREVIEW);
      const results: { page: number; url: string }[] = [];
      for (const p of previewPages) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const renderTask: any = (page as any).render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        const url = canvas.toDataURL('image/png');
        results.push({ page: p, url });
      }
      setPdfPageImages(results);
      if (selected.length > MAX_PREVIEW) {
        addToast({
          title: 'ÎØ∏Î¶¨Î≥¥Í∏∞ ?úÌïú',
          description: `?†ÌÉù??${selected.length}?òÏù¥ÏßÄ Ï§?Ï≤òÏùå ${MAX_PREVIEW}?òÏù¥ÏßÄÎß?ÎØ∏Î¶¨Î≥¥Í∏∞Î°??úÏãú?©Îãà??`,
          type: 'info',
          duration: 6000,
        });
      }
    } catch (e: any) {
      console.error('PDF preview render failed:', e);
      addToast({
        title: 'ÎØ∏Î¶¨Î≥¥Í∏∞ ?§Ìå®',
        description: e?.message || '?òÏù¥ÏßÄ ?åÎçîÎß?Ï§??§Î•òÍ∞Ä Î∞úÏÉù?àÏäµ?àÎã§.',
        type: 'error',
      });
    } finally {
      setIsRenderingPdf(false);
    }
  }, [uploadedFile, includePages, excludePages, parsePageSpec, addToast]);

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) await handleImageBlob(blob);
      }
    }
  }, [handleImageBlob]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleFileChange(file);
  }, [handleFileChange]);

  const handleConvert = async () => {
    if (imageDataUrls.length === 0 && !dataUrl && !uploadedFile) return;
    
    setIsConverting(true);
    setMarkdown('Converting...');
    
    try {
      // If multiple pasted images exist, convert them sequentially and aggregate
      if (imageDataUrls.length > 0 && !uploadedFile) {
        let total_tokens = 0, prompt_tokens = 0, completion_tokens = 0;
        const parts: string[] = [];
        for (let i = 0; i < imageDataUrls.length; i++) {
          const u = imageDataUrls[i];
          const resp = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl: u })
          });
          const j = await resp.json();
          if (!resp.ok) throw new Error(j.error || j.details || `?¥Î?ÏßÄ ${i + 1} Ï≤òÎ¶¨ ?§Ìå®`);
          const content = (j.markdown || '').trim();
          if (content && !/No tables detected/i.test(content)) {
            parts.push(`### Image ${i + 1}\n\n${content}`);
          }
          if (j.usage) {
            prompt_tokens += j.usage.prompt_tokens || 0;
            completion_tokens += j.usage.completion_tokens || 0;
            total_tokens += j.usage.total_tokens || 0;
          }
        }
        const combined = parts.length ? parts.join('\n\n') : 'No tables detected in the images.';
        setMarkdown(combined);
        if (total_tokens > 0) {
          const estimatedCost = (total_tokens / 1000) * 0.00015;
          const costKRW = Math.round(estimatedCost * 1400 * 1000) / 1000;
          addToast({
            title: 'Î≥Ä???ÑÎ£å',
            description: `?†ÌÅ∞ ?¨Ïö©?? ${total_tokens} (?ÑÎ°¨?ÑÌä∏ ${prompt_tokens} + ?ëÎãµ ${completion_tokens})\n?àÏÉÅ ÎπÑÏö©: ??${costKRW}??,
            type: 'success',
            duration: 10000
          });
        } else {
          addToast({
            title: 'Î≥Ä???ÑÎ£å',
            description: '?¨Îü¨ ?¥Î?ÏßÄ??Î≥Ä?òÏù¥ ?ÑÎ£å?òÏóà?µÎãà??',
            type: 'success',
            duration: 5000
          });
        }
        return;
      }
      if (uploadedFile) {
        const form = new FormData();
        form.append('file', uploadedFile);
        const params = new URLSearchParams();
        if (includePages.trim()) params.set('pages', includePages.trim());
        if (excludePages.trim()) params.set('exclude', excludePages.trim());
        const qs = params.toString();
        const url = qs ? `/api/convert?${qs}` : '/api/convert';
        const response = await fetch(url, {
          method: 'POST',
          body: form,
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error || json.details || 'Server error');
        }
        setMarkdown(json.markdown || 'No content extracted');
        if (json.usage) {
          const { prompt_tokens, completion_tokens, total_tokens } = json.usage;
          const estimatedCost = (total_tokens / 1000) * 0.00015;
          const costKRW = Math.round(estimatedCost * 1400 * 1000) / 1000;
          addToast({
            title: 'Î≥Ä???ÑÎ£å',
            description: `?†ÌÅ∞ ?¨Ïö©??Ï¥?${total_tokens} (?ÑÎ°¨?ÑÌä∏ ${prompt_tokens} + ?ëÎãµ ${completion_tokens})\\n?àÏÉÅ ÎπÑÏö©: ??${costKRW}??,
            type: 'success',
            duration: 10000
          });
        } else {
          addToast({
            title: 'Î≥Ä???ÑÎ£å',
            description: 'Î≥Ä?òÏù¥ ?ÑÎ£å?òÏóà?µÎãà??(?†ÌÅ∞ ?¨Ïö©???ïÎ≥¥ ?ÜÏùå)',
            type: 'success',
            duration: 5000
          });
        }
        return;
      }
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl })
      });
      
      const json = await response.json();
      
      if (!response.ok) {
        throw new Error(json.error || json.details || 'Server error');
      }
      
      setMarkdown(json.markdown || 'No content extracted');
      
      // Show token usage information
      if (json.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = json.usage;
        const estimatedCost = (total_tokens / 1000) * 0.00015; // GPT-4o-mini pricing approximately
        const costKRW = Math.round(estimatedCost * 1400 * 1000) / 1000;
        addToast({
          title: '?¥Î?ÏßÄ ??ÎßàÌÅ¨?§Ïö¥ Î≥Ä???ÑÎ£å',
          description: `?†ÌÅ∞ ?¨Ïö©?? Ï¥?${total_tokens}Í∞?(?ÑÎ°¨?ÑÌä∏ ${prompt_tokens}Í∞?+ ?ëÎãµ ${completion_tokens}Í∞?\n?àÏÉÅ ÎπÑÏö©: ${costKRW}??,
          type: 'success',
          duration: 10000
        });
      } else {
        addToast({
          title: '?¥Î?ÏßÄ ??ÎßàÌÅ¨?§Ïö¥ Î≥Ä???ÑÎ£å',
          description: 'Î≥Ä?òÏù¥ ?ÑÎ£å?òÏóà?µÎãà?? (?†ÌÅ∞ ?¨Ïö©???ïÎ≥¥ ?ÜÏùå)',
          type: 'success',
          duration: 5000
        });
      }
    } catch (err: any) {
      console.error('Conversion failed:', err);
      setMarkdown(`Error: ${err.message}`);
      addToast({
        title: 'Î≥Ä???§Ìå®',
        description: err.message,
        type: 'error'
      });
    } finally {
      setIsConverting(false);
    }
  };

  const handleCopy = async () => {
    if (!markdown) return;
    
    try {
      await navigator.clipboard.writeText(markdown);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1200);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleExtract = async () => {
    if (!markdown.trim()) return;
    setIsExtracting(true);
    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Extraction failed');
      }
      setCases(prev => {
        const prevCase = prev[selectedCase] || {};
        const newFields = json.fields || {};
        const merged: ExtractedFields = { ...prevCase };
        const changed = new Set<string>();
        Object.keys(newFields).forEach(key => {
          if (newFields[key] && newFields[key] !== prevCase[key]) {
            merged[key] = newFields[key];
            changed.add(key);
          }
        });
        // Í∏∞Ï°¥ Í∞??†Ï? (???∞Ïù¥?∞Ïóê ?ÜÎäî Í∞íÏ? Í∑∏Î?Î°?
        return { ...prev, [selectedCase]: merged };
      });
      setChangedFields(prev => {
        const changed = new Set<string>();
        const prevCase = cases[selectedCase] || {};
        const newFields = json.fields || {};
        Object.keys(newFields).forEach(key => {
          if (newFields[key] && newFields[key] !== prevCase[key]) {
            changed.add(key);
          }
        });
        return { ...prev, [selectedCase]: changed };
      });
      
      // Show token usage information
      if (json.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = json.usage;
        const estimatedCost = (total_tokens / 1000) * 0.00015; // GPT-4o-mini pricing approximately
        const costKRW = Math.round(estimatedCost * 1400 * 1000) / 1000;
        addToast({
          title: 'ÎßàÌÅ¨?§Ïö¥ ??ÏºÄ?¥Ïä§ Ï∂îÏ∂ú ?ÑÎ£å',
          description: `?†ÌÅ∞ ?¨Ïö©?? Ï¥?${total_tokens}Í∞?(?ÑÎ°¨?ÑÌä∏ ${prompt_tokens}Í∞?+ ?ëÎãµ ${completion_tokens}Í∞?\n?àÏÉÅ ÎπÑÏö©: ${costKRW}??,
          type: 'success',
          duration: 10000
        });
      } else {
        addToast({
          title: 'ÎßàÌÅ¨?§Ïö¥ ??ÏºÄ?¥Ïä§ Ï∂îÏ∂ú ?ÑÎ£å',
          description: 'Ï∂îÏ∂ú???ÑÎ£å?òÏóà?µÎãà?? (?†ÌÅ∞ ?¨Ïö©???ïÎ≥¥ ?ÜÏùå)',
          type: 'success',
          duration: 5000
        });
      }
    } catch (err: any) {
      console.error('Extraction failed:', err);
      addToast({
        title: 'Ï∂îÏ∂ú ?§Ìå®',
        description: err.message,
        type: 'error'
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDownload = () => {
    if (!cases[selectedCase]) return;
    
    const order = [
      'manufacturer', 'pump model name', 'rated flow',
      'max flow', 'min flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency', 'shutoff TDH'
    ];
    
    const rows = [['Field', 'Value'], ...order.map(k => [k, cases[selectedCase]?.[k] || ''])];
    const csv = rows.map(r => r.map((cell) => {
      const s = String(cell ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedCase}_pump_data.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyTable = async () => {
    if (!cases[selectedCase]) return;
    
    const order = [
      'manufacturer', 'pump model name', 'rated flow',
      'max flow', 'min flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency', 'shutoff TDH'
    ];
    
    // Create tab-separated values for Excel compatibility
    const rows = [['Field', 'Value'], ...order.map(k => [k, cases[selectedCase]?.[k] || ''])];
    const tsv = rows.map(row => row.join('\t')).join('\n');
    
    try {
      await navigator.clipboard.writeText(tsv);
      setTableCopySuccess(true);
      setTimeout(() => setTableCopySuccess(false), 1200);
    } catch (err) {
      console.error('Copy failed:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = tsv;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setTableCopySuccess(true);
      setTimeout(() => setTableCopySuccess(false), 1200);
    }
  };


  // Add paste event listener
  useEffect(() => {
    const handlePasteEvent = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener('paste', handlePasteEvent);
    return () => document.removeEventListener('paste', handlePasteEvent);
  }, [handlePaste]);

  const order = [
      'manufacturer', 'pump model name', 'rated flow',
      'max flow', 'min flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency', 'shutoff TDH'
  ];

  const handleAddCase = () => {
    let nextNum = 1;
    while (caseOptions.includes(`case${nextNum}`)) nextNum++;
    setCaseOptions([...caseOptions, `case${nextNum}`]);
  };

  const handleRemoveCase = () => {
    if (caseOptions.length <= 1) return;
    // Find the case with the largest number
    const maxCase = caseOptions.reduce((max, cur) => {
      const num = parseInt(cur.replace(/[^\d]/g, ''));
      const maxNum = parseInt(max.replace(/[^\d]/g, ''));
      return num > maxNum ? cur : max;
    }, caseOptions[0]);
    const filtered = caseOptions.filter(c => c !== maxCase);
    setCaseOptions(filtered);
    // If the removed case was selected, select the first remaining case
    if (selectedCase === maxCase) {
      setSelectedCase(filtered[0]);
    }
    setCases(prev => {
      const copy = { ...prev };
      delete copy[maxCase];
      return copy;
    });
  };

  const handleDownloadExcel = () => {
    const order = [
      'manufacturer', 'rated flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency',
      'max flow', 'min flow', 'shutoff TDH', 'pump model name'
    ];
    const header = ['Field', ...caseOptions];
    const rows = [header, ...order.map(field => [field, ...caseOptions.map(c => cases[c]?.[field] || '')])];
    const csv = rows.map(row => row.map(cell => {
      const s = String(cell ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'technical_evaluation_all_cases.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyExcelTable = async () => {
    const order = [
      'manufacturer', 'rated flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency',
      'max flow', 'min flow', 'shutoff TDH', 'pump model name'
    ];
    const header = ['Field', ...caseOptions];
    const rows = [header, ...order.map(field => [field, ...caseOptions.map(c => cases[c]?.[field] || '')])];
    const tsv = rows.map(row => row.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setTableCopySuccess(true);
      setTimeout(() => setTableCopySuccess(false), 1200);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = tsv;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setTableCopySuccess(true);
      setTimeout(() => setTableCopySuccess(false), 1200);
    }
  };

  const handleCellClick = (caseName: string, field: string) => {
    setEditingCell({ caseName, field });
    setEditingValue(cases[caseName]?.[field] || '');
  };

  const handleCellChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingValue(e.target.value);
  };

  const handleCellBlur = () => {
    if (editingCell) {
      setCases(prev => {
        const updated = { ...prev };
        const caseData = { ...(updated[editingCell.caseName] || {}) };
        caseData[editingCell.field] = editingValue;
        updated[editingCell.caseName] = caseData;
        return updated;
      });
    }
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCellBlur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-2">
      <div className="max-w-7xl mx-auto space-y-2">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Data Extractor from Table</h1>
          <p className="text-muted-foreground">
            Paste (Ctrl/Cmd+V) a screenshot of a table or drop/upload below. The server will extract tables as Markdown.
          </p>
        </header>

        <Card>
          <CardContent className="p-2">
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-primary bg-primary/5 rounded-lg p-2 text-center text-primary hover:bg-primary/10 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto h-8 w-12 mb-2" />
              <p className="font-semibold mb-2">
                <strong>Paste</strong> an image here or <strong>drag & drop</strong> an image/PDF.
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Upload image or PDF file
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileChange(file);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Image Table
              </CardTitle>
            </CardHeader>
            <CardContent>
              {imageDataUrls.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 max-h-[480px] overflow-auto">
                  {imageDataUrls.map((u, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="text-xs text-muted-foreground">Image {idx + 1}</div>
                      <div className="relative">
                        <img src={u} alt={`pasted-${idx+1}`} className="w-full h-auto rounded border" />
                        <button
                          type="button"
                          aria-label={`?¥Î?ÏßÄ ${idx + 1} ??†ú`}
                          onClick={(e) => { e.stopPropagation(); handleRemoveImage(idx); }}
                          className="absolute top-1 right-1 inline-flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white shadow p-1"
                          title="?¥Î?ÏßÄ ??†ú"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : dataUrl ? (
                <img
                  src={dataUrl}
                  alt="preview"
                  className="w-full h-auto rounded-lg border"
                />
              ) : uploadedFile ? (
                <div className="text-sm text-muted-foreground border rounded p-2 space-y-2">
                  <div>PDF selected: {uploadedFile.name}{pdfTotalPages ? ` ¬∑ Ï¥??òÏù¥ÏßÄ: ${pdfTotalPages}` : ''}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      placeholder="?¨Ìï®???òÏù¥ÏßÄ (?? 1-5,7,9)"
                      value={includePages}
                      onChange={(e) => setIncludePages(e.target.value)}
                    />
                    <Input
                      placeholder="?úÏô∏???òÏù¥ÏßÄ (?? 2,6)"
                      value={excludePages}
                      onChange={(e) => setExcludePages(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button size="sm" onClick={handleRenderPdfPreview} disabled={isRenderingPdf}>
                      {isRenderingPdf ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> ?åÎçîÎß?..</>
                      ) : (
                        'ÎØ∏Î¶¨Î≥¥Í∏∞ ?ùÏÑ±'
                      )}
                    </Button>
                    {pdfPageImages.length > 0 ? (
                      <span className="text-xs">ÎØ∏Î¶¨Î≥¥Í∏∞ {pdfPageImages.length}Í∞?/span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ÎπÑÏõå?êÎ©¥ ?ÑÏ≤¥ ?òÏù¥ÏßÄÎ•?Î≥Ä?òÌï©?àÎã§. Î≤îÏúÑ???ºÌëúÎ°?Íµ¨Î∂Ñ?òÍ≥† ?Ä?úÎäî Î≤îÏúÑÎ•??òÎ??©Îãà??
                  </p>
                  {pdfPageImages.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 max-h-[480px] overflow-auto">
                      {pdfPageImages.map(img => (
                        <div key={img.page} className="space-y-1">
                          <div className="text-xs text-muted-foreground">Page {img.page}</div>
                          <img src={img.url} alt={`Page ${img.page}`} className="w-full h-auto rounded border" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Markdown</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={handleConvert}
                  disabled={(imageDataUrls.length === 0 && !dataUrl && !uploadedFile) || isConverting}
                  className="flex items-center gap-2"
                >
                  {isConverting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Convert (Image/PDF to MD)
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCopy}
                  disabled={!markdown.trim()}
                  className="flex items-center gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {copySuccess ? 'Copied!' : 'Copy'}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleDownload}
                  disabled={!cases[selectedCase]}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                placeholder="Markdown will appear here..."
                className="min-h-[320px] font-mono"
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Technical Evaluation Sheet
            </CardTitle>
            <div className="flex flex-wrap gap-2 mt-4">
              <div className="flex gap-2 flex-wrap items-center">
                <select
                  id="case-select"
                  value={selectedCase}
                  onChange={e => setSelectedCase(e.target.value)}
                  className="border rounded px-2 py-1"
                  title="Select case"
                  aria-label="Select case"
                >
                  {caseOptions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <Button variant="outline" onClick={handleAddCase}>Add Case</Button>
                <Button variant="outline" onClick={handleRemoveCase} disabled={caseOptions.length <= 1}>Remove Case</Button>
              </div>
              <Button
                onClick={handleExtract}
                disabled={!markdown.trim() || isExtracting}
                className="flex items-center gap-2"
              >
                {isExtracting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Convert (MD to Case) 
              </Button>
              <Button variant="outline" onClick={handleCopyExcelTable}>
                <Copy className="h-4 w-4" />
                {tableCopySuccess ? 'Copied!' : 'Copy Table for Excel'}
              </Button>
              <Button variant="outline" onClick={handleDownloadExcel}>
                <Download className="h-4 w-4" />
                Download Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left border-r">Field</TableHead>
                  {caseOptions.map((c, idx) => (
                    <TableHead key={c} className={`text-left${idx < caseOptions.length - 1 ? ' border-r' : ''}`}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.map(field => (
                  <TableRow key={field}>
                    <TableCell className="font-medium text-left border-r">{field}</TableCell>
                    {caseOptions.map((c, idx) => {
                      const value = cases[c]?.[field] || '';
                      const isChanged = changedFields[c]?.has(field);
                      const isEditing = editingCell && editingCell.caseName === c && editingCell.field === field;
                      return (
                        <TableCell
                          key={c}
                          className={`text-left cursor-pointer${idx < caseOptions.length - 1 ? ' border-r' : ''}`}
                          style={isChanged ? { backgroundColor: '#fff8c6' } : {}}
                          onClick={() => handleCellClick(c, field)}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingValue}
                              autoFocus
                              onChange={handleCellChange}
                              onBlur={handleCellBlur}
                              onKeyDown={handleCellKeyDown}
                              className="w-full px-1 py-0.5 border rounded text-sm"
                              title={`Edit ${field} for ${c}`}
                              aria-label={`Edit ${field} for ${c}`}
                            />
                          ) : (
                            value
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


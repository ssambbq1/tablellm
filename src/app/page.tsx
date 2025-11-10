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
  const DEFAULT_FIELDS = [
    'manufacturer', 'pump model name', 'rated flow',
    'max flow', 'min flow', 'normal flow', 'TDH', 'casing material',
    'shaft material', 'impeller material', 'shaft power', 'pump efficiency', 'shutoff TDH'
  ];
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
  const [editingFieldName, setEditingFieldName] = useState<string>('');
  // Track user intent about fields (deleted or renamed)
  const [deletedFields, setDeletedFields] = useState<string[]>([]);
  const [fieldAliases, setFieldAliases] = useState<Record<string, string>>({});
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
          (pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
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
          title: 'PDF 페이지 읽기 실패',
          description: e?.message || '파일을 확인해주세요.',
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
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
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
          title: '미리보기 제한',
          description: `선택된 ${selected.length}페이지 중 처음 ${MAX_PREVIEW}페이지만 미리보기로 표시합니다.`,
          type: 'info',
          duration: 6000,
        });
      }
    } catch (e: any) {
      console.error('PDF preview render failed:', e);
      addToast({
        title: '미리보기 실패',
        description: e?.message || '페이지 렌더링 중 오류가 발생했습니다.',
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
          if (!resp.ok) throw new Error(j.error || j.details || `이미지 ${i + 1} 처리 실패`);
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
            title: '변환 완료',
            description: `토큰 사용량: ${total_tokens} (프롬프트 ${prompt_tokens} + 응답 ${completion_tokens})\n예상 비용: 약 ${costKRW}원`,
            type: 'success',
            duration: 10000
          });
        } else {
          addToast({
            title: '변환 완료',
            description: '여러 이미지의 변환이 완료되었습니다.',
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
            title: '변환 완료',
            description: `토큰 사용량 총 ${total_tokens} (프롬프트 ${prompt_tokens} + 응답 ${completion_tokens})\\n예상 비용: 약 ${costKRW}원`,
            type: 'success',
            duration: 10000
          });
        } else {
          addToast({
            title: '변환 완료',
            description: '변환이 완료되었습니다 (토큰 사용량 정보 없음)',
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
          title: '이미지 → 마크다운 변환 완료',
          description: `토큰 사용량: 총 ${total_tokens}개 (프롬프트 ${prompt_tokens}개 + 응답 ${completion_tokens}개)\n예상 비용: ${costKRW}원`,
          type: 'success',
          duration: 10000
        });
      } else {
        addToast({
          title: '이미지 → 마크다운 변환 완료',
          description: '변환이 완료되었습니다. (토큰 사용량 정보 없음)',
          type: 'success',
          duration: 5000
        });
      }
    } catch (err: any) {
      console.error('Conversion failed:', err);
      setMarkdown(`Error: ${err.message}`);
      addToast({
        title: '변환 실패',
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
        body: JSON.stringify({ markdown, fields, aliases: fieldAliases })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Extraction failed');
      }
      // Normalize extracted field keys: apply rename aliases and skip deleted
      const deletedSet = new Set(deletedFields);
      const rawFields: Record<string, string> = json.fields || {};
      const mappedFields: Record<string, string> = {};
      Object.keys(rawFields).forEach((key) => {
        const mappedKey = fieldAliases[key] || key;
        if (!deletedSet.has(mappedKey)) {
          mappedFields[mappedKey] = rawFields[key];
        }
      });
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
        // 기존 값 유지 (새 데이터에 없는 값은 그대로)
        return { ...prev, [selectedCase]: merged };
      });
      // Ensure new extracted fields appear as rows
      setFields(prev => {
        const nf = Object.keys(json.fields || {});
        const add = nf.filter(k => !prev.includes(k));
        return add.length ? [...prev, ...add] : prev;
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

      // Reconcile with user intent: remove deleted fields and map aliases
      const aliasKeys = Object.keys(fieldAliases);
      // 1) Update cases: move aliased keys -> target names, drop deleted
      setCases(prev => {
        const updated = { ...prev } as { [caseName: string]: ExtractedFields | null };
        const caseData = { ...(updated[selectedCase] || {}) } as ExtractedFields;
        // Move alias keys
        aliasKeys.forEach(oldKey => {
          const newKey = fieldAliases[oldKey];
          if (oldKey in caseData) {
            // If newKey already exists, prefer existing value unless oldKey has a non-empty value
            const oldVal = caseData[oldKey];
            if (!caseData[newKey] && oldVal) {
              caseData[newKey] = oldVal;
            }
            delete caseData[oldKey];
          }
        });
        // Drop deleted
        deletedFields.forEach(df => {
          if (df in caseData) delete caseData[df];
        });
        updated[selectedCase] = caseData;
        return updated;
      });

      // 2) Update fields list: drop deleted and remove old alias keys if target exists
      setFields(prev => {
        const targetSet = new Set(Object.values(fieldAliases));
        const oldAliasSet = new Set(Object.keys(fieldAliases));
        const deletedSet2 = new Set(deletedFields);
        const filtered = prev.filter(f => !deletedSet2.has(f));
        // Remove old alias key if target also present
        const finalList = filtered.filter(f => !(oldAliasSet.has(f) && targetSet.has(fieldAliases[f] || '')));
        return finalList;
      });
      
      // Show token usage information
      if (json.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = json.usage;
        const estimatedCost = (total_tokens / 1000) * 0.00015; // GPT-4o-mini pricing approximately
        const costKRW = Math.round(estimatedCost * 1400 * 1000) / 1000;
        addToast({
          title: '마크다운 → 케이스 추출 완료',
          description: `토큰 사용량: 총 ${total_tokens}개 (프롬프트 ${prompt_tokens}개 + 응답 ${completion_tokens}개)\n예상 비용: ${costKRW}원`,
          type: 'success',
          duration: 10000
        });
      } else {
        addToast({
          title: '마크다운 → 케이스 추출 완료',
          description: '추출이 완료되었습니다. (토큰 사용량 정보 없음)',
          type: 'success',
          duration: 5000
        });
      }
    } catch (err: any) {
      console.error('Extraction failed:', err);
      addToast({
        title: '추출 실패',
        description: err.message,
        type: 'error'
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDownload = () => {
    if (!cases[selectedCase]) return;
    
    const rows = [['Field', 'Value'], ...fields.map(k => [k, cases[selectedCase]?.[k] || ''])];
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
    
    // Create tab-separated values for Excel compatibility
    const rows = [['Field', 'Value'], ...fields.map(k => [k, cases[selectedCase]?.[k] || ''])];
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

  // Fields are managed dynamically via `fields` state

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
    const header = ['Field', ...caseOptions];
    const rows = [header, ...fields.map(field => [field, ...caseOptions.map(c => cases[c]?.[field] || '')])];
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
    const header = ['Field', ...caseOptions];
    const rows = [header, ...fields.map(field => [field, ...caseOptions.map(c => cases[c]?.[field] || '')])];
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

  const handleFieldNameClick = (index: number) => {
    setEditingFieldIndex(index);
    setEditingFieldName(fields[index] || '');
  };

  const handleFieldNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingFieldName(e.target.value);
  };

  const commitFieldRename = (index: number) => {
    const prevName = fields[index];
    const nextName = editingFieldName.trim();
    if (!nextName) {
      setEditingFieldIndex(null);
      setEditingFieldName('');
      return;
    }
    if (nextName !== prevName && fields.includes(nextName)) {
      addToast({
        title: '중복 항목 이름',
        description: '이미 존재하는 항목 이름입니다.',
        type: 'error'
      });
      return;
    }
    setFields(prev => {
      const copy = [...prev];
      copy[index] = nextName;
      return copy;
    });
    // Record alias so future extractions map old -> new and un-delete target
    if (nextName !== prevName) {
      setFieldAliases(prev => ({ ...prev, [prevName]: nextName }));
      setDeletedFields(prev => prev.filter(f => f !== nextName));
    }
    if (nextName !== prevName) {
      setCases(prev => {
        const updated: { [caseName: string]: ExtractedFields | null } = { ...prev };
        Object.keys(updated).forEach(cn => {
          const data = { ...(updated[cn] || {}) };
          if (prevName in data) {
            const val = data[prevName];
            delete data[prevName];
            data[nextName] = val;
            updated[cn] = data;
          } else if (data[prevName] !== undefined) {
            delete data[prevName];
            updated[cn] = data;
          }
        });
        return updated;
      });
      setChangedFields(prev => {
        const copy: { [caseName: string]: Set<string> } = {} as any;
        Object.keys(prev).forEach(cn => {
          const s = new Set(prev[cn] || []);
          if (s.has(prevName)) {
            s.delete(prevName);
            s.add(nextName);
          }
          copy[cn] = s;
        });
        return copy;
      });
    }
    setEditingFieldIndex(null);
    setEditingFieldName('');
  };

  const handleFieldNameBlur = () => {
    if (editingFieldIndex !== null) commitFieldRename(editingFieldIndex);
  };

  const handleFieldNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && editingFieldIndex !== null) {
      e.preventDefault();
      commitFieldRename(editingFieldIndex);
    } else if (e.key === 'Escape') {
      setEditingFieldIndex(null);
      setEditingFieldName('');
    }
  };

  const handleAddField = () => {
    let base = 'new field';
    let name = base;
    let i = 1;
    while (fields.includes(name)) {
      name = `${base} ${i++}`;
    }
    setFields(prev => [...prev, name]);
    // If user previously deleted a field with the same name, un-delete it
    setDeletedFields(prev => prev.filter(f => f !== name));
  };

  const handleRemoveField = (index: number) => {
    const field = fields[index];
    setFields(prev => prev.filter((_, i) => i !== index));
    // Remember deletion so extraction won’t re-add it
    setDeletedFields(prev => (prev.includes(field) ? prev : [...prev, field]));
    setCases(prev => {
      const updated: { [caseName: string]: ExtractedFields | null } = { ...prev };
      Object.keys(updated).forEach(cn => {
        const data = { ...(updated[cn] || {}) };
        if (field in data) {
          delete data[field];
          updated[cn] = data;
        }
      });
      return updated;
    });
    setChangedFields(prev => {
      const copy: { [caseName: string]: Set<string> } = {} as any;
      Object.keys(prev).forEach(cn => {
        const s = new Set(prev[cn] || []);
        if (s.has(field)) s.delete(field);
        copy[cn] = s;
      });
      return copy;
    });
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
                          aria-label={`이미지 ${idx + 1} 삭제`}
                          onClick={(e) => { e.stopPropagation(); handleRemoveImage(idx); }}
                          className="absolute top-1 right-1 inline-flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white shadow p-1"
                          title="이미지 삭제"
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
                  <div>PDF selected: {uploadedFile.name}{pdfTotalPages ? ` · 총 페이지: ${pdfTotalPages}` : ''}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      placeholder="포함할 페이지 (예: 1-5,7,9)"
                      value={includePages}
                      onChange={(e) => setIncludePages(e.target.value)}
                    />
                    <Input
                      placeholder="제외할 페이지 (예: 2,6)"
                      value={excludePages}
                      onChange={(e) => setExcludePages(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button size="sm" onClick={handleRenderPdfPreview} disabled={isRenderingPdf}>
                      {isRenderingPdf ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> 렌더링...</>
                      ) : (
                        '미리보기 생성'
                      )}
                    </Button>
                    {pdfPageImages.length > 0 ? (
                      <span className="text-xs">미리보기 {pdfPageImages.length}개</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    비워두면 전체 페이지를 변환합니다. 범위는 쉼표로 구분하고 대시는 범위를 의미합니다.
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
                <Button variant="outline" onClick={handleAddField}>Add Field</Button>
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
                {fields.map((field, rowIdx) => (
                  <TableRow key={`${field}-${rowIdx}`}>
                    <TableCell className="font-medium text-left border-r">
                      <div className="flex items-center justify-between gap-2">
                        {editingFieldIndex === rowIdx ? (
                          <input
                            type="text"
                            value={editingFieldName}
                            autoFocus
                            onChange={handleFieldNameChange}
                            onBlur={handleFieldNameBlur}
                            onKeyDown={handleFieldNameKeyDown}
                            className="w-full px-1 py-0.5 border rounded text-sm"
                            title={`Edit field name`}
                            aria-label={`Edit field name`}
                          />
                        ) : (
                          <span className="cursor-pointer" onClick={() => handleFieldNameClick(rowIdx)}>{field}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveField(rowIdx)}
                          title="Remove field"
                          aria-label="Remove field"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    {caseOptions.map((c, idx) => {
                      const value = cases[c]?.[field] || '';
                      const isChanged = changedFields[c]?.has(field);
                      const isEditing = editingCell && editingCell.caseName === c && editingCell.field === field;
                      return (
                        <TableCell
                          key={c}
                          className={`text-left cursor-pointer${idx < caseOptions.length - 1 ? ' border-r' : ''}`}
                          style={isChanged ? { backgroundColor: '#fff8c6' } : {}}
                          onClick={() => { if (!isEditing) handleCellClick(c, field); }}
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

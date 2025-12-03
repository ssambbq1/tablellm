'use client';

import { useState, useRef, useCallback, useEffect, SelectHTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Copy, Download, Loader2, FileText, X, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

interface ExtractedFields {
  [key: string]: string;
}

const CASE_OPTIONS = ['case1', 'case2', 'case3'];

const normalizeSelection = (sel: { startRow: number; startCol: number; endRow: number; endCol: number }) => ({
  startRow: Math.min(sel.startRow, sel.endRow),
  endRow: Math.max(sel.startRow, sel.endRow),
  startCol: Math.min(sel.startCol, sel.endCol),
  endCol: Math.max(sel.startCol, sel.endCol),
});

interface GridSnapshot {
  fields: string[];
  cases: { [caseName: string]: ExtractedFields | null };
  changedFields: { [caseName: string]: Set<string> };
  deletedFields: string[];
  fieldAliases: Record<string, string>;
  caseOptions: string[];
  selectedCase: string;
}

const cloneCases = (source: { [caseName: string]: ExtractedFields | null }) => {
  const result: { [caseName: string]: ExtractedFields | null } = {};
  Object.keys(source).forEach((key) => {
    const value = source[key];
    result[key] = value ? { ...value } : null;
  });
  return result;
};

const cloneChangedFields = (source: { [caseName: string]: Set<string> }) => {
  const result: { [caseName: string]: Set<string> } = {};
  Object.keys(source).forEach((key) => {
    result[key] = new Set(source[key] || []);
  });
  return result;
};

const cloneSnapshot = (snapshot: GridSnapshot): GridSnapshot => ({
  fields: [...snapshot.fields],
  cases: cloneCases(snapshot.cases),
  changedFields: cloneChangedFields(snapshot.changedFields),
  deletedFields: [...snapshot.deletedFields],
  fieldAliases: { ...snapshot.fieldAliases },
  caseOptions: [...snapshot.caseOptions],
  selectedCase: snapshot.selectedCase,
});

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
  const gridContainerRef = useRef<HTMLDivElement>(null);
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
  // Column sizing (Excel-like)
  const DEFAULT_FIELD_COL_WIDTH = 220;
  const DEFAULT_CASE_COL_WIDTH = 140;
  const MIN_COL_WIDTH = 80;
  const MAX_COL_WIDTH = 600;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeInfoRef = useRef<{ startX: number; startWidth: number; colKey: string } | null>(null);
  const [gridSelection, setGridSelection] = useState<{ startRow: number; startCol: number; endRow: number; endCol: number } | null>(null);
  const [selectionLockedColumn, setSelectionLockedColumn] = useState<number | null>(null);
  const lockSelectionToFieldRef = useRef(false);
  const [isSelectingCells, setIsSelectingCells] = useState(false);
  const hasDraggedSelectionRef = useRef(false);
  const { addToast } = useToast();
  const [history, setHistory] = useState<GridSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<GridSnapshot[]>([]);
  const [selectFlash, setSelectFlash] = useState(false);
  const [isHorizontalView, setIsHorizontalView] = useState(false);
  const [showUploadPanel, setShowUploadPanel] = useState(true);
  const [showImagePanel, setShowImagePanel] = useState(true);
  const [showMarkdownPanel, setShowMarkdownPanel] = useState(true);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [markdownZoom, setMarkdownZoom] = useState(1);
  const [tableZoom, setTableZoom] = useState(1);
  const pasteCardRef = useRef<HTMLDivElement>(null);
  const imageCardRef = useRef<HTMLDivElement>(null);
  const markdownCardRef = useRef<HTMLDivElement>(null);
  const tableCardRef = useRef<HTMLDivElement>(null);
  const TARGET_ROW_WIDTH = 1200; // Align panels horizontally
  const HALF_ROW_WIDTH = TARGET_ROW_WIDTH / 2;
  const MIN_PASTE_SIZE = { width: 1000, height: 300 };
  const MIN_IMAGE_SIZE = { width: 560, height: 380 };
  const MIN_MARKDOWN_SIZE = { width: 560, height: 380 };
  const MIN_TABLE_SIZE = { width: 1000, height: 540 };
  const DEFAULT_PASTE_SIZE = { width: TARGET_ROW_WIDTH, height: 340 };
  const DEFAULT_IMAGE_SIZE = { width: HALF_ROW_WIDTH, height: 440 };
  const DEFAULT_MARKDOWN_SIZE = { width: HALF_ROW_WIDTH, height: 440 };
  const DEFAULT_TABLE_SIZE = { width: TARGET_ROW_WIDTH, height: 620 };

  const clampSize = useCallback((size: { width: number; height: number }, min: { width: number; height: number }) => ({
    width: Math.max(min.width, size.width),
    height: Math.max(min.height, size.height),
  }), []);

  const [pasteSize, setPasteSize] = useState<{ width: number; height: number }>(DEFAULT_PASTE_SIZE);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>(DEFAULT_IMAGE_SIZE);
  const [markdownSize, setMarkdownSize] = useState<{ width: number; height: number }>(DEFAULT_MARKDOWN_SIZE);
  const [tableSize, setTableSize] = useState<{ width: number; height: number }>(DEFAULT_TABLE_SIZE);
  const DEFAULT_PASTE_POS = { x: 16, y: 16 };
  const DEFAULT_IMAGE_POS = { x: 16, y: DEFAULT_PASTE_SIZE.height + 48 };
  const DEFAULT_MARKDOWN_POS = { x: HALF_ROW_WIDTH + 32, y: DEFAULT_PASTE_SIZE.height + 48 };
  const DEFAULT_TABLE_POS = { x: 16, y: DEFAULT_PASTE_SIZE.height + Math.max(DEFAULT_IMAGE_SIZE.height, DEFAULT_MARKDOWN_SIZE.height) + 96 };
  const [pastePos, setPastePos] = useState<{ x: number; y: number }>(DEFAULT_PASTE_POS);
  const [imagePos, setImagePos] = useState<{ x: number; y: number }>(DEFAULT_IMAGE_POS);
  const [markdownPos, setMarkdownPos] = useState<{ x: number; y: number }>(DEFAULT_MARKDOWN_POS);
  const [tablePos, setTablePos] = useState<{ x: number; y: number }>(DEFAULT_TABLE_POS);

  const snapshotCurrentState = useCallback((): GridSnapshot => cloneSnapshot({
    fields,
    cases,
    changedFields,
    deletedFields,
    fieldAliases,
    caseOptions,
    selectedCase,
  }), [fields, cases, changedFields, deletedFields, fieldAliases, caseOptions, selectedCase]);

  const pushHistory = useCallback(() => {
    setHistory(prev => [...prev, snapshotCurrentState()]);
    setRedoStack([]);
  }, [snapshotCurrentState]);

  const applySnapshot = useCallback((snapshot: GridSnapshot) => {
    const cloned = cloneSnapshot(snapshot);
    setFields(cloned.fields);
    setCases(cloned.cases);
    setChangedFields(() => cloned.changedFields);
    setDeletedFields(cloned.deletedFields);
    setFieldAliases(cloned.fieldAliases);
    setCaseOptions(cloned.caseOptions);
    setSelectedCase(cloned.selectedCase);
    setGridSelection(null);
    setSelectionLockedColumn(null);
    lockSelectionToFieldRef.current = false;
    setEditingCell(null);
    setEditingFieldIndex(null);
    setEditingValue('');
  }, []);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (!prev.length) return prev;
      const nextHistory = [...prev];
      const snapshot = nextHistory.pop()!;
      setRedoStack(stack => [snapshotCurrentState(), ...stack]);
      applySnapshot(snapshot);
      return nextHistory;
    });
  }, [snapshotCurrentState, applySnapshot]);

  const redoHistory = useCallback(() => {
    setRedoStack(prev => {
      if (!prev.length) return prev;
      const [snapshot, ...rest] = prev;
      setHistory(hist => [...hist, snapshotCurrentState()]);
      applySnapshot(snapshot);
      return rest;
    });
  }, [snapshotCurrentState, applySnapshot]);

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

  const handleRemovePdfPage = useCallback((index: number) => {
    setPdfPageImages(prev => prev.filter((_, i) => i !== index));
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadSize = (key: string, fallback: { width: number; height: number }, min: { width: number; height: number }) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          return clampSize(parsed, min);
        }
      } catch (e) {
        console.warn('Failed to load size', key, e);
      }
      return fallback;
    };
    const loadPos = (key: string, fallback: { x: number; y: number }) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          return { x: Math.max(0, parsed.x), y: Math.max(0, parsed.y) };
        }
      } catch (e) {
        console.warn('Failed to load position', key, e);
      }
      return fallback;
    };
    setPasteSize(loadSize('panel:paste', DEFAULT_PASTE_SIZE, MIN_PASTE_SIZE));
    setImageSize(loadSize('panel:image', DEFAULT_IMAGE_SIZE, MIN_IMAGE_SIZE));
    setMarkdownSize(loadSize('panel:markdown', DEFAULT_MARKDOWN_SIZE, MIN_MARKDOWN_SIZE));
    setTableSize(loadSize('panel:table', DEFAULT_TABLE_SIZE, MIN_TABLE_SIZE));
    setPastePos(loadPos('panelpos:paste', DEFAULT_PASTE_POS));
    setImagePos(loadPos('panelpos:image', DEFAULT_IMAGE_POS));
    setMarkdownPos(loadPos('panelpos:markdown', DEFAULT_MARKDOWN_POS));
    setTablePos(loadPos('panelpos:table', DEFAULT_TABLE_POS));
  }, [clampSize]);

  const persistSize = useCallback((key: string, size: { width: number; height: number }) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(size));
    } catch (e) {
      console.warn('Failed to persist size', key, e);
    }
  }, []);

  useEffect(() => { persistSize('panel:paste', pasteSize); }, [pasteSize, persistSize]);
  useEffect(() => { persistSize('panel:image', imageSize); }, [imageSize, persistSize]);
  useEffect(() => { persistSize('panel:markdown', markdownSize); }, [markdownSize, persistSize]);
  useEffect(() => { persistSize('panel:table', tableSize); }, [tableSize, persistSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('panelpos:paste', JSON.stringify(pastePos)); } catch (e) { console.warn('pos save failed', e); }
  }, [pastePos]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('panelpos:image', JSON.stringify(imagePos)); } catch (e) { console.warn('pos save failed', e); }
  }, [imagePos]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('panelpos:markdown', JSON.stringify(markdownPos)); } catch (e) { console.warn('pos save failed', e); }
  }, [markdownPos]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('panelpos:table', JSON.stringify(tablePos)); } catch (e) { console.warn('pos save failed', e); }
  }, [tablePos]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
    const observers: ResizeObserver[] = [];
    const register = (ref: React.RefObject<HTMLDivElement>, setter: (v: { width: number; height: number }) => void, minSize: { width: number; height: number }) => {
      if (!ref.current) return;
      const obs = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry?.contentRect) return;
        const { width, height } = entry.contentRect;
        setter(clampSize({ width, height }, minSize));
      });
      obs.observe(ref.current);
      observers.push(obs);
    };
    register(pasteCardRef, setPasteSize, MIN_PASTE_SIZE);
    register(imageCardRef, setImageSize, MIN_IMAGE_SIZE);
    register(markdownCardRef, setMarkdownSize, MIN_MARKDOWN_SIZE);
    register(tableCardRef, setTableSize, MIN_TABLE_SIZE);
    return () => observers.forEach(o => o.disconnect());
  }, [clampSize]);

  const handleRenderPdfPreview = useCallback(async () => {
    if (!uploadedFile) return;
    setIsRenderingPdf(true);
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
      setPdfPageImages(prev => [...prev, ...results]);
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleFileChange(file);
  }, [handleFileChange]);

  const extractDenseTable = (matrix: any[][]) => {
    let minRow = Infinity, minCol = Infinity, maxRow = -1, maxCol = -1;
    matrix.forEach((row, rIdx) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, cIdx) => {
        const val = cell == null ? '' : String(cell).trim();
        if (val !== '') {
          minRow = Math.min(minRow, rIdx);
          maxRow = Math.max(maxRow, rIdx);
          minCol = Math.min(minCol, cIdx);
          maxCol = Math.max(maxCol, cIdx);
        }
      });
    });
    if (maxRow === -1 || maxCol === -1) return null;
    const table: string[][] = [];
    for (let r = minRow; r <= maxRow; r++) {
      const src = matrix[r] || [];
      const row: string[] = [];
      for (let c = minCol; c <= maxCol; c++) {
        const cell = src[c];
        row.push(cell == null ? '' : String(cell).trim());
      }
      table.push(row);
    }
    return table;
  };

  const decodeCsvText = (buffer: ArrayBuffer) => {
    const candidates = ['utf-8', 'euc-kr', 'cp949', 'iso-8859-1'];
    const bytes = new Uint8Array(buffer);
    let best = { text: '', replacements: Number.POSITIVE_INFINITY };
    candidates.forEach(enc => {
      try {
        const dec = new TextDecoder(enc as any, { fatal: false });
        const text = dec.decode(bytes);
        const replacements = (text.match(/\uFFFD/g) || []).length;
        if (replacements < best.replacements) {
          best = { text, replacements };
        }
      } catch (_e) {
        // ignore unsupported encoding
      }
    });
    if (best.replacements === Number.POSITIVE_INFINITY) {
      const utf8 = new TextDecoder('utf-8').decode(bytes);
      return utf8;
    }
    return best.text;
  };

  const handleExcelImport = useCallback(async (file: File) => {
    if (!file) return;
    const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!isExcel) {
      addToast({
        title: '엑셀 파일만 지원',
        description: 'xlsx, xls, csv 파일을 선택해주세요.',
        type: 'error'
      });
      return;
    }
    setIsImportingExcel(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const isCsv = /\.csv$/i.test(file.name);
      const workbook = isCsv
        ? XLSX.read(decodeCsvText(buffer), { type: 'string' })
        : XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames?.[0];
      if (!sheetName) {
        throw new Error('시트를 찾을 수 없습니다.');
      }
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];
      const dense = extractDenseTable(matrix);
      if (!dense || dense.length < 2 || dense[0].length < 2) {
        throw new Error('표 형태의 데이터를 찾지 못했습니다. 첫 행은 케이스 이름, 첫 열은 필드명이어야 합니다.');
      }
      const header = dense[0] || [];
      const rawCaseNames = header.slice(1);
      const seen = new Set<string>();
      const caseNames = rawCaseNames.map((name, idx) => {
        const base = (name == null ? '' : String(name).trim()) || `case${idx + 1}`;
        let candidate = base;
        let suffix = 1;
        while (seen.has(candidate)) {
          candidate = `${base} (${suffix++})`;
        }
        seen.add(candidate);
        return candidate;
      });
      if (!caseNames.length) {
        caseNames.push('case1');
      }
      const body = dense.slice(1);
      const nextFields: string[] = [];
      const nextCases: { [caseName: string]: ExtractedFields | null } = {};
      caseNames.forEach(c => { nextCases[c] = {}; });

      body.forEach(row => {
        const rawField = row?.[0] == null ? '' : String(row[0]).trim();
        if (!rawField) return;
        let fieldName = rawField;
        let suffix = 1;
        while (nextFields.includes(fieldName)) {
          fieldName = `${rawField} (${suffix++})`;
        }
        nextFields.push(fieldName);
        caseNames.forEach((c, idx) => {
          const cell = row[idx + 1];
          const val = cell == null ? '' : String(cell).trim();
          if (val) {
            const data = nextCases[c] || {};
            data[fieldName] = val;
            nextCases[c] = data;
          }
        });
      });

      if (!nextFields.length) {
        throw new Error('필드 열이 비어 있습니다. 엑셀의 첫 번째 열에 필드명을 입력해주세요.');
      }

      pushHistory();
      setFields(nextFields);
      setCases(nextCases);
      setCaseOptions(caseNames);
      setSelectedCase(caseNames[0]);
      setChangedFields(() => {
        const result: { [caseName: string]: Set<string> } = {};
        caseNames.forEach(c => { result[c] = new Set(nextFields); });
        return result;
      });
      setDeletedFields([]);
      setFieldAliases({});
      setGridSelection(null);
      setSelectionLockedColumn(null);
      lockSelectionToFieldRef.current = false;

      addToast({
        title: 'Excel 로딩 완료',
        description: `${file.name}에서 ${nextFields.length}개 필드와 ${caseNames.length}개 케이스를 불러왔습니다.`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Excel import failed:', err);
      addToast({
        title: 'Excel 로딩 실패',
        description: err?.message || '엑셀 파일을 불러오지 못했습니다.',
        type: 'error'
      });
    } finally {
      setIsImportingExcel(false);
    }
  }, [addToast, pushHistory]);

  const handleExcelFileInput = useCallback(async (file: File | null) => {
    if (!file) return;
    await handleExcelImport(file);
    if (excelInputRef.current) {
      excelInputRef.current.value = '';
    }
  }, [handleExcelImport]);

  const handleExcelDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
      await handleExcelImport(file);
    }
  }, [handleExcelImport]);

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


  // Fields are managed dynamically via `fields` state

  const handleAddCase = () => {
    pushHistory();
    let nextNum = 1;
    while (caseOptions.includes(`case${nextNum}`)) nextNum++;
    setCaseOptions([...caseOptions, `case${nextNum}`]);
  };

  const handleRemoveCase = () => {
    if (caseOptions.length <= 1) return;
    pushHistory();
    const caseToRemove = selectedCase || caseOptions[caseOptions.length - 1];
    const filtered = caseOptions.filter(c => c !== caseToRemove);
    const fallBackCase = filtered[0] || CASE_OPTIONS[0];
    setCaseOptions(filtered);
    setSelectedCase(fallBackCase);
    setCases(prev => {
      const copy = { ...prev };
      delete copy[caseToRemove];
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

  const buildSelectionTsv = useCallback(() => {
    if (!gridSelection) return null;
    const isFieldOnlySelection = selectionLockedColumn === 0;
    const sel = {
      startRow: Math.min(gridSelection.startRow, gridSelection.endRow),
      endRow: Math.max(gridSelection.startRow, gridSelection.endRow),
      startCol: isFieldOnlySelection ? 0 : Math.min(gridSelection.startCol, gridSelection.endCol),
      endCol: isFieldOnlySelection ? 0 : Math.max(gridSelection.startCol, gridSelection.endCol),
    };
    const rows: string[][] = [];
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      const row: string[] = [];
      for (let c = sel.startCol; c <= sel.endCol; c++) {
        if (c === 0) {
          row.push(fields[r] ?? '');
        } else {
          const caseIdx = c - 1;
          const caseName = caseOptions[caseIdx];
          row.push(cases[caseName]?.[fields[r]] || '');
        }
      }
      rows.push(row);
    }
    return rows.map(r => r.join('\t')).join('\n');
  }, [gridSelection, fields, caseOptions, cases, selectionLockedColumn]);

  const triggerCopyFeedback = useCallback(() => {
    setTableCopySuccess(true);
    setTimeout(() => setTableCopySuccess(false), 1200);
  }, []);

  const copySelectionToClipboard = useCallback(async () => {
    const tsv = buildSelectionTsv();
    if (!tsv) return;
    try {
      await navigator.clipboard.writeText(tsv);
      triggerCopyFeedback();
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = tsv;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      triggerCopyFeedback();
    }
  }, [buildSelectionTsv]);

  const pasteRangeToGrid = useCallback((text: string) => {
    if (!text.trim()) return;
    pushHistory();
    // Preserve empty lines so blank rows are also pasted
    const lines = text.replace(/\r/g, '').split('\n');
    const matrix = lines.map(line => line.split('\t'));
    const sel = normalizeSelection(gridSelection ?? { startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    let nextFields = [...fields];
    const aliasUpdates: Record<string, string> = {};
    const undelete = new Set<string>();

    const ensureFieldName = (idx: number) => {
      if (!nextFields[idx]) {
        let candidate = `field ${idx + 1}`;
        let suffix = 1;
        while (nextFields.includes(candidate)) {
          candidate = `field ${idx + 1} (${suffix++})`;
        }
        nextFields[idx] = candidate;
      }
      return nextFields[idx];
    };

    const requiredRows = sel.startRow + matrix.length;
    for (let i = nextFields.length; i < requiredRows; i++) {
      ensureFieldName(i);
    }

    const nextCases: { [caseName: string]: ExtractedFields | null } = {};
    const nextChanged: { [caseName: string]: Set<string> } = {};
    caseOptions.forEach(c => {
      nextCases[c] = { ...(cases[c] || {}) };
      nextChanged[c] = new Set(changedFields[c] || []);
    });

    matrix.forEach((rowVals, rIdx) => {
      const rowIndex = sel.startRow + rIdx;
      const currentFieldName = ensureFieldName(rowIndex);
      rowVals.forEach((rawVal, cIdx) => {
        const colIndex = sel.startCol + cIdx;
        const value = rawVal ?? '';
        if (colIndex === 0) {
          const newName = value || currentFieldName;
          if (newName !== currentFieldName) {
            const prevName = nextFields[rowIndex];
            nextFields[rowIndex] = newName;
            aliasUpdates[prevName] = newName;
            undelete.add(newName);
            caseOptions.forEach(cn => {
              const data = nextCases[cn] || {};
              if (prevName in data) {
                const val = data[prevName];
                delete data[prevName];
                data[newName] = val;
                nextCases[cn] = data;
              }
              const changedSet = nextChanged[cn];
              if (changedSet.has(prevName)) {
                changedSet.delete(prevName);
                changedSet.add(newName);
              }
            });
          }
        } else {
          const caseIdx = colIndex - 1;
          if (caseIdx < caseOptions.length) {
            const caseName = caseOptions[caseIdx];
            const data = nextCases[caseName] || {};
            data[nextFields[rowIndex]] = value;
            nextCases[caseName] = data;
            const changedSet = nextChanged[caseName];
            changedSet.add(nextFields[rowIndex]);
          }
        }
      });
    });

    setFields(nextFields);
    setCases(nextCases);
    setChangedFields(() => {
      const result: { [caseName: string]: Set<string> } = {};
      Object.keys(nextChanged).forEach(cn => {
        result[cn] = new Set(nextChanged[cn]);
      });
      return result;
    });
    if (Object.keys(aliasUpdates).length > 0) {
      setFieldAliases(prev => ({ ...prev, ...aliasUpdates }));
    }
    if (undelete.size > 0) {
      setDeletedFields(prev => prev.filter(f => !undelete.has(f)));
    }
  }, [gridSelection, fields, caseOptions, cases, changedFields, pushHistory]);

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    const target = e.target as HTMLElement | null;
    const isEditableTarget = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const isInsideGrid = target && gridContainerRef.current && gridContainerRef.current.contains(target);
    const text = e.clipboardData.getData('text');

    if (isInsideGrid && !isEditableTarget && text && text.length > 0) {
      e.preventDefault();
      pasteRangeToGrid(text);
      return;
    }

    // Only treat the clipboard contents as an image if we didn't already consume tabular text
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          await handleImageBlob(blob);
          return;
        }
      }
    }
  }, [handleImageBlob, pasteRangeToGrid]);

  // Add paste event listener
  useEffect(() => {
    const handlePasteEvent = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener('paste', handlePasteEvent);
    return () => document.removeEventListener('paste', handlePasteEvent);
  }, [handlePaste]);

  useEffect(() => {
    const handleCopyEvent = (e: ClipboardEvent) => {
      if (!gridSelection) return;
      const target = e.target as HTMLElement | null;
      const isInsideGrid = target && gridContainerRef.current && gridContainerRef.current.contains(target);
      if (!isInsideGrid) return;
      const tsv = buildSelectionTsv();
      if (!tsv) return;
      if (e.clipboardData) {
        e.preventDefault();
        e.clipboardData.setData('text/plain', tsv);
        triggerCopyFeedback();
      }
    };
    document.addEventListener('copy', handleCopyEvent);
    return () => document.removeEventListener('copy', handleCopyEvent);
  }, [gridSelection, buildSelectionTsv, triggerCopyFeedback]);

  useEffect(() => {
    setGridSelection(null);
    setSelectionLockedColumn(null);
    lockSelectionToFieldRef.current = false;
  }, [isHorizontalView]);

  useEffect(() => {
    if (!selectedCase) return;
    setSelectFlash(true);
    let toggles = 0;
    const flashInterval = setInterval(() => {
      toggles += 1;
      setSelectFlash(prev => !prev);
      if (toggles >= 3) {
        clearInterval(flashInterval);
        setSelectFlash(false);
      }
    }, 180);
    return () => clearInterval(flashInterval);
  }, [selectedCase]);

  const clearSelection = useCallback(() => {
    if (!gridSelection) return;
    pushHistory();
    const sel = normalizeSelection(gridSelection);
    const rowsToRemove = new Set<number>();
    const nextCases: { [caseName: string]: ExtractedFields | null } = {};
    const nextChanged: { [caseName: string]: Set<string> } = {};
    caseOptions.forEach(c => {
      nextCases[c] = { ...(cases[c] || {}) };
      nextChanged[c] = new Set(changedFields[c] || []);
    });
    let casesModified = false;

    for (let r = sel.startRow; r <= sel.endRow; r++) {
      const fieldName = fields[r];
      for (let c = sel.startCol; c <= sel.endCol; c++) {
        if (c === 0) {
          rowsToRemove.add(r);
          continue;
        }
        const caseIdx = c - 1;
        if (caseIdx < 0 || caseIdx >= caseOptions.length || !fieldName) continue;
        const caseName = caseOptions[caseIdx];
        const data = nextCases[caseName] || {};
        if (fieldName in data) {
          delete data[fieldName];
          nextCases[caseName] = data;
          casesModified = true;
        }
        const changedSet = nextChanged[caseName];
        if (changedSet.has(fieldName)) {
          changedSet.delete(fieldName);
        }
      }
    }

    if (rowsToRemove.size > 0) {
      const updatedFields = [...fields];
      const removedFieldNames: string[] = [];
      [...rowsToRemove].sort((a, b) => b - a).forEach(idx => {
        if (idx >= 0 && idx < updatedFields.length) {
          const removed = updatedFields.splice(idx, 1)[0];
          if (removed) removedFieldNames.push(removed);
        }
      });
      removedFieldNames.forEach(name => {
        Object.keys(nextCases).forEach(caseName => {
          const data = nextCases[caseName] || {};
          if (name in data) {
            delete data[name];
            nextCases[caseName] = data;
            casesModified = true;
          }
        });
        Object.keys(nextChanged).forEach(caseName => {
          nextChanged[caseName].delete(name);
        });
      });
      setFields(updatedFields);
      setDeletedFields(prev => {
        const next = [...prev];
        removedFieldNames.forEach(name => {
          if (name && !next.includes(name)) next.push(name);
        });
        return next;
      });
      casesModified = true;
    }

    if (casesModified) {
      setCases(nextCases);
      setChangedFields(() => {
        const result: { [caseName: string]: Set<string> } = {};
        Object.keys(nextChanged).forEach(cn => {
          result[cn] = new Set(nextChanged[cn]);
        });
        return result;
      });
    }

    setGridSelection(null);
    setSelectionLockedColumn(null);
    lockSelectionToFieldRef.current = false;
  }, [gridSelection, caseOptions, cases, changedFields, fields, pushHistory]);

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.metaKey || e.ctrlKey;
    const isRenamingField = editingFieldIndex !== null;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redoHistory();
      } else {
        undo();
      }
    } else if (isMod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoHistory();
    } else if (isMod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySelectionToClipboard();
    } else if (!editingCell && !isRenamingField && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const delta = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      } as const;
      const [dr, dc] = delta[e.key as keyof typeof delta];
      moveSelection(dr, dc, e.shiftKey);
    } else if (!editingCell && !isRenamingField && e.key === 'Tab') {
      e.preventDefault();
      moveSelection(0, e.shiftKey ? -1 : 1, false);
    } else if (!editingCell && !isRenamingField && e.key === 'Enter') {
      e.preventDefault();
      startEditingFromSelection();
    } else if (e.key === 'Escape') {
      setGridSelection(null);
      setSelectionLockedColumn(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && gridSelection && !editingCell && !isRenamingField) {
      e.preventDefault();
      clearSelection();
    } else if (!editingCell && !isRenamingField && !isMod && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      startEditingFromSelection(e.key);
    }
  };

  const handleCellClick = (caseName: string, field: string) => {
    const rowIdx = fields.indexOf(field);
    const colIdx = caseOptions.indexOf(caseName) + 1;
    if (rowIdx >= 0 && colIdx >= 1) {
      setGridSelection({ startRow: rowIdx, endRow: rowIdx, startCol: colIdx, endCol: colIdx });
      setSelectionLockedColumn(null);
      lockSelectionToFieldRef.current = false;
    }
    setEditingCell({ caseName, field });
    setEditingValue(cases[caseName]?.[field] || '');
  };

  const handleCellChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingValue(e.target.value);
  };

  const handleCellBlur = () => {
    if (editingCell) {
      const prevValue = cases[editingCell.caseName]?.[editingCell.field] || '';
      if (prevValue !== editingValue) {
        pushHistory();
        setCases(prev => {
          const updated = { ...prev };
          const caseData = { ...(updated[editingCell.caseName] || {}) };
          caseData[editingCell.field] = editingValue;
          updated[editingCell.caseName] = caseData;
          return updated;
        });
        setChangedFields(prev => {
          const next = { ...prev };
          const set = new Set(next[editingCell.caseName] || []);
          set.add(editingCell.field);
          next[editingCell.caseName] = set;
          return next;
        });
      }
    }
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const current = editingCell;
      handleCellBlur();
      if (current) {
        const rowIdx = fields.indexOf(current.field);
        const colIdx = caseOptions.indexOf(current.caseName) + 1;
        if (rowIdx >= 0 && colIdx >= 1) {
          const nextRow = e.key === 'Enter' ? Math.min(Math.max(0, rowIdx + (e.shiftKey ? -1 : 1)), fields.length - 1) : rowIdx;
          const nextCol = e.key === 'Tab' ? Math.min(Math.max(1, colIdx + (e.shiftKey ? -1 : 1)), caseOptions.length) : colIdx;
          setGridSelection({ startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol });
        }
      }
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  // Initialize column widths and keep in sync with caseOptions
  useEffect(() => {
    setColumnWidths(prev => {
      const next: Record<string, number> = { ...prev };
      if (next['__FIELD__'] == null) next['__FIELD__'] = DEFAULT_FIELD_COL_WIDTH;
      caseOptions.forEach(c => { if (next[c] == null) next[c] = DEFAULT_CASE_COL_WIDTH; });
      // Remove widths for cases that no longer exist
      Object.keys(next).forEach(k => {
        if (k !== '__FIELD__' && !caseOptions.includes(k)) delete next[k];
      });
      return next;
    });
  }, [caseOptions]);

  const measureTextWidth = (text: string) => {
    if (typeof document === 'undefined') return text.length * 10;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return text.length * 10;
    ctx.font = '14px Inter, system-ui, -apple-system, sans-serif';
    const metrics = ctx.measureText(text || '');
    return metrics.width;
  };

  const autoFitColumnWidth = (key: string) => {
    const padding = 32;
    let maxWidth = measureTextWidth(key === '__FIELD__' ? 'Field' : key);
    if (key === '__FIELD__') {
      fields.forEach(f => {
        maxWidth = Math.max(maxWidth, measureTextWidth(f || ''));
      });
    } else {
      fields.forEach(f => {
        const cellValue = cases[key]?.[f] || '';
        maxWidth = Math.max(maxWidth, measureTextWidth(cellValue));
      });
    }
    const width = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.ceil(maxWidth + padding)));
    setColumnWidths(prev => ({ ...prev, [key]: width }));
  };

  const beginResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[key] ?? (key === '__FIELD__' ? DEFAULT_FIELD_COL_WIDTH : DEFAULT_CASE_COL_WIDTH);
    resizeInfoRef.current = { startX, startWidth, colKey: key };
    setResizingCol(key);
    const onMove = (ev: MouseEvent) => {
      const info = resizeInfoRef.current;
      if (!info) return;
      const dx = ev.clientX - info.startX;
      let w = info.startWidth + dx;
      if (w < MIN_COL_WIDTH) w = MIN_COL_WIDTH;
      if (w > MAX_COL_WIDTH) w = MAX_COL_WIDTH;
      setColumnWidths(prev => ({ ...prev, [info.colKey]: w }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizingCol(null);
      resizeInfoRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const clearNativeSelection = () => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) sel.removeAllRanges();
  };

  const draggingRef = useRef<{ key: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const startDragging = (key: string, pos: { x: number; y: number }, setter: (p: { x: number; y: number }) => void) => (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target && target.closest('button, input, select, textarea, option')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = { key, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = ev.clientX - draggingRef.current.startX;
      const dy = ev.clientY - draggingRef.current.startY;
      setter({ x: Math.max(0, draggingRef.current.originX + dx), y: Math.max(0, draggingRef.current.originY + dy) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      draggingRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startSelection = (rowIdx: number, colIdx: number, event?: React.MouseEvent) => {
    clearNativeSelection();
    gridContainerRef.current?.focus();
    const shiftExtend = event?.shiftKey && gridSelection;
    if (shiftExtend && gridSelection) {
      const base = normalizeSelection(gridSelection);
      const lockToField = base.startCol === 0;
      lockSelectionToFieldRef.current = lockToField;
      setSelectionLockedColumn(lockToField ? 0 : null);
      setGridSelection({
        startRow: base.startRow,
        startCol: base.startCol,
        endRow: rowIdx,
        endCol: lockSelectionToFieldRef.current ? base.startCol : colIdx,
      });
      return;
    }
    setIsSelectingCells(true);
    hasDraggedSelectionRef.current = false;
    lockSelectionToFieldRef.current = colIdx === 0;
    setSelectionLockedColumn(colIdx === 0 ? 0 : null);
    if (colIdx > 0) {
      const caseIdx = colIdx - 1;
      const targetCase = caseOptions[caseIdx];
      if (targetCase && targetCase !== selectedCase) {
        setSelectedCase(targetCase);
      }
    }
    setGridSelection({ startRow: rowIdx, startCol: colIdx, endRow: rowIdx, endCol: colIdx });
  };

  const extendSelection = (rowIdx: number, colIdx: number) => {
    if (!isSelectingCells) return;
    clearNativeSelection();
    hasDraggedSelectionRef.current = true;
    const effectiveColIdx = lockSelectionToFieldRef.current ? 0 : colIdx;
    setGridSelection((sel) => sel ? { ...sel, endRow: rowIdx, endCol: effectiveColIdx } : { startRow: rowIdx, startCol: effectiveColIdx, endRow: rowIdx, endCol: effectiveColIdx });
  };

  useEffect(() => {
    const onUp = () => {
      setIsSelectingCells(false);
      lockSelectionToFieldRef.current = false;
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const moveSelection = (dRow: number, dCol: number, expand: boolean) => {
    const maxRow = Math.max(0, fields.length - 1);
    const maxCol = Math.max(0, caseOptions.length);
    const anchorRow = gridSelection ? gridSelection.startRow : 0;
    const anchorCol = gridSelection ? gridSelection.startCol : Math.min(1, maxCol);
    const currentRow = gridSelection ? (expand ? gridSelection.endRow : anchorRow) : 0;
    const currentCol = gridSelection ? (expand ? gridSelection.endCol : anchorCol) : Math.min(1, maxCol);
    const nextRow = Math.min(maxRow, Math.max(0, currentRow + dRow));
    const nextCol = Math.min(maxCol, Math.max(0, currentCol + dCol));
    const lockToField = lockSelectionToFieldRef.current || anchorCol === 0;
    setSelectionLockedColumn(lockToField ? 0 : null);
    lockSelectionToFieldRef.current = lockToField;
    if (expand && gridSelection) {
      setGridSelection({ ...gridSelection, endRow: nextRow, endCol: lockToField ? 0 : nextCol });
    } else {
      setGridSelection({ startRow: nextRow, endRow: nextRow, startCol: lockToField ? 0 : nextCol, endCol: lockToField ? 0 : nextCol });
    }
  };

  const startEditingFromSelection = (seedValue?: string) => {
    const defaultCol = Math.min(1, Math.max(0, caseOptions.length));
    const sel = normalizeSelection(gridSelection ?? { startRow: 0, endRow: 0, startCol: defaultCol, endCol: defaultCol });
    const targetRow = Math.min(fields.length - 1, sel.startRow);
    const targetCol = Math.min(caseOptions.length, sel.startCol);
    setGridSelection({ startRow: targetRow, endRow: targetRow, startCol: targetCol, endCol: targetCol });
    setSelectionLockedColumn(targetCol === 0 ? 0 : null);
    lockSelectionToFieldRef.current = targetCol === 0;
    if (targetCol === 0) {
      setEditingFieldIndex(targetRow);
      setEditingFieldName(seedValue ?? fields[targetRow] ?? '');
      return;
    }
    const targetCase = caseOptions[targetCol - 1];
    const targetField = fields[targetRow];
    if (!targetCase || !targetField) return;
    setEditingCell({ caseName: targetCase, field: targetField });
    setEditingValue(seedValue ?? cases[targetCase]?.[targetField] ?? '');
  };

  const isCellSelected = (rowIdx: number, colIdx: number) => {
    if (!gridSelection) return false;
    const sel = normalizeSelection(gridSelection);
    return rowIdx >= sel.startRow && rowIdx <= sel.endRow && colIdx >= sel.startCol && colIdx <= sel.endCol;
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
    if (nextName === prevName) {
      setEditingFieldIndex(null);
      setEditingFieldName('');
      return;
    }
    if (fields.includes(nextName)) {
      addToast({
        title: '중복 항목 이름',
        description: '이미 존재하는 항목 이름입니다.',
        type: 'error'
      });
      return;
    }
    pushHistory();
    setFields(prev => {
      const copy = [...prev];
      copy[index] = nextName;
      return copy;
    });
    // Record alias so future extractions map old -> new and un-delete target
    setFieldAliases(prev => ({ ...prev, [prevName]: nextName }));
    setDeletedFields(prev => prev.filter(f => f !== nextName));
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
    pushHistory();
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
    pushHistory();
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
      <div className="mx-auto w-full space-y-2 relative" style={{ minHeight: `${Math.max(tablePos.y + tableSize.height + 160, 1400)}px` }}>
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Data Extractor from Table</h1>
          <p className="text-muted-foreground">
            Paste (Ctrl/Cmd+V) a screenshot of a table or drop/upload below. The server will extract tables as Markdown.
          </p>
        </header>

        <div
          className="absolute"
          style={{ left: pastePos.x, top: pastePos.y, width: pasteSize.width, height: pasteSize.height }}
        >
          <Card
            ref={pasteCardRef}
            style={{
              resize: 'both',
              overflow: 'auto',
              minWidth: `${MIN_PASTE_SIZE.width}px`,
              minHeight: `${MIN_PASTE_SIZE.height}px`,
              width: '100%',
              height: '100%'
            }}
          >
          <CardHeader className="py-2 flex items-center justify-between cursor-move" onMouseDown={startDragging('paste', pastePos, setPastePos)}>
            <CardTitle className="text-base">Image / PDF Paste</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowUploadPanel(v => !v)}>
              {showUploadPanel ? 'Hide' : 'Show'}
            </Button>
          </CardHeader>
          {showUploadPanel ? (
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
          ) : (
            <div
              className="px-4 pb-3 text-xs text-muted-foreground cursor-pointer"
              onClick={() => setShowUploadPanel(true)}
            >
              Click to expand paste/upload area
            </div>
          )}
          </Card>
        </div>

        <div
          className="absolute"
          style={{ left: imagePos.x, top: imagePos.y, width: imageSize.width, height: imageSize.height }}
        >
          <Card
            ref={imageCardRef}
            style={{
              resize: 'both',
              overflow: 'auto',
              minWidth: `${MIN_IMAGE_SIZE.width}px`,
              minHeight: `${MIN_IMAGE_SIZE.height}px`,
              width: '100%',
              height: '100%'
            }}
          >
            <CardHeader className="flex items-center justify-between cursor-move" onMouseDown={startDragging('image', imagePos, setImagePos)}>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Image Table
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowImagePanel(v => !v)}>
                {showImagePanel ? 'Hide' : 'Show'}
              </Button>
            </CardHeader>

            {showImagePanel ? (
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold">Zoom</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={imageZoom}
                  onChange={e => setImageZoom(parseFloat(e.target.value))}
                />
                <span className="w-12 text-right">{Math.round(imageZoom * 100)}%</span>
              </div>
              <div style={{ transform: `scale(${imageZoom})`, transformOrigin: 'top left' }}>
              {uploadedFile ? (
                <div className="text-sm text-muted-foreground border rounded p-2 space-y-2 mb-3">
                  <div>PDF selected: {uploadedFile.name}{pdfTotalPages ? ` ? ? ???: ${pdfTotalPages}` : ''}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      placeholder="??? ??? (?: 1-5,7,9)"
                      value={includePages}
                      onChange={(e) => setIncludePages(e.target.value)}
                    />
                    <Input
                      placeholder="??? ??? (?: 2,6)"
                      value={excludePages}
                      onChange={(e) => setExcludePages(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button size="sm" onClick={handleRenderPdfPreview} disabled={isRenderingPdf}>
                      {isRenderingPdf ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> ???...</>
                      ) : (
                        '???? ??'
                      )}
                    </Button>
                    {pdfPageImages.length > 0 ? (
                      <span className="text-xs">???? {pdfPageImages.length}?</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ??? ?? ????, ??? ???? ???? ?????.
                  </p>
                </div>
              ) : null}

              {(() => {
                const allPages = [
                  ...imageDataUrls.map((u, idx) => ({
                    key: `img-${idx}`,
                    label: `Image ${idx + 1}`,
                    url: u,
                    onRemove: () => handleRemoveImage(idx),
                  })),
                  ...pdfPageImages.map((img, idx) => ({
                    key: `pdf-${idx}-${img.page}`,
                    label: `PDF Page ${img.page}`,
                    url: img.url,
                    onRemove: () => handleRemovePdfPage(idx),
                  }))
                ];
                if (allPages.length === 0 && dataUrl) {
                  allPages.push({
                    key: 'single',
                    label: 'Image 1',
                    url: dataUrl,
                    onRemove: () => setDataUrl(null),
                  });
                }
                if (allPages.length === 0) return null;
                return (
                  <div className="grid grid-cols-1 gap-3 max-h-[520px] overflow-auto">
                    {allPages.map((p) => (
                      <div key={p.key} className="space-y-1">
                        <div className="text-xs text-muted-foreground">{p.label}</div>
                        <div className="relative">
                          <img src={p.url} alt={p.label} className="w-full h-auto rounded border" />
                          <button
                            type="button"
                            aria-label={`${p.label} ??`}
                            onClick={(e) => { e.stopPropagation(); p.onRemove(); }}
                            className="absolute top-1 right-1 inline-flex items-center justify-center rounded-full bg-black/70 hover:bg-black/85 text-white shadow p-1"
                            title={`${p.label} ??`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              </div>
            </CardContent>
            ) : null}
            {!showImagePanel ? (
              <div className="px-4 pb-3 text-xs text-muted-foreground cursor-pointer" onClick={() => setShowImagePanel(true)}>
                Click to expand image/PDF preview
              </div>
            ) : null}
          </Card>
        </div>

        <div
          className="absolute"
          style={{ left: markdownPos.x, top: markdownPos.y, width: markdownSize.width, height: markdownSize.height }}
        >
          <Card
            ref={markdownCardRef}
            style={{
              resize: 'both',
              overflow: 'auto',
              minWidth: `${MIN_MARKDOWN_SIZE.width}px`,
              minHeight: `${MIN_MARKDOWN_SIZE.height}px`,
              width: '100%',
              height: '100%'
            }}
          >
            <CardHeader className="flex items-center justify-between cursor-move" onMouseDown={startDragging('markdown', markdownPos, setMarkdownPos)}>
              <CardTitle>Markdown</CardTitle>
              <div className="flex gap-2 flex-wrap items-center">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold">Zoom</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={markdownZoom}
                    onChange={(e) => setMarkdownZoom(parseFloat(e.target.value))}
                  />
                  <span className="w-12 text-right">{Math.round(markdownZoom * 100)}%</span>
                </div>
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
                <Button variant="ghost" size="sm" onClick={() => setShowMarkdownPanel(v => !v)}>
                  {showMarkdownPanel ? 'Hide' : 'Show'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className={showMarkdownPanel ? undefined : 'hidden'}>
              <div style={{ transform: `scale(${markdownZoom})`, transformOrigin: 'top left' }}>
                <Textarea
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  placeholder="Markdown will appear here..."
                  className="h-[400px] overflow-auto resize-y field-sizing-fixed font-mono"
                />
              </div>
            </CardContent>
            {!showMarkdownPanel ? (
              <div className="px-4 pb-3 text-xs text-muted-foreground cursor-pointer" onClick={() => setShowMarkdownPanel(true)}>
                Click to expand markdown
              </div>
            ) : null}
          </Card>
        </div>

        <div
          className="absolute"
          style={{ left: tablePos.x, top: tablePos.y, width: tableSize.width, height: tableSize.height }}
        >
          <Card
            ref={tableCardRef}
            style={{
              resize: 'both',
              overflow: 'auto',
              minWidth: `${MIN_TABLE_SIZE.width}px`,
              minHeight: `${MIN_TABLE_SIZE.height}px`,
              width: '100%',
              height: '100%'
            }}
          >
          <CardHeader className="cursor-move" onMouseDown={startDragging('table', tablePos, setTablePos)}>
            <CardTitle>
              Technical Evaluation Sheet
            </CardTitle>
            <div className="flex flex-wrap gap-2 mt-4">
              <div className="flex gap-2 flex-wrap items-center">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold">Zoom</span>
                  <input
                    type="range"
                    min={0.5}
                    max={1.6}
                    step={0.05}
                    value={tableZoom}
                    onChange={(e) => setTableZoom(parseFloat(e.target.value))}
                  />
                  <span className="w-12 text-right">{Math.round(tableZoom * 100)}%</span>
                </div>
                <select
                  id="case-select"
                  value={selectedCase}
                  onChange={e => setSelectedCase(e.target.value)}
                  className={`border rounded px-2 py-1 transition-colors duration-150 ${selectFlash ? 'ring-2 ring-primary/60 bg-yellow-100 text-red-600' : 'text-foreground'}`}
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
                <Button
                  variant="outline"
                  onClick={() => excelInputRef.current?.click()}
                  disabled={isImportingExcel}
                  className="flex items-center gap-2"
                  title="엑셀 파일을 불러오기"
                >
                  {isImportingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  Load Excel
                </Button>
                <Input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => handleExcelFileInput(e.target.files?.[0] || null)}
                />
                <Button variant="outline" onClick={() => setIsHorizontalView(prev => !prev)}>
                  Tilting ({isHorizontalView ? 'Vertical' : 'Horizontal'})
                </Button>
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
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleExcelDrop}
              className="mb-3 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  Excel 테이블을 드롭하거나 업로드하면 Technical Evaluation Sheet에 그대로 채웁니다. 첫 열은 Field, 첫 행은 Case 이름으로 사용됩니다. CSV는 한글이 깨지면 EUC-KR/CP949까지 자동으로 시도합니다.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => excelInputRef.current?.click()}
                    disabled={isImportingExcel}
                    className="flex items-center gap-2"
                  >
                    {isImportingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isImportingExcel ? 'Loading...' : 'Upload Excel'}
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                표를 찾을 수 없을 때는 첫 행/열에 값이 있는지 확인해주세요. 동일한 필드명이 여러 번 나오면 자동으로 번호를 붙입니다.
              </p>
            </div>
            <div
              ref={gridContainerRef}
              tabIndex={0}
              onKeyDown={handleGridKeyDown}
              className="rounded-md border border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white overflow-hidden"
              style={{ transform: `scale(${tableZoom})`, transformOrigin: 'top left' }}
            >
              {isHorizontalView ? (
                <div className="overflow-auto">
                  <Table className="w-full min-w-[900px] border-collapse">
                    <TableHeader>
                      <TableRow className="bg-gradient-to-b from-gray-50 to-gray-100">
                        <TableHead className="text-left border-r border-gray-300 select-none text-sm font-semibold text-slate-700 w-32 min-w-[120px] uppercase tracking-wide">
                          Case
                        </TableHead>
                        {fields.map((field, idx) => (
                          <TableHead
                            key={`${field}-horizontal-${idx}`}
                            className="text-left border-gray-300 text-sm font-semibold text-slate-700 min-w-[160px] whitespace-pre-wrap break-words"
                            onDoubleClick={() => handleFieldNameClick(idx)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              {editingFieldIndex === idx ? (
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
                              <span className="cursor-pointer truncate" title={field} onClick={() => handleFieldNameClick(idx)}>{field}</span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); handleRemoveField(idx); }}
                              title="Remove field"
                              aria-label="Remove field"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                {caseOptions.map((caseName) => {
                  const isActiveCase = selectedCase === caseName;
                  return (
                    <TableRow key={`horizontal-${caseName}`} className={`odd:bg-white even:bg-gray-50 hover:bg-blue-50/40 transition-colors ${isActiveCase ? 'bg-primary/5' : ''}`}>
                          <TableCell
                            className="font-semibold text-left border-r border-gray-200 px-2 py-1 uppercase tracking-wide cursor-pointer"
                            onClick={() => { if (selectedCase !== caseName) setSelectedCase(caseName); }}
                          >
                            {caseName}
                          </TableCell>
                        {fields.map((field, idx) => {
                          const value = cases[caseName]?.[field] || '';
                          const isChanged = changedFields[caseName]?.has(field);
                          const isEditing = editingCell && editingCell.caseName === caseName && editingCell.field === field;
                          const isSelected = isCellSelected(idx, caseOptions.indexOf(caseName) + 1);
                          return (
                            <TableCell
                              key={`${caseName}-${field}`}
                              className={`text-left cursor-pointer border-gray-200 px-2 py-1 text-sm min-w-[160px] whitespace-pre-wrap break-words ${idx < fields.length - 1 ? ' border-r' : ''} ${isChanged ? 'bg-yellow-50' : ''} ${isSelected ? 'ring-2 ring-primary/60 bg-primary/10' : ''}`}
                              onMouseDown={(e) => { if (isEditing) return; e.preventDefault(); startSelection(idx, caseOptions.indexOf(caseName) + 1, e); }}
                              onMouseEnter={() => extendSelection(idx, caseOptions.indexOf(caseName) + 1)}
                              onClick={() => {
                                if (hasDraggedSelectionRef.current) {
                                  hasDraggedSelectionRef.current = false;
                                  return;
                                }
                                // Single click keeps selection; double click edits
                              }}
                              onDoubleClick={() => handleCellClick(caseName, field)}
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
                                    title={`Edit ${field} for ${caseName}`}
                                    aria-label={`Edit ${field} for ${caseName}`}
                                  />
                                ) : (
                                  <span className="block truncate" title={value}>{value}</span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  </Table>
                </div>
              ) : (
                <Table className="table-fixed w-full border-collapse">
                  <TableHeader>
                    <TableRow className="bg-gradient-to-b from-gray-50 to-gray-100">
                      <TableHead
                        className="text-left border-r border-gray-300 relative select-none text-sm font-semibold text-slate-700"
                        style={{ width: columnWidths['__FIELD__'], minWidth: columnWidths['__FIELD__'] }}
                      >
                        <div className="pr-2 uppercase tracking-wide text-xs">Field</div>
                        <div
                          role="separator"
                          aria-label="Resize Field column"
                          onMouseDown={(e) => beginResize(e, '__FIELD__')}
                          onDoubleClick={(e) => { e.stopPropagation(); autoFitColumnWidth('__FIELD__'); }}
                          className={`absolute top-0 right-0 h-full w-1 cursor-col-resize ${resizingCol === '__FIELD__' ? 'bg-primary/50' : 'hover:bg-primary/40'}`}
                        />
                      </TableHead>
                      {caseOptions.map((c, idx) => (
                        <TableHead
                          key={c}
                          className={`text-left border-gray-300 relative select-none text-sm font-semibold text-slate-700${idx < caseOptions.length - 1 ? ' border-r' : ''}`}
                          style={{ width: columnWidths[c], minWidth: columnWidths[c] }}
                          title={c}
                          onClick={() => {
                            if (selectedCase !== c) {
                              setSelectedCase(c);
                            }
                          }}
                        >
                          <div className="pr-2 truncate uppercase tracking-wide text-xs" title={c}>{c}</div>
                          <div
                            role="separator"
                            aria-label={`Resize ${c} column`}
                            onMouseDown={(e) => beginResize(e, c)}
                            onDoubleClick={(e) => { e.stopPropagation(); autoFitColumnWidth(c); }}
                            className={`absolute top-0 right-0 h-full w-1 cursor-col-resize ${resizingCol === c ? 'bg-primary/50' : 'hover:bg-primary/40'}`}
                          />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, rowIdx) => {
                      const fieldSelected = isCellSelected(rowIdx, 0);
                      return (
                        <TableRow key={`${field}-${rowIdx}`} className="odd:bg-white even:bg-gray-50 hover:bg-blue-50/40 transition-colors">
                          <TableCell
                            className={`font-medium text-left border-r border-gray-200 px-2 py-1 text-sm relative ${fieldSelected ? 'ring-2 ring-primary/60 bg-primary/10' : ''}`}
                            style={{ width: columnWidths['__FIELD__'], minWidth: columnWidths['__FIELD__'] }}
                            onMouseDown={(e) => { if (editingFieldIndex === rowIdx) return; e.preventDefault(); startSelection(rowIdx, 0, e); }}
                            onMouseEnter={() => extendSelection(rowIdx, 0)}
                          >
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
                                <span className="cursor-pointer truncate" title={field} onClick={() => handleFieldNameClick(rowIdx)}>{field}</span>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => { e.stopPropagation(); handleRemoveField(rowIdx); }}
                                onMouseDown={(e) => e.stopPropagation()}
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
                            const isSelected = isCellSelected(rowIdx, idx + 1);
                            const cellStyle = {
                              ...(isChanged ? { backgroundColor: isSelected ? '#e8f2ff' : '#fff8c6' } : {}),
                              width: columnWidths[c],
                              minWidth: columnWidths[c]
                            };
                            return (
                              <TableCell
                                key={c}
                                className={`text-left cursor-pointer ${idx < caseOptions.length - 1 ? ' border-r' : ''} border-gray-200 px-2 py-1 text-sm relative ${isSelected ? 'ring-2 ring-primary/60 bg-primary/10' : ''}`}
                                style={cellStyle}
                                onMouseDown={(e) => { if (isEditing) return; e.preventDefault(); startSelection(rowIdx, idx + 1, e); }}
                                onMouseEnter={() => extendSelection(rowIdx, idx + 1)}
                              onClick={() => {
                                if (hasDraggedSelectionRef.current) {
                                  hasDraggedSelectionRef.current = false;
                                  return;
                                }
                                // Single click keeps selection; double click edits
                              }}
                              onDoubleClick={() => handleCellClick(c, field)}
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
                                  <span className="block truncate" title={value}>{value}</span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
        </div>
    </div>
  );
}

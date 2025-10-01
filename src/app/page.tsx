'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Copy, Download, Loader2, FileText } from 'lucide-react';

interface ExtractedFields {
  [key: string]: string;
}

export default function Home() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>('');
  const [extractedFields, setExtractedFields] = useState<ExtractedFields | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [tableCopySuccess, setTableCopySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

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
  }, [fileToDataUrl]);

  const handleFileChange = useCallback(async (file: File) => {
    if (file && file.type.startsWith('image/')) {
      const url = await fileToDataUrl(file);
      setDataUrl(url);
    }
  }, [fileToDataUrl]);

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
    if (!dataUrl) return;
    
    setIsConverting(true);
    setMarkdown('Converting image...');
    
    try {
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
    } catch (err: any) {
      console.error('Conversion failed:', err);
      setMarkdown(`Error: ${err.message}`);
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
      
      setExtractedFields(json.fields);
    } catch (err: any) {
      alert('Extraction error: ' + err.message);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDownload = () => {
    if (!extractedFields) return;
    
    const order = [
      'manufacturer', 'rated flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency',
      'max flow', 'min flow', 'shutoff TDH', 'pump model name'
    ];
    
    const rows = [['Field', 'Value'], ...order.map(k => [k, extractedFields[k] || ''])];
    const csv = rows.map(r => r.map((cell) => {
      const s = String(cell ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pump_data.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyTable = async () => {
    if (!extractedFields) return;
    
    const order = [
      'manufacturer', 'rated flow', 'normal flow', 'TDH', 'casing material',
      'shaft material', 'impeller material', 'shaft power', 'pump efficiency',
      'max flow', 'min flow', 'shutoff TDH', 'pump model name'
    ];
    
    // Create tab-separated values for Excel compatibility
    const rows = [['Field', 'Value'], ...order.map(k => [k, extractedFields[k] || ''])];
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

  const handleLoadSample = () => {
    const sample = `| **Pump Data**                |                |
|------------------------------|----------------|
| Model                        | SM.V1          |
| Type                         | Shredder Mixing Pump |
| Stage                        | 1              |
| Impeller Type                | Open           |
| Impeller Diameter            | 127 mm         |
| Inlet Diameter               | 2 1/2" - 75 mm |
| Outlet Diameter              | 2" - 63 mm     |
| Flow (Max.-Nominal-Min.)    | 50.7 - 30.9 - 10 m³/h |
| Head (at QMax.-QNominal-QMin.) | 4.57 - 12.10 - 15.50 m |
| Max. Pump Efficiency %       | 40.6           |
| Shaft Power (P2) (Max.)     | 2.96 kW        |
| Shaft Power (P2) (at Max.Eff.) | 2.51 kW      |
| Rated NPSH                   | 1.2 m          |`;
    setMarkdown(sample);
    setExtractedFields(null);
  };

  // Add paste event listener
  useEffect(() => {
    const handlePasteEvent = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener('paste', handlePasteEvent);
    return () => document.removeEventListener('paste', handlePasteEvent);
  }, [handlePaste]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Image → Markdown (Tables)</h1>
          <p className="text-muted-foreground">
            Paste (Ctrl/Cmd+V) a screenshot of a table or drop/upload below. The server will extract tables as Markdown.
          </p>
        </header>

        <Card>
          <CardContent className="p-6">
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-primary bg-primary/5 rounded-lg p-6 text-center text-primary hover:bg-primary/10 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto h-12 w-12 mb-4" />
              <p className="font-semibold mb-2">
                <strong>Paste</strong> an image here or <strong>drag & drop</strong> a file.
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Upload image file
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dataUrl && (
                <img
                  src={dataUrl}
                  alt="preview"
                  className="w-full h-auto rounded-lg border"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Markdown</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={handleConvert}
                  disabled={!dataUrl || isConverting}
                  className="flex items-center gap-2"
                >
                  {isConverting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Convert
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
                  onClick={handleExtract}
                  disabled={!markdown.trim() || isExtracting}
                  className="flex items-center gap-2"
                >
                  {isExtracting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Extract Fields
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownload}
                  disabled={!extractedFields}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLoadSample}
                  className="flex items-center gap-2"
                >
                  Load Sample
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

        {extractedFields && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Technical Evaluation (정해진 평가항목에 매칭된 데이터)
                <Button
                  variant="outline"
                  onClick={handleCopyTable}
                  className="flex items-center gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {tableCopySuccess ? 'Copied!' : 'Copy for Excel'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(extractedFields).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell>{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

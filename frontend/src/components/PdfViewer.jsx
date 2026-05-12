import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from "lucide-react";
import { Button } from "./ui/button";

// Build the worker URL. Priority:
//   1. Backend-served `/api/pdf-worker.mjs` (always same origin, no manual deploy needed)
//   2. CDN unpkg fallback (only used if backend route 404s when fetched by pdfjs)
// We set the backend URL directly and let pdfjs handle the fetch; if pdfjs fails to
// import the worker module, we retry with the CDN URL.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const PRIMARY_WORKER = `${BACKEND_URL}/api/pdf-worker.mjs`;
const FALLBACK_WORKER = `https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;

let workerInitPromise = null;
function ensureWorker() {
  if (!workerInitPromise) {
    workerInitPromise = Promise.resolve().then(() => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PRIMARY_WORKER;
      return PRIMARY_WORKER;
    });
  }
  return workerInitPromise;
}

// Swap to CDN if primary failed. Caller invokes this then retries.
function switchToFallbackWorker() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = FALLBACK_WORKER;
  workerInitPromise = Promise.resolve(FALLBACK_WORKER);
}

/**
 * Reliable PDF viewer that renders pages to canvas with PDF.js.
 * Works on all browsers (desktop + mobile) — no native iframe issues.
 */
export default function PdfViewer({ blobUrl, filename }) {
  const containerRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load the PDF document
  useEffect(() => {
    if (!blobUrl) return;
    setLoading(true); setError(null);
    let cancelled = false;
    (async () => {
      const tryLoad = async () => {
        const task = pdfjsLib.getDocument({ url: blobUrl });
        return await task.promise;
      };
      try {
        await ensureWorker();
        let doc;
        try {
          doc = await tryLoad();
        } catch (firstErr) {
          // If worker failed to import, try the CDN fallback once
          const msg = String(firstErr?.message || firstErr);
          if (/worker|dynamically imported|Failed to fetch/i.test(msg)) {
            switchToFallbackWorker();
            doc = await tryLoad();
          } else {
            throw firstErr;
          }
        }
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
      } catch (e) {
        if (!cancelled) setError(e.message || "Impossible de charger le PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [blobUrl]);

  // Render current page when pdfDoc, pageNum or scale changes
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;

        // Adapt scale to container width for responsive
        const containerWidth = container.clientWidth - 16;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = containerWidth / baseViewport.width;
        const finalScale = scale * fitScale;
        const viewport = page.getViewport({ scale: finalScale });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.style.display = "block";
        canvas.style.margin = "0 auto";
        canvas.style.background = "#fff";
        canvas.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)";
        canvas.style.borderRadius = "8px";
        ctx.scale(dpr, dpr);

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        container.innerHTML = "";
        container.appendChild(canvas);
      } catch (e) {
        if (!cancelled) setError(e.message || "Erreur de rendu");
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, scale]);

  const downloadPdf = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl; a.download = filename || "document.pdf";
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="flex flex-col h-full bg-muted/40">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-md"
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            data-testid="pdf-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs font-medium text-foreground/80 min-w-[60px] text-center">
            {numPages ? `${pageNum} / ${numPages}` : "—"}
          </span>
          <Button
            variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-md"
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
            data-testid="pdf-next"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-md"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            data-testid="pdf-zoom-out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[40px] text-center">{Math.round(scale * 100)}%</span>
          <Button
            variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-md"
            onClick={() => setScale((s) => Math.min(3, s + 0.2))}
            data-testid="pdf-zoom-in"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-md"
            onClick={downloadPdf}
            title="Télécharger"
            data-testid="pdf-download"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Render area */}
      <div className="flex-1 overflow-auto p-4" data-testid="pdf-render-area">
        {loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement du PDF…
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <p className="text-destructive text-sm font-medium mb-2">Impossible d'afficher le PDF</p>
            <p className="text-muted-foreground text-xs">{error}</p>
            <Button size="sm" className="mt-4 bg-brand text-white" onClick={downloadPdf}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Télécharger le PDF
            </Button>
          </div>
        )}
        {!loading && !error && <div ref={containerRef} />}
      </div>
    </div>
  );
}

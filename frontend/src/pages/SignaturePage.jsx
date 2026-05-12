import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { CheckCircle2, Eraser, FileText, ShieldCheck, ArrowLeft, PenLine, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { base64ToBlobUrl, revokeBlobUrl } from "../lib/pdf";
import ThemeToggle from "../components/ThemeToggle";
import PdfViewer from "../components/PdfViewer";

export default function SignaturePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  // Load file
  useEffect(() => {
    let abort = false;
    let createdUrl = null;
    (async () => {
      try {
        const { data } = await api.get(`/access/file/${encodeURIComponent(code)}`);
        if (abort) return;
        setFile(data);
        if (data.status === "signed") setSigned(true);
        createdUrl = base64ToBlobUrl(data.content_b64);
        setPdfUrl(createdUrl);
      } catch (e) {
        if (!abort) toast.error(formatApiError(e.response?.data?.detail) || "Code invalide");
        setTimeout(() => !abort && navigate("/login"), 1200);
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
      if (createdUrl) revokeBlobUrl(createdUrl);
    };
  }, [code, navigate]);

  // Setup canvas — ALWAYS white background, ALWAYS black signature for PDF readability
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      const ctx = c.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0a0a0a";  // always black
      ctx.lineWidth = 2.2;
    };
    setup();
    window.addEventListener("resize", setup);
    return () => window.removeEventListener("resize", setup);
  }, [file, signed]);

  const getPos = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const t = e.touches?.[0];
    const clientX = t ? t.clientX : e.clientX;
    const clientY = t ? t.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    lastPosRef.current = getPos(e);
  };
  const drawMove = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPosRef.current = { x, y };
    if (!hasDrawn) setHasDrawn(true);
  };
  const endDraw = () => { drawingRef.current = false; };

  const clearCanvas = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    setHasDrawn(false);
  };

  const validateSignature = async () => {
    if (!hasDrawn) {
      toast.error("Veuillez signer dans la zone prévue");
      return;
    }
    // Build a TRANSPARENT cropped PNG of the signature only.
    // 1) Find bounding box of non-transparent pixels
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    const img = ctx.getImageData(0, 0, w, h);
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = img.data[(y * w + x) * 4 + 3];
        if (a > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    if (!found) {
      toast.error("Signature illisible — recommencez");
      return;
    }
    // Add small padding around the bounding box
    const pad = 8;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const cropW = maxX - minX + 1, cropH = maxY - minY + 1;

    // 2) Copy the cropped region into a new TRANSPARENT canvas (no white fill)
    const tmp = document.createElement("canvas");
    tmp.width = cropW; tmp.height = cropH;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(c, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    const dataUrl = tmp.toDataURL("image/png");

    setSubmitting(true);
    try {
      await api.post(`/access/sign/${encodeURIComponent(code)}`, { signature_data_url: dataUrl });
      setSigned(true);
      toast.success("Document signé avec succès");
      try {
        const { data } = await api.get(`/access/file/${encodeURIComponent(code)}`);
        setFile(data);
        if (pdfUrl) revokeBlobUrl(pdfUrl);
        setPdfUrl(base64ToBlobUrl(data.content_b64));
      } catch {}
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur lors de la signature");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement du document…
        </div>
      </div>
    );
  }

  if (!file) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="glass sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" strokeWidth={1.8} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Connexion sécurisée
            </span>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate("/login")} data-testid="btn-back">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Retour
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 sm:px-8 py-8">
        <div className="mb-6 fade-in">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs font-mono mb-3" data-testid="access-code-display">
            {code}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-medium text-foreground truncate">
            {file.filename}
          </h1>
          <p className="text-muted-foreground mt-2">
            {signed
              ? "Ce document a été signé. Vous pouvez le consulter ci-dessous."
              : "Veuillez consulter le document, puis signer dans la zone prévue."}
          </p>
        </div>

        {signed && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 sm:p-8 mb-6 flex items-start gap-4 fade-in" data-testid="signed-banner">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-white" strokeWidth={1.8} />
            </div>
            <div>
              <h2 className="font-display text-xl font-medium text-emerald-700 dark:text-emerald-300">Document signé avec succès.</h2>
              <p className="text-emerald-700/80 dark:text-emerald-300/80 text-sm mt-1">Votre signature a été intégrée au document. Une copie a été enregistrée.</p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-6">
          {/* PDF preview */}
          <div className="lg:col-span-3 bg-card border border-border rounded-2xl overflow-hidden flex flex-col" style={{ height: "75vh" }}>
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" strokeWidth={1.6} />
                <span className="text-sm font-medium text-foreground">Aperçu du devis</span>
              </div>
              <span className="text-xs text-muted-foreground">PDF</span>
            </div>
            {pdfUrl ? (
              <div className="flex-1 min-h-0" data-testid="pdf-iframe">
                <PdfViewer blobUrl={pdfUrl} filename={file.filename} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Impossible d'afficher le PDF
              </div>
            )}
          </div>

          {/* Signature */}
          <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <PenLine className="w-4 h-4 text-brand" strokeWidth={1.8} />
              <span className="text-xs uppercase tracking-[0.1em] font-semibold text-muted-foreground">Votre signature</span>
            </div>
            <h3 className="font-display text-xl font-medium text-foreground mb-4">
              {signed ? "Signature enregistrée" : "Signez ci-dessous"}
            </h3>

            {signed ? (
              <div className="flex-1 flex items-center justify-center bg-muted/40 rounded-xl border border-border">
                <div className="text-center p-8">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">La signature est intégrée au PDF ci-contre.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 relative rounded-xl overflow-hidden border-2 border-dashed border-border bg-card" style={{ minHeight: 220 }}>
                  <canvas
                    ref={canvasRef}
                    className="signature-canvas absolute inset-0 w-full h-full"
                    onMouseDown={startDraw}
                    onMouseMove={drawMove}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    onTouchStart={startDraw}
                    onTouchMove={drawMove}
                    onTouchEnd={endDraw}
                    data-testid="signature-canvas"
                  />
                  {!hasDrawn && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-muted-foreground/60 text-sm italic">Signez ici à la souris ou au doigt</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <Button
                    type="button" variant="outline" onClick={clearCanvas}
                    className="flex-1 h-11 rounded-xl"
                    disabled={submitting}
                    data-testid="btn-clear-signature"
                  >
                    <Eraser className="w-4 h-4 mr-2" /> Effacer
                  </Button>
                  <Button
                    type="button" onClick={validateSignature}
                    disabled={submitting || !hasDrawn}
                    className="flex-1 h-11 rounded-xl bg-brand text-white"
                    data-testid="btn-validate-signature"
                  >
                    {submitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Validation…</>) : (<><CheckCircle2 className="w-4 h-4 mr-2" /> Valider</>)}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                  En validant, vous reconnaissez que cette signature électronique a la même valeur juridique qu'une signature manuscrite.
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-6 mt-8">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 text-xs text-muted-foreground flex items-center justify-between">
          <span>Plateforme sécurisée</span>
          <span className="font-mono">{code}</span>
        </div>
      </footer>
    </div>
  );
}

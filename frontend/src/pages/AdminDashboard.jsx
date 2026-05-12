import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../components/ui/table";
import {
  FileText, Upload, Trash2, Eye, KeyRound, MoreHorizontal, LogOut, Search, Copy,
  CheckCircle2, Clock, FileSignature, Filter, Users, ShieldCheck, FolderKanban, MoveDiagonal,
  Database, ArrowDownUp, Link2, Tag, Settings, Plus, X, Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { base64ToBlobUrl, revokeBlobUrl } from "../lib/pdf";
import ManagersPanel from "./ManagersPanel";
import DatabaseExplorer from "./DatabaseExplorer";
import MyAccountDialog from "./MyAccountDialog";
import ThemeToggle from "../components/ThemeToggle";
import PdfViewer from "../components/PdfViewer";
import SignaturePositionPicker, { positionLabel } from "../components/SignaturePositionPicker";

function StatusBadge({ status }) {
  if (status === "signed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/30" data-testid="status-badge-signed">
        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.8} /> Signé
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium border border-amber-500/30" data-testid="status-badge-unsigned">
      <Clock className="w-3.5 h-3.5" strokeWidth={1.8} /> Non signé
    </span>
  );
}

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
};
const formatDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) +
           " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_desc");  // created_desc | created_asc | signed_desc | signed_asc
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [positionFile, setPositionFile] = useState(null);
  const [positionValue, setPositionValue] = useState("bottom-right");
  const [typeFile, setTypeFile] = useState(null);  // file whose type is being edited
  const [typeValue, setTypeValue] = useState("Devis");
  const [uploadType, setUploadType] = useState("Devis");
  const [documentTypes, setDocumentTypes] = useState([]);
  const [typesManagerOpen, setTypesManagerOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypePos, setNewTypePos] = useState("bottom-right");
  const [linkParent, setLinkParent] = useState(null);  // file to link a new doc to
  const [linkType, setLinkType] = useState("Devis");
  const [linkUploading, setLinkUploading] = useState(false);
  const linkFileRef = useRef(null);
  const fileInputRef = useRef(null);

  const loadFiles = async () => {
    try {
      const { data } = await api.get("/files");
      setFiles(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  const loadDocumentTypes = async () => {
    try {
      const { data } = await api.get("/document-types");
      setDocumentTypes(data);
    } catch { /* silent */ }
  };

  useEffect(() => { loadFiles(); loadDocumentTypes(); }, []);

  // cleanup blob URL on dialog close
  useEffect(() => {
    return () => { if (previewFile?.blobUrl) revokeBlobUrl(previewFile.blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFile?.blobUrl]);

  const stats = useMemo(() => ({
    total: files.length,
    signed: files.filter((f) => f.status === "signed").length,
    unsigned: files.filter((f) => f.status === "unsigned").length,
  }), [files]);

  const filtered = useMemo(() => {
    let list = [...files];
    if (filter === "signed") list = list.filter((f) => f.status === "signed");
    if (filter === "unsigned") list = list.filter((f) => f.status === "unsigned");
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((f) =>
        f.filename.toLowerCase().includes(s) ||
        (f.access_code || "").toLowerCase().includes(s)
      );
    }
    // Sort
    const cmp = (a, b, key) => {
      const va = a[key] || "";
      const vb = b[key] || "";
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    };
    if (sortBy === "created_desc") list.sort((a, b) => cmp(b, a, "created_at"));
    else if (sortBy === "created_asc") list.sort((a, b) => cmp(a, b, "created_at"));
    else if (sortBy === "signed_desc") list.sort((a, b) => cmp(b, a, "signed_at"));
    else if (sortBy === "signed_asc") list.sort((a, b) => cmp(a, b, "signed_at"));
    return list;
  }, [files, filter, search, sortBy]);

  const sortLabel = {
    created_desc: "Plus récent",
    created_asc: "Plus ancien",
    signed_desc: "Signés (récent)",
    signed_asc: "Signés (ancien)",
  }[sortBy];

  const handleUpload = async (e) => {
    e.preventDefault();
    const f = fileInputRef.current?.files?.[0];
    if (!f) {
      toast.error("Sélectionnez un fichier PDF");
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Seuls les PDF sont acceptés");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("document_type", uploadType);
      await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Fichier ajouté avec succès", { description: `${f.name} · ${uploadType}` });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadOpen(false);
      setUploadType("Devis");
      await loadFiles();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur lors de l'upload");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/files/${id}`);
      toast.success("Fichier supprimé");
      await loadFiles();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const handleGenerateCode = async (id) => {
    try {
      const { data } = await api.post(`/files/${id}/generate-code`);
      await loadFiles();
      navigator.clipboard?.writeText(data.access_code).catch(() => {});
      toast.success(`Code généré : ${data.access_code}`, { description: "Copié dans le presse-papier" });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const handleToggleStatus = async (file) => {
    const next = file.status === "signed" ? "unsigned" : "signed";
    try {
      await api.patch(`/files/${file.id}/status`, { status: next });
      toast.success(`Statut modifié : ${next === "signed" ? "Signé" : "Non signé"}`);
      await loadFiles();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const handlePreview = async (file) => {
    try {
      const { data } = await api.get(`/files/${file.id}/download`, { params: { signed: file.status === "signed" } });
      const blobUrl = base64ToBlobUrl(data.content_b64);
      if (!blobUrl) {
        toast.error("Impossible de prévisualiser le PDF");
        return;
      }
      setPreviewFile({ filename: data.filename, blobUrl });
    } catch (e) {
      toast.error("Impossible d'ouvrir le fichier");
    }
  };

  const openPosition = (file) => {
    if (file.status === "signed") {
      toast.error("Le document est déjà signé — position non modifiable");
      return;
    }
    setPositionFile(file);
    setPositionValue(file.signature_position || "bottom-right");
  };

  const savePosition = async () => {
    if (!positionFile) return;
    try {
      await api.patch(`/files/${positionFile.id}/signature-position`, { signature_position: positionValue });
      toast.success(`Position définie : ${positionLabel(positionValue)}`);
      setPositionFile(null);
      await loadFiles();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const openTypeEdit = (file) => {
    setTypeFile(file);
    setTypeValue(file.document_type || "Devis");
  };

  const saveType = async () => {
    if (!typeFile) return;
    try {
      await api.patch(`/files/${typeFile.id}/document-type`, { document_type: typeValue });
      toast.success(`Type modifié : ${typeValue}`);
      setTypeFile(null);
      await loadFiles();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const createType = async (e) => {
    e?.preventDefault?.();
    if (!newTypeName.trim()) return;
    try {
      await api.post("/document-types", {
        name: newTypeName.trim(),
        default_signature_position: newTypePos,
      });
      toast.success(`Type créé : ${newTypeName.trim()}`);
      setNewTypeName(""); setNewTypePos("bottom-right");
      await loadDocumentTypes();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const deleteType = async (id, name) => {
    try {
      await api.delete(`/document-types/${id}`);
      toast.success(`Type supprimé : ${name}`);
      await loadDocumentTypes();
      await loadFiles();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const copyDirectLink = (file) => {
    if (!file.access_code) {
      toast.error("Générez d'abord un code d'accès");
      return;
    }
    const link = `${window.location.origin}/sign/${encodeURIComponent(file.access_code)}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("Lien direct copié", { description: link, duration: 6000 });
  };

  const handleLinkUpload = async (e) => {
    e.preventDefault();
    if (!linkParent) return;
    const f = linkFileRef.current?.files?.[0];
    if (!f) { toast.error("Sélectionnez un PDF"); return; }
    if (!f.name.toLowerCase().endsWith(".pdf")) { toast.error("PDF uniquement"); return; }
    setLinkUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("document_type", linkType);
      fd.append("parent_id", linkParent.id);
      await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Document lié : ${f.name}`, { description: `Type : ${linkType} · partagera le code de ${linkParent.filename}` });
      if (linkFileRef.current) linkFileRef.current.value = "";
      setLinkParent(null);
      setLinkType("Devis");
      await loadFiles();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erreur");
    } finally {
      setLinkUploading(false);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    toast.success("Code copié");
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 glass">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" strokeWidth={1.8} />
            </div>
            <Badge variant="secondary" className="font-normal" data-testid="role-badge">
              {user?.role === "super_admin" ? (
                <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Super admin</span>
              ) : "Gestionnaire"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-sm" data-testid="header-user-menu">
                  {user?.username}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <MyAccountDialog
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-testid="menu-my-account">
                      Mon compte
                    </DropdownMenuItem>
                  }
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
                  <LogOut className="w-4 h-4 mr-2" /> Déconnexion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-10">
        <div className="mb-10 fade-in">
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight font-medium text-foreground">
            Tableau de bord
          </h1>
          <p className="text-muted-foreground mt-2 text-base">
            {user?.role === "super_admin"
              ? "Vue globale : gérez tous les devis et les comptes gestionnaires."
              : "Gérez vos devis, générez des codes d'accès et suivez les signatures."}
          </p>
        </div>

        <Tabs defaultValue="files" className="w-full">
          {user?.role === "super_admin" && (
            <TabsList className="bg-muted p-1 rounded-xl h-11 mb-6" data-testid="admin-tabs">
              <TabsTrigger value="files" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm" data-testid="tab-files">
                <FolderKanban className="w-4 h-4 mr-2" strokeWidth={1.6} /> Devis
              </TabsTrigger>
              <TabsTrigger value="managers" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm" data-testid="tab-managers">
                <Users className="w-4 h-4 mr-2" strokeWidth={1.6} /> Gestionnaires
              </TabsTrigger>
              <TabsTrigger value="database" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm" data-testid="tab-database">
                <Database className="w-4 h-4 mr-2" strokeWidth={1.6} /> Base de données
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="files" className="mt-0">
            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
              {[
                { label: "Total", value: stats.total, icon: FileText, color: "text-foreground", bg: "bg-muted" },
                { label: "Signés", value: stats.signed, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                { label: "Non signés", value: stats.unsigned, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border rounded-2xl p-6 lift" data-testid={`stat-${s.label.toLowerCase()}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.1em] text-muted-foreground font-semibold">{s.label}</div>
                      <div className="font-display text-4xl font-medium text-foreground mt-2">{s.value}</div>
                    </div>
                    <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                      <s.icon className={`w-5 h-5 ${s.color}`} strokeWidth={1.6} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher un fichier ou code…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-10 w-full sm:w-72 rounded-lg"
                      data-testid="input-search"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-10 rounded-lg" data-testid="btn-filter">
                        <Filter className="w-4 h-4 mr-1.5" />
                        {filter === "all" ? "Tous" : filter === "signed" ? "Signés" : "Non signés"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setFilter("all")} data-testid="filter-all">Tous</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setFilter("signed")} data-testid="filter-signed">Signés</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setFilter("unsigned")} data-testid="filter-unsigned">Non signés</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-10 rounded-lg" data-testid="btn-sort">
                        <ArrowDownUp className="w-4 h-4 mr-1.5" /> {sortLabel}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setSortBy("created_desc")} data-testid="sort-created-desc">Date d'ajout · Plus récent</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSortBy("created_asc")} data-testid="sort-created-asc">Date d'ajout · Plus ancien</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSortBy("signed_desc")} data-testid="sort-signed-desc">Date de signature · Plus récent</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSortBy("signed_asc")} data-testid="sort-signed-asc">Date de signature · Plus ancien</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                  <DialogTrigger asChild>
                    <Button className="h-10 rounded-lg bg-brand text-white" data-testid="btn-upload-open">
                      <Upload className="w-4 h-4 mr-2" /> Ajouter un fichier
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="font-display tracking-tight">Ajouter un devis</DialogTitle>
                      <DialogDescription>Téléversez un fichier PDF (10 MB maximum).</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleUpload} className="space-y-4" data-testid="upload-form">
                      <label className="block">
                        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-brand transition-colors cursor-pointer">
                          <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
                          <div className="text-sm font-medium text-foreground">Cliquez pour choisir un PDF</div>
                          <div className="text-xs text-muted-foreground mt-1">ou glissez-déposez</div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            data-testid="input-file-upload"
                          />
                        </div>
                      </label>
                      <div>
                        <div className="text-xs uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-2 flex items-center justify-between">
                          <span><Tag className="w-3 h-3 inline mr-1" /> Type de document</span>
                          <button
                            type="button"
                            onClick={() => setTypesManagerOpen(true)}
                            className="text-brand hover:underline text-[10px] normal-case tracking-normal"
                            data-testid="btn-manage-types"
                          >
                            <Settings className="w-3 h-3 inline mr-0.5" /> Gérer les types
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {documentTypes.map((t) => (
                            <button
                              key={t.id} type="button"
                              onClick={() => setUploadType(t.name)}
                              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                                uploadType === t.name
                                  ? "bg-brand text-white border-brand"
                                  : "bg-card text-foreground border-border hover:border-foreground/30"
                              }`}
                              data-testid={`upload-type-${t.name}`}
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setUploadOpen(false)} data-testid="btn-upload-cancel">
                          Annuler
                        </Button>
                        <Button type="submit" disabled={uploading} className="bg-brand text-white" data-testid="btn-upload-submit">
                          {uploading ? "Envoi…" : "Téléverser"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 border-y border-border">
                      <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Fichier</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Date d'ajout</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Statut</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Signé le</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Code d'accès</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Chargement…</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow data-testid="empty-state">
                        <TableCell colSpan={6} className="text-center py-16">
                          <FileText className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" strokeWidth={1.4} />
                          <div className="text-sm text-muted-foreground">Aucun fichier pour le moment</div>
                          <div className="text-xs text-muted-foreground/70 mt-1">Cliquez sur "Ajouter un fichier" pour commencer</div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((f) => (
                        <TableRow key={f.id} className="hover:bg-muted/40" data-testid={`row-file-${f.id}`}>
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
                                <FileText className="w-4 h-4 text-brand" strokeWidth={1.6} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground truncate max-w-[280px] flex items-center gap-2">
                                  <span className="truncate">{f.filename}</span>
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand/10 text-brand text-[10px] font-semibold uppercase tracking-wider flex-shrink-0">
                                    <Tag className="w-2.5 h-2.5" /> {f.document_type || "Devis"}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(f.size / 1024).toFixed(1)} KB
                                  {user?.role === "super_admin" && f.created_by_username && (
                                    <span className="ml-2">· par <span className="font-medium">{f.created_by_username}</span></span>
                                  )}
                                  {f.signature_position && f.status !== "signed" && (
                                    <span className="ml-2 inline-flex items-center gap-1 opacity-70">
                                      <MoveDiagonal className="w-3 h-3" />
                                      {positionLabel(f.signature_position)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {formatDate(f.created_at)}
                          </TableCell>
                          <TableCell><StatusBadge status={f.status} /></TableCell>
                          <TableCell className="text-sm text-foreground/80" data-testid={`signed-at-${f.id}`}>
                            {f.status === "signed" ? formatDateTime(f.signed_at) : "—"}
                          </TableCell>
                          <TableCell>
                            {f.access_code ? (
                              <button
                                onClick={() => copyCode(f.access_code)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/70 transition-colors font-mono text-xs text-foreground"
                                data-testid={`btn-copy-code-${f.id}`}
                              >
                                {f.access_code}
                                <Copy className="w-3 h-3 opacity-60" />
                              </button>
                            ) : (
                              <Button
                                size="sm" variant="outline" className="h-8 rounded-lg"
                                onClick={() => handleGenerateCode(f.id)}
                                data-testid={`btn-generate-code-${f.id}`}
                              >
                                <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Générer
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" data-testid={`btn-actions-${f.id}`}>
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handlePreview(f)} data-testid={`menu-view-${f.id}`}>
                                  <Eye className="w-4 h-4 mr-2" /> Voir
                                </DropdownMenuItem>
                                {f.access_code && (
                                  <DropdownMenuItem onClick={() => copyDirectLink(f)} data-testid={`menu-link-${f.id}`}>
                                    <Link2 className="w-4 h-4 mr-2" /> Copier lien direct signataire
                                  </DropdownMenuItem>
                                )}
                                {!f.parent_file_id && (
                                  <DropdownMenuItem onClick={() => setLinkParent(f)} data-testid={`menu-link-doc-${f.id}`}>
                                    <Paperclip className="w-4 h-4 mr-2" /> Lier un autre document
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => openTypeEdit(f)} data-testid={`menu-type-${f.id}`}>
                                  <Tag className="w-4 h-4 mr-2" /> Modifier le type
                                </DropdownMenuItem>
                                {f.status !== "signed" && (
                                  <DropdownMenuItem onClick={() => openPosition(f)} data-testid={`menu-position-${f.id}`}>
                                    <MoveDiagonal className="w-4 h-4 mr-2" /> Position signature
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => handleToggleStatus(f)} data-testid={`menu-toggle-${f.id}`}>
                                  <FileSignature className="w-4 h-4 mr-2" /> Marquer {f.status === "signed" ? "non signé" : "signé"}
                                </DropdownMenuItem>
                                {!f.access_code && (
                                  <DropdownMenuItem onClick={() => handleGenerateCode(f.id)} data-testid={`menu-code-${f.id}`}>
                                    <KeyRound className="w-4 h-4 mr-2" /> Générer un code
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive" data-testid={`menu-delete-${f.id}`}>
                                      <Trash2 className="w-4 h-4 mr-2" /> Supprimer
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Supprimer ce fichier ?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Cette action est irréversible. Le fichier "{f.filename}" et son code d'accès seront définitivement supprimés.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid={`btn-delete-cancel-${f.id}`}>Annuler</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-destructive text-destructive-foreground hover:opacity-90"
                                        onClick={() => handleDelete(f.id)}
                                        data-testid={`btn-delete-confirm-${f.id}`}
                                      >
                                        Supprimer
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {user?.role === "super_admin" && (
            <TabsContent value="managers" className="mt-0">
              <ManagersPanel />
            </TabsContent>
          )}

          {user?.role === "super_admin" && (
            <TabsContent value="database" className="mt-0">
              <DatabaseExplorer />
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(o) => {
        if (!o) {
          if (previewFile?.blobUrl) revokeBlobUrl(previewFile.blobUrl);
          setPreviewFile(null);
        }
      }}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="p-5 border-b border-border">
            <DialogTitle className="font-display tracking-tight truncate">{previewFile?.filename}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-muted overflow-hidden">
            {previewFile?.blobUrl && (
              <PdfViewer blobUrl={previewFile.blobUrl} filename={previewFile.filename} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Signature position dialog */}
      <Dialog open={!!positionFile} onOpenChange={(o) => !o && setPositionFile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">Position de la signature</DialogTitle>
            <DialogDescription>
              Choisissez où la signature électronique sera placée sur la dernière page du document.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePositionPicker value={positionValue} onChange={setPositionValue} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPositionFile(null)} data-testid="btn-position-cancel">
              Annuler
            </Button>
            <Button onClick={savePosition} className="bg-brand text-white" data-testid="btn-position-save">
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document type change dialog */}
      <Dialog open={!!typeFile} onOpenChange={(o) => !o && setTypeFile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">Type de document</DialogTitle>
            <DialogDescription>
              Modifier le type de "{typeFile?.filename}". La position par défaut du nouveau type sera appliquée si le document n'est pas encore signé.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="grid grid-cols-2 gap-2">
              {documentTypes.map((t) => (
                <button
                  key={t.id} type="button"
                  onClick={() => setTypeValue(t.name)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                    typeValue === t.name
                      ? "bg-brand text-white border-brand"
                      : "bg-card text-foreground border-border hover:border-foreground/30"
                  }`}
                  data-testid={`type-select-${t.name}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeFile(null)} data-testid="btn-type-cancel">
              Annuler
            </Button>
            <Button onClick={saveType} className="bg-brand text-white" data-testid="btn-type-save">
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Types manager dialog */}
      <Dialog open={typesManagerOpen} onOpenChange={setTypesManagerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">Gérer les types de documents</DialogTitle>
            <DialogDescription>
              Créez des types personnalisés (Devis, Attestation, Contrat…). Chaque type peut avoir une position par défaut de la signature.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[400px] overflow-y-auto">
            <div className="space-y-2">
              {documentTypes.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border">
                  <div>
                    <div className="text-sm font-medium text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground">Position défaut : {positionLabel(t.default_signature_position)}</div>
                  </div>
                  {user?.role === "super_admin" && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                      onClick={() => deleteType(t.id, t.name)}
                      data-testid={`btn-type-delete-${t.name}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <form onSubmit={createType} className="border-t border-border pt-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.1em] font-semibold text-muted-foreground">
                <Plus className="w-3 h-3 inline mr-1" /> Créer un nouveau type
              </div>
              <Input
                placeholder="ex: Mandat, Procuration…"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                className="h-10 rounded-lg"
                data-testid="input-new-type-name"
              />
              <div>
                <div className="text-xs text-muted-foreground mb-2">Position par défaut de la signature</div>
                <SignaturePositionPicker value={newTypePos} onChange={setNewTypePos} />
              </div>
              <Button type="submit" disabled={!newTypeName.trim()} className="w-full bg-brand text-white" data-testid="btn-create-type">
                Créer le type
              </Button>
            </form>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypesManagerOpen(false)} data-testid="btn-types-close">
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

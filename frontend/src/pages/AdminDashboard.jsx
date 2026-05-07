import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
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
  CheckCircle2, Clock, FileSignature, Filter,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

function StatusBadge({ status }) {
  if (status === "signed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200" data-testid="status-badge-signed">
        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.8} /> Signé
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200" data-testid="status-badge-unsigned">
      <Clock className="w-3.5 h-3.5" strokeWidth={1.8} /> Non signé
    </span>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null); // {filename, dataUrl}
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

  useEffect(() => { loadFiles(); }, []);

  const stats = useMemo(() => ({
    total: files.length,
    signed: files.filter((f) => f.status === "signed").length,
    unsigned: files.filter((f) => f.status === "unsigned").length,
  }), [files]);

  const filtered = useMemo(() => {
    let list = files;
    if (filter === "signed") list = list.filter((f) => f.status === "signed");
    if (filter === "unsigned") list = list.filter((f) => f.status === "unsigned");
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((f) =>
        f.filename.toLowerCase().includes(s) ||
        (f.access_code || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [files, filter, search]);

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
      await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Fichier ajouté avec succès");
      setUploadOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      setPreviewFile({ filename: data.filename, dataUrl: `data:application/pdf;base64,${data.content_b64}` });
    } catch (e) {
      toast.error("Impossible d'ouvrir le fichier");
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
    <div className="min-h-screen bg-[#fafbfc]">
      {/* Header */}
      <header className="sticky top-0 z-30 glass">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0055FF] flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" strokeWidth={1.8} />
            </div>
            <span className="font-display text-base font-semibold tracking-tight">Soizic</span>
            <Badge variant="secondary" className="ml-2 font-normal">Admin</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 hidden sm:inline" data-testid="header-username">
              {user?.username}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="btn-logout">
              <LogOut className="w-4 h-4 mr-1.5" /> Déconnexion
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-10">
        {/* Hero */}
        <div className="mb-10 fade-in">
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight font-medium text-slate-900">
            Tableau de bord
          </h1>
          <p className="text-slate-500 mt-2 text-base">
            Gérez vos devis, générez des codes d'accès et suivez les signatures.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
          {[
            { label: "Total", value: stats.total, icon: FileText, color: "text-slate-700", bg: "bg-slate-100" },
            { label: "Signés", value: stats.signed, icon: CheckCircle2, color: "text-emerald-700", bg: "bg-emerald-50" },
            { label: "Non signés", value: stats.unsigned, icon: Clock, color: "text-amber-700", bg: "bg-amber-50" },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-2xl p-6 lift" data-testid={`stat-${s.label.toLowerCase()}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-slate-500 font-semibold">{s.label}</div>
                  <div className="font-display text-4xl font-medium text-slate-900 mt-2">{s.value}</div>
                </div>
                <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                  <s.icon className={`w-5 h-5 ${s.color}`} strokeWidth={1.6} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
            </div>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button className="h-10 rounded-lg bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="btn-upload-open">
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
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-[#0055FF] transition-colors cursor-pointer">
                      <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" strokeWidth={1.5} />
                      <div className="text-sm font-medium text-slate-700">Cliquez pour choisir un PDF</div>
                      <div className="text-xs text-slate-400 mt-1">ou glissez-déposez</div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        data-testid="input-file-upload"
                      />
                    </div>
                  </label>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setUploadOpen(false)} data-testid="btn-upload-cancel">
                      Annuler
                    </Button>
                    <Button type="submit" disabled={uploading} className="bg-[#0055FF] hover:bg-[#0044CC]" data-testid="btn-upload-submit">
                      {uploading ? "Envoi…" : "Téléverser"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-y border-slate-200">
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Fichier</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Date d'ajout</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Statut</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Code d'accès</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-slate-400">Chargement…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow data-testid="empty-state">
                    <TableCell colSpan={5} className="text-center py-16">
                      <FileText className="w-10 h-10 mx-auto text-slate-300 mb-3" strokeWidth={1.4} />
                      <div className="text-sm text-slate-500">Aucun fichier pour le moment</div>
                      <div className="text-xs text-slate-400 mt-1">Cliquez sur "Ajouter un fichier" pour commencer</div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((f) => (
                    <TableRow key={f.id} className="hover:bg-slate-50/60" data-testid={`row-file-${f.id}`}>
                      <TableCell className="py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-[#0055FF]/10 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-4.5 h-4.5 text-[#0055FF]" strokeWidth={1.6} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 truncate max-w-[280px]">{f.filename}</div>
                            <div className="text-xs text-slate-400">{(f.size / 1024).toFixed(1)} KB</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {new Date(f.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell><StatusBadge status={f.status} /></TableCell>
                      <TableCell>
                        {f.access_code ? (
                          <button
                            onClick={() => copyCode(f.access_code)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors font-mono text-xs text-slate-700"
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
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-600 focus:text-red-700" data-testid={`menu-delete-${f.id}`}>
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
                                    className="bg-red-600 hover:bg-red-700"
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
      </main>

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(o) => !o && setPreviewFile(null)}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="p-5 border-b border-slate-200">
            <DialogTitle className="font-display tracking-tight truncate">{previewFile?.filename}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-slate-100 overflow-hidden">
            {previewFile && (
              <iframe
                src={previewFile.dataUrl}
                title={previewFile.filename}
                className="w-full h-full"
                data-testid="pdf-preview-iframe"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

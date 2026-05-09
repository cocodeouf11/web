import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../components/ui/table";
import {
  UserPlus, Trash2, KeyRound, Users, Edit3, Shield,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";

export default function ManagersPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // create form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // edit form
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) {
      toast.error("Nom d'utilisateur et mot de passe requis");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/users", { username: newUsername.trim(), password: newPassword });
      toast.success(`Gestionnaire "${newUsername.trim().toLowerCase()}" créé`);
      setCreateOpen(false);
      setNewUsername(""); setNewPassword("");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (u) => {
    setEditTarget(u);
    setEditUsername(u.username);
    setEditPassword("");
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const payload = {};
    if (editUsername.trim() && editUsername.trim() !== editTarget.username) payload.username = editUsername.trim();
    if (editPassword) payload.password = editPassword;
    if (Object.keys(payload).length === 0) {
      toast.info("Aucun changement");
      setEditTarget(null); setSubmitting(false);
      return;
    }
    try {
      await api.patch(`/users/${editTarget.id}`, payload);
      toast.success("Gestionnaire mis à jour");
      setEditTarget(null);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (u) => {
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Gestionnaire supprimé");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erreur");
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden" data-testid="managers-panel">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-brand" strokeWidth={1.6} />
          </div>
          <div>
            <h2 className="font-display text-lg font-medium text-foreground">Gestionnaires</h2>
            <p className="text-xs text-muted-foreground">Comptes pouvant uploader et gérer leurs propres devis</p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-lg bg-brand text-white" data-testid="btn-add-manager">
              <UserPlus className="w-4 h-4 mr-2" /> Ajouter un gestionnaire
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display tracking-tight">Nouveau gestionnaire</DialogTitle>
              <DialogDescription>Créez un compte qui pourra uploader et gérer ses propres devis.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4" data-testid="manager-create-form">
              <div>
                <Label className="text-foreground text-sm font-medium">Nom d'utilisateur</Label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="ex: marie"
                  className="mt-2 h-11 rounded-xl"
                  data-testid="input-new-username"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label className="text-foreground text-sm font-medium">Mot de passe</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="6 caractères minimum"
                  className="mt-2 h-11 rounded-xl"
                  data-testid="input-new-password"
                  autoComplete="new-password"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} data-testid="btn-create-cancel">
                  Annuler
                </Button>
                <Button type="submit" disabled={submitting} className="bg-brand text-white" data-testid="btn-create-submit">
                  {submitting ? "Création…" : "Créer"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-y border-slate-200">
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Utilisateur</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Devis créés</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500">Créé le</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-slate-500 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-12 text-slate-400">Chargement…</TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow data-testid="managers-empty">
                <TableCell colSpan={4} className="text-center py-16">
                  <Users className="w-10 h-10 mx-auto text-slate-300 mb-3" strokeWidth={1.4} />
                  <div className="text-sm text-slate-500">Aucun gestionnaire pour le moment</div>
                  <div className="text-xs text-slate-400 mt-1">Ajoutez un gestionnaire pour qu'il gère ses devis</div>
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id} className="hover:bg-slate-50/60" data-testid={`row-user-${u.id}`}>
                  <TableCell className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-display text-slate-700 font-medium">
                        {u.username.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-900">{u.username}</div>
                        <div className="text-xs text-slate-400 inline-flex items-center gap-1">
                          <Shield className="w-3 h-3" /> Gestionnaire
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
                      {u.files_count} {u.files_count > 1 ? "devis" : "devis"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {new Date(u.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        size="sm" variant="outline" className="h-8 rounded-lg"
                        onClick={() => openEdit(u)}
                        data-testid={`btn-edit-user-${u.id}`}
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Modifier
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 rounded-lg text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" data-testid={`btn-delete-user-${u.id}`}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Supprimer
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Supprimer ce gestionnaire ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Le compte "{u.username}" et tous ses {u.files_count} devis seront définitivement supprimés.
                              Cette action est irréversible.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid={`btn-delete-user-cancel-${u.id}`}>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 hover:bg-red-700"
                              onClick={() => handleDelete(u)}
                              data-testid={`btn-delete-user-confirm-${u.id}`}
                            >
                              Supprimer
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">Modifier le gestionnaire</DialogTitle>
            <DialogDescription>
              Modifiez le nom d'utilisateur et/ou le mot de passe. Laissez le mot de passe vide pour ne pas le changer.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4" data-testid="manager-edit-form">
            <div>
              <Label className="text-foreground text-sm font-medium">Nom d'utilisateur</Label>
              <Input
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                className="mt-2 h-11 rounded-xl"
                data-testid="input-edit-username"
              />
            </div>
            <div>
              <Label className="text-foreground text-sm font-medium inline-flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Nouveau mot de passe
              </Label>
              <Input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Laisser vide pour ne pas changer"
                className="mt-2 h-11 rounded-xl"
                data-testid="input-edit-password"
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)} data-testid="btn-edit-cancel">
                Annuler
              </Button>
              <Button type="submit" disabled={submitting} className="bg-brand text-white" data-testid="btn-edit-submit">
                {submitting ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "../components/ui/dialog";
import { UserCog, KeyRound, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function MyAccountDialog({ trigger }) {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const reset = () => {
    setNewUsername(""); setNewPassword(""); setConfirmPassword(""); setCurrentPassword("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error("Veuillez saisir votre mot de passe actuel");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      toast.error("Les nouveaux mots de passe ne correspondent pas");
      return;
    }
    if (!newUsername.trim() && !newPassword) {
      toast.info("Aucun changement à enregistrer");
      return;
    }
    setSubmitting(true);
    try {
      const payload = { current_password: currentPassword };
      if (newUsername.trim() && newUsername.trim().toLowerCase() !== user.username) {
        payload.username = newUsername.trim();
      }
      if (newPassword) payload.new_password = newPassword;

      const { data } = await api.patch("/auth/me", payload);
      const changes = (data.changed || []).map((c) => c === "username" ? "nom" : "mot de passe").join(" + ");
      toast.success(`Compte mis à jour (${changes})`, {
        description: data.warning || undefined,
        duration: 7000,
      });
      await refresh();
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" data-testid="btn-my-account">
            <UserCog className="w-4 h-4 mr-1.5" /> Mon compte
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">Mon compte</DialogTitle>
          <DialogDescription>
            Modifiez votre nom d'utilisateur et/ou votre mot de passe. Le mot de passe actuel est requis pour confirmer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" data-testid="my-account-form">
          <div>
            <Label className="text-foreground text-sm font-medium">Nom d'utilisateur actuel</Label>
            <div className="mt-2 px-3 h-11 flex items-center rounded-xl bg-muted/50 border border-border text-sm text-foreground/80 font-mono">
              {user?.username}
            </div>
          </div>

          <div>
            <Label className="text-foreground text-sm font-medium">Nouveau nom d'utilisateur (optionnel)</Label>
            <Input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Laisser vide pour garder le même"
              className="mt-2 h-11 rounded-xl"
              autoComplete="off"
              data-testid="input-new-username-self"
            />
          </div>

          <div className="border-t border-border pt-4">
            <Label className="text-foreground text-sm font-medium inline-flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> Nouveau mot de passe (optionnel)
            </Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="6 caractères minimum"
              className="mt-2 h-11 rounded-xl"
              autoComplete="new-password"
              data-testid="input-new-password-self"
            />
            {newPassword && (
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmer le nouveau mot de passe"
                className="mt-2 h-11 rounded-xl"
                autoComplete="new-password"
                data-testid="input-confirm-password-self"
              />
            )}
          </div>

          <div className="border-t border-border pt-4">
            <Label className="text-foreground text-sm font-medium">Mot de passe actuel <span className="text-destructive">*</span></Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Requis pour confirmer le changement"
              className="mt-2 h-11 rounded-xl"
              autoComplete="current-password"
              data-testid="input-current-password-self"
              required
            />
          </div>

          {user?.role === "super_admin" && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Les changements faits ici seront <strong>écrasés au prochain redémarrage</strong> si <code className="font-mono">SYNC_PASSWORDS = True</code> dans <code className="font-mono">config.py</code>. Pour rendre les changements permanents, mettez aussi à jour <code className="font-mono">config.py</code>.
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="btn-self-cancel">
              Annuler
            </Button>
            <Button type="submit" disabled={submitting} className="bg-brand text-white" data-testid="btn-self-submit">
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

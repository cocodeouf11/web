import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { ShieldCheck, KeyRound, Lock, FileText, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loadingCode, setLoadingCode] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const submitCode = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      toast.error("Veuillez entrer un code d'accès");
      return;
    }
    setLoadingCode(true);
    try {
      const { data } = await api.post("/access/verify", { code: code.trim() });
      toast.success(`Document trouvé : ${data.filename}`);
      navigate(`/sign/${encodeURIComponent(code.trim().toUpperCase())}`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Code invalide");
    } finally {
      setLoadingCode(false);
    }
  };

  const submitAdmin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Identifiants requis");
      return;
    }
    setLoadingAdmin(true);
    const res = await login(username.trim(), password);
    setLoadingAdmin(false);
    if (res.ok) {
      toast.success("Connexion réussie");
      navigate("/admin");
    } else {
      toast.error(res.error || "Identifiants invalides");
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Left: form */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-md fade-in">
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 mb-6">
              <div className="w-9 h-9 rounded-xl bg-[#0055FF] flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" strokeWidth={1.8} />
              </div>
              <span className="font-display text-lg font-semibold tracking-tight">Soizic</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl tracking-tight font-medium text-slate-900">
              Bienvenue.
            </h1>
            <p className="text-slate-500 mt-3 text-base">
              Signez vos devis ou gérez vos documents en toute sécurité.
            </p>
          </div>

          <Tabs defaultValue="signer" className="w-full" data-testid="login-tabs">
            <TabsList className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl h-11">
              <TabsTrigger
                value="signer"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
                data-testid="tab-signer"
              >
                <KeyRound className="w-4 h-4 mr-2" strokeWidth={1.6} /> Signataire
              </TabsTrigger>
              <TabsTrigger
                value="admin"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
                data-testid="tab-admin"
              >
                <ShieldCheck className="w-4 h-4 mr-2" strokeWidth={1.6} /> Gestionnaire
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signer" className="mt-6">
              <form onSubmit={submitCode} className="space-y-5" data-testid="signer-form">
                <div>
                  <Label htmlFor="code" className="text-slate-700 text-sm font-medium">
                    Code d'accès
                  </Label>
                  <Input
                    id="code"
                    placeholder="DEV-12345-AB"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="mt-2 h-12 rounded-xl font-mono tracking-wider text-base"
                    data-testid="input-access-code"
                    autoComplete="off"
                  />
                  <p className="text-xs text-slate-400 mt-2">
                    Le code vous a été communiqué par votre prestataire.
                  </p>
                </div>
                <Button
                  type="submit"
                  disabled={loadingCode}
                  className="w-full h-12 rounded-xl bg-[#0055FF] hover:bg-[#0044CC] text-white text-base font-medium"
                  data-testid="btn-access-code"
                >
                  {loadingCode ? "Vérification…" : (
                    <>Accéder au document <ArrowRight className="w-4 h-4 ml-2" /></>
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="admin" className="mt-6">
              <form onSubmit={submitAdmin} className="space-y-5" data-testid="admin-form">
                <div>
                  <Label htmlFor="username" className="text-slate-700 text-sm font-medium">
                    Nom d'utilisateur
                  </Label>
                  <Input
                    id="username"
                    placeholder="utilisateur"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="mt-2 h-12 rounded-xl"
                    data-testid="input-username"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <Label htmlFor="password" className="text-slate-700 text-sm font-medium">
                    Mot de passe
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-2 h-12 rounded-xl"
                    data-testid="input-password"
                    autoComplete="current-password"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loadingAdmin}
                  className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-base font-medium"
                  data-testid="btn-admin-login"
                >
                  {loadingAdmin ? "Connexion…" : (
                    <><Lock className="w-4 h-4 mr-2" /> Se connecter</>
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-xs text-slate-400 mt-10">
            Plateforme sécurisée · Vos données sont protégées
          </p>
        </div>
      </div>

      {/* Right: visual */}
      <div className="hidden lg:block relative mesh-bg overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center p-12">
          <div className="max-w-lg space-y-6">
            <h2 className="font-display text-5xl tracking-tight font-medium text-slate-900 leading-[1.05]">
              Signez vos devis.<br/>
              <span className="text-[#0055FF]">Simplement.</span>
            </h2>
            <p className="text-slate-600 text-lg leading-relaxed">
              Une signature électronique fluide, rapide, et sans friction. Recevez votre code, signez en un geste.
            </p>
            <div className="grid grid-cols-3 gap-3 pt-6">
              {[
                { k: "01", v: "Recevez votre code" },
                { k: "02", v: "Vérifiez le devis" },
                { k: "03", v: "Signez en un geste" },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur p-4">
                  <div className="text-xs font-mono text-[#0055FF] mb-1">{s.k}</div>
                  <div className="text-sm font-medium text-slate-800">{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../components/ui/table";
import {
  Database, Table as TableIcon, ChevronLeft, ChevronRight, RefreshCcw, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";

const PAGE_SIZE = 25;

export default function DatabaseExplorer() {
  const [tables, setTables] = useState([]);
  const [active, setActive] = useState(null);
  const [tableData, setTableData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const loadTables = async () => {
    try {
      const { data } = await api.get("/admin/db/tables");
      setTables(data);
      if (!active && data.length) setActive(data[0].name);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    }
  };

  const loadTable = async (name, off = 0) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/db/table/${name}`, {
        params: { limit: PAGE_SIZE, offset: off },
      });
      setTableData(data);
      setOffset(off);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTables(); }, []);
  useEffect(() => {
    if (active) loadTable(active, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const total = tableData?.total || 0;
  const page = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const renderCell = (col, value) => {
    if (value === null || value === undefined) return <span className="text-muted-foreground/60 italic">null</span>;
    const str = typeof value === "string" ? value : String(value);
    if (col === "id" || col === "created_by") {
      return <span className="font-mono text-xs">{str.slice(0, 8)}…</span>;
    }
    if (col === "password_hash") {
      return <span className="font-mono text-xs text-muted-foreground">{str}</span>;
    }
    if (col === "content_b64") {
      return <span className="font-mono text-xs text-muted-foreground">{str}</span>;
    }
    if (col === "size") {
      return <span>{(Number(str) / 1024).toFixed(1)} KB</span>;
    }
    if (col === "created_at" || col === "signed_at") {
      try { return new Date(str).toLocaleString("fr-FR"); } catch { return str; }
    }
    if (col === "role") {
      return <span className="inline-flex px-2 py-0.5 rounded-md bg-muted text-foreground text-xs font-medium">{str}</span>;
    }
    if (col === "status") {
      return (
        <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${
          str === "signed" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                           : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
        }`}>{str}</span>
      );
    }
    return <span className="break-all">{str}</span>;
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden" data-testid="db-explorer">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
            <Database className="w-5 h-5 text-brand" strokeWidth={1.6} />
          </div>
          <div>
            <h2 className="font-display text-lg font-medium text-foreground">Base de données</h2>
            <p className="text-xs text-muted-foreground">Exploration en lecture seule des tables — réservé super admin</p>
          </div>
        </div>
        <Button
          variant="outline" size="sm" className="h-9 rounded-lg"
          onClick={() => active && loadTable(active, offset)}
          data-testid="btn-db-refresh"
        >
          <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Actualiser
        </Button>
      </div>

      {/* Tables tabs */}
      <div className="flex items-center gap-2 p-4 border-b border-border overflow-x-auto">
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => setActive(t.name)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active === t.name
                ? "bg-brand text-white"
                : "bg-muted text-foreground hover:bg-muted/70"
            }`}
            data-testid={`db-tab-${t.name}`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            {t.name}
            <span className={`ml-1 px-1.5 py-0.5 rounded text-xs ${
              active === t.name ? "bg-white/20" : "bg-background"
            }`}>{t.row_count}</span>
          </button>
        ))}
      </div>

      {/* Table content */}
      <div className="overflow-x-auto">
        {loading && (
          <div className="p-12 text-center text-muted-foreground inline-flex items-center justify-center w-full gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
          </div>
        )}
        {!loading && tableData && (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 border-y border-border">
                {tableData.columns.map((c) => (
                  <TableHead key={c} className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableData.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tableData.columns.length} className="text-center py-12 text-muted-foreground">
                    Table vide
                  </TableCell>
                </TableRow>
              ) : tableData.rows.map((row, i) => (
                <TableRow key={row.id || i} className="hover:bg-muted/40">
                  {tableData.columns.map((c) => (
                    <TableCell key={c} className="text-sm text-foreground/90 align-top max-w-[260px]">
                      {renderCell(c, row[c])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {tableData && total > PAGE_SIZE && (
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} sur {total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm" className="h-8 rounded-lg"
              disabled={offset === 0}
              onClick={() => loadTable(active, Math.max(0, offset - PAGE_SIZE))}
              data-testid="btn-db-prev"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground">Page {page}/{totalPages}</span>
            <Button
              variant="outline" size="sm" className="h-8 rounded-lg"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => loadTable(active, offset + PAGE_SIZE)}
              data-testid="btn-db-next"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

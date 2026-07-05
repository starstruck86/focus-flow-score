import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Check, X, RefreshCw } from "lucide-react";

const DRILL_JOBS = [
  "drills_tranche5",
  "drills_tranche4",
  "drills_tranche4_fixes",
  "drills_rejected",
];

type DrillPayload = {
  concept_id?: string;
  drill_scenario?: string;
  drill_spoken_task?: string;
  drill_response_shape?: string;
  drill_model_answer?: string;
  drill_teach_script?: string;
  drill_rubric?: Array<{ c: string; must: boolean }>;
  rejected_reason?: string | null;
  source_job?: string;
};

type StagedRow = {
  job: string;
  row_id: string;
  payload: DrillPayload;
  created_at: string;
  // enriched:
  ki_title?: string | null;
  concept_title?: string | null;
  spoke?: string | null;
};

const PAGE_SIZE = 50;

export default function DrillReview() {
  const [job, setJob] = useState<string>("drills_tranche5");
  const [spokeFilter, setSpokeFilter] = useState<string>("all");
  const [conceptFilter, setConceptFilter] = useState<string>("all");
  const [shapeFilter, setShapeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { count } = await supabase
        .from("_agent_staging")
        .select("row_id", { count: "exact", head: true })
        .eq("job", job);
      setTotal(count ?? 0);

      const { data: staged, error } = await supabase
        .from("_agent_staging")
        .select("job,row_id,payload,created_at")
        .eq("job", job)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (error) throw error;
      const list = (staged ?? []) as StagedRow[];

      const kiIds = Array.from(new Set(list.map((r) => r.row_id)));
      const conceptIds = Array.from(
        new Set(
          list
            .map((r) => (r.payload as DrillPayload)?.concept_id)
            .filter(Boolean) as string[]
        )
      );

      const [kiRes, conceptRes] = await Promise.all([
        kiIds.length
          ? supabase.from("ki_curriculum").select("id,ki_id,concept_id").in("id", kiIds)
          : Promise.resolve({ data: [], error: null } as any),
        conceptIds.length
          ? supabase
              .from("curriculum_concepts")
              .select("concept_id,spoke,title")
              .in("concept_id", conceptIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const kiRows = (kiRes.data ?? []) as Array<{
        id: string;
        ki_id: string;
        concept_id: string;
      }>;

      const knowledgeIds = Array.from(new Set(kiRows.map((k) => k.ki_id).filter(Boolean)));
      const kiTitleRes = knowledgeIds.length
        ? await supabase
            .from("knowledge_items")
            .select("id,title")
            .in("id", knowledgeIds)
        : { data: [] as any[] };

      const kiTitleMap = new Map(
        ((kiTitleRes.data ?? []) as Array<{ id: string; title: string }>).map(
          (r) => [r.id, r.title]
        )
      );
      const kiRowMap = new Map(kiRows.map((k) => [k.id, k]));
      const conceptMap = new Map(
        ((conceptRes.data ?? []) as Array<{
          concept_id: string;
          spoke: string;
          title: string;
        }>).map((c) => [c.concept_id, c])
      );

      const enriched: StagedRow[] = list.map((r) => {
        const kiRow = kiRowMap.get(r.row_id);
        const concept =
          conceptMap.get(r.payload?.concept_id ?? "") ??
          (kiRow ? conceptMap.get(kiRow.concept_id) : undefined);
        return {
          ...r,
          ki_title: kiRow ? kiTitleMap.get(kiRow.ki_id) ?? null : null,
          concept_title: concept?.title ?? null,
          spoke: concept?.spoke ?? null,
        };
      });

      setRows(enriched);
    } catch (e: any) {
      toast.error(`Load failed: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, [job, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [job]);

  const spokes = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.spoke).filter(Boolean) as string[])).sort(),
    [rows]
  );
  const concepts = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.payload?.concept_id).filter(Boolean) as string[])
      ).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (spokeFilter !== "all" && r.spoke !== spokeFilter) return false;
      if (conceptFilter !== "all" && r.payload?.concept_id !== conceptFilter)
        return false;
      if (shapeFilter !== "all" && r.payload?.drill_response_shape !== shapeFilter)
        return false;
      if (!q) return true;
      const blob = [
        r.ki_title,
        r.concept_title,
        r.payload?.concept_id,
        r.payload?.drill_scenario,
        r.payload?.drill_spoken_task,
        r.payload?.drill_model_answer,
        r.payload?.drill_teach_script,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search, spokeFilter, conceptFilter, shapeFilter]);

  const act = async (row: StagedRow, action: "approve" | "reject") => {
    setBusyId(row.row_id);
    try {
      const reason = action === "reject" ? rejectReason[row.row_id] ?? null : undefined;
      const { data, error } = await supabase.functions.invoke("drill-review", {
        body: { action, job: row.job, row_id: row.row_id, reason },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(action === "approve" ? "Promoted to ki_curriculum" : "Rejected");
      setRows((rs) => rs.filter((r) => r.row_id !== row.row_id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e: any) {
      toast.error(`${action} failed: ${e.message ?? e}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display">Drill Review</h1>
            <p className="text-sm text-muted-foreground">
              Staged drill candidates from <code>_agent_staging</code> — approve promotes
              to <code>ki_curriculum</code> and sets <code>drill_ready=true</code>.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Job</label>
              <Select value={job} onValueChange={setJob}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DRILL_JOBS.map((j) => (
                    <SelectItem key={j} value={j}>{j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Spoke</label>
              <Select value={spokeFilter} onValueChange={setSpokeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All spokes</SelectItem>
                  {spokes.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Concept</label>
              <Select value={conceptFilter} onValueChange={setConceptFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All concepts</SelectItem>
                  {concepts.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Shape</label>
              <Select value={shapeFilter} onValueChange={setShapeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="quick_reply">quick_reply</SelectItem>
                  <SelectItem value="talk_track">talk_track</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Search</label>
              <Input
                placeholder="title, scenario, answer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-3">
            <span>
              Showing <strong>{filtered.length}</strong> of {rows.length} loaded ·
              total in job: <strong>{total.toLocaleString()}</strong>
            </span>
            <span className="ml-auto flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
              >Prev</Button>
              <span>Page {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <Button
                variant="outline" size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total || loading}
              >Next</Button>
            </span>
          </div>
        </Card>

        {loading && rows.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        )}

        <div className="space-y-3">
          {filtered.map((r) => {
            const p = r.payload ?? {};
            return (
              <Card key={`${r.job}:${r.row_id}`} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{p.concept_id ?? "?"}</Badge>
                  {r.spoke && <Badge variant="outline">spoke: {r.spoke}</Badge>}
                  {p.drill_response_shape && (
                    <Badge variant="outline">{p.drill_response_shape}</Badge>
                  )}
                  {r.concept_title && (
                    <span className="text-sm text-muted-foreground truncate">
                      {r.concept_title}
                    </span>
                  )}
                  <code className="ml-auto text-[10px] text-muted-foreground">
                    {r.row_id.slice(0, 8)}
                  </code>
                </div>
                {r.ki_title && (
                  <div className="text-sm font-medium">{r.ki_title}</div>
                )}
                <Section label="Scenario" text={p.drill_scenario} />
                <Section label="Spoken task" text={p.drill_spoken_task} />
                <Section label="Model answer" text={p.drill_model_answer} />
                <Section label="Teach script" text={p.drill_teach_script} />
                {Array.isArray(p.drill_rubric) && p.drill_rubric.length > 0 && (
                  <div className="text-xs">
                    <div className="text-muted-foreground mb-1">Rubric</div>
                    <ul className="list-disc ml-5 space-y-0.5">
                      {p.drill_rubric.map((r2, i) => (
                        <li key={i}>
                          <span
                            className={
                              r2.must
                                ? "font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {r2.must ? "MUST · " : "nice · "}
                            {r2.c}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.rejected_reason && (
                  <div className="text-xs text-destructive">
                    Rejected: {p.rejected_reason}
                    {p.source_job ? ` (from ${p.source_job})` : ""}
                  </div>
                )}

                {r.job !== "drills_rejected" && (
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t">
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs text-muted-foreground">
                        Reject reason (optional)
                      </label>
                      <Textarea
                        rows={1}
                        value={rejectReason[r.row_id] ?? ""}
                        onChange={(e) =>
                          setRejectReason((s) => ({
                            ...s,
                            [r.row_id]: e.target.value,
                          }))
                        }
                        placeholder="why is this bad?"
                      />
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyId === r.row_id}
                      onClick={() => act(r, "reject")}
                    >
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === r.row_id}
                      onClick={() => act(r, "approve")}
                    >
                      {busyId === r.row_id ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-1" />
                      )}
                      Approve
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              Nothing matches these filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div className="text-sm">
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
    </div>
  );
}

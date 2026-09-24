"use client";
/**
 * Fixture labeler. The owner corrects the model's draft instead of typing JSON:
 * - one card per document in the photo (the check lying on the invoice is its own card),
 * - several checks per photo, multi-page photo sets, statements row by row,
 * - an explicit "amount owed" block for handwritten adjusted totals,
 * - questions from the agent answered inline (never in chat).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DOC_TYPES, type DocType } from "@/lib/contracts/extraction";
import { emptyCheck, emptyPayload, type LabelFile } from "@/lib/fixtures/label";
import type { FixtureItem } from "@/lib/fixtures/store";

type F = { value: string | number | boolean | null; confidence: number };
type Obj = Record<string, unknown>;
type Filter = "todo" | "all" | "labeled";

export function LabelHelper() {
  const [items, setItems] = useState<FixtureItem[]>([]);
  const [draftsEnabled, setDraftsEnabled] = useState(false);
  const [filter, setFilter] = useState<Filter>("todo");
  const [current, setCurrent] = useState<string | null>(null);
  const [label, setLabel] = useState<LabelFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/label/items").then((x) => x.json());
    setItems(r.items);
    setDraftsEnabled(r.draftsEnabled);
    return r.items as FixtureItem[];
  }, []);

  useEffect(() => {
    refresh().then((list) => setCurrent((c) => c ?? list.find((i) => i.status !== "labeled" && !i.pageOf)?.image ?? list[0]?.image ?? null));
  }, [refresh]);

  useEffect(() => {
    if (!current) return;
    setLabel(null);
    setMessage(null);
    setPage(0);
    setDirty(false);
    fetch(`/api/label/item?image=${encodeURIComponent(current)}`).then((x) => x.json()).then((r) => setLabel(r.working));
  }, [current]);

  const visible = useMemo(
    () => items.filter((i) => (filter === "all" ? true : filter === "labeled" ? i.status === "labeled" || i.status === "skipped" : i.status !== "labeled" && i.status !== "skipped" && !i.pageOf)),
    [items, filter],
  );
  const counts = useMemo(() => {
    const c = { labeled: 0, skipped: 0, draft: 0, unlabeled: 0 };
    for (const i of items) if (!i.pageOf) c[i.status]++;
    return c;
  }, [items]);

  const go = (image: string | null) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setCurrent(image);
  };
  const nextTodo = (list: FixtureItem[]) => {
    const idx = list.findIndex((i) => i.image === current);
    const after = [...list.slice(idx + 1), ...list.slice(0, idx)];
    return after.find((i) => i.status !== "labeled" && i.status !== "skipped" && !i.pageOf)?.image ?? null;
  };

  const update = (fn: (l: LabelFile) => void) => {
    setLabel((l) => {
      if (!l) return l;
      const copy = structuredClone(l);
      fn(copy);
      return copy;
    });
    setDirty(true);
  };

  async function draft() {
    if (!label) return;
    if (label.status === "labeled" && !confirm("This photo is already labeled. Re-drafting replaces the fields in the editor (the saved label stays until you save). Continue?")) return;
    setBusy("Reading the photo…");
    setMessage(null);
    const r = await fetch("/api/label/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: label.image, pages: label.pages }) }).then((x) => x.json());
    setBusy(null);
    if (r.error) return setMessage({ kind: "error", text: r.error });
    setLabel(r.draft);
    setDirty(true);
    setMessage({ kind: "ok", text: `Draft ready in ${(r.latencyMs / 1000).toFixed(1)} s${r.costUsd != null ? `, $${r.costUsd.toFixed(3)}` : ""}${r.issues.length ? ` — ${r.issues.join("; ")}` : ""}` });
    refresh();
  }

  async function save(status: "labeled" | "skipped") {
    if (!label) return;
    let skip_reason = label.skip_reason;
    if (status === "skipped") {
      skip_reason = prompt("Why skip this photo? (e.g. blurry duplicate, not paper)", skip_reason ?? "") ?? null;
      if (!skip_reason) return;
    }
    setBusy("Saving…");
    const r = await fetch("/api/label/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: { ...label, status, skip_reason } }) }).then((x) => x.json());
    setBusy(null);
    if (r.error) return setMessage({ kind: "error", text: r.error });
    setDirty(false);
    const list = await refresh();
    const next = nextTodo(list);
    if (next) setCurrent(next);
    else {
      setLabel(r.label);
      setMessage({ kind: "ok", text: "Saved. Nothing left to label." });
    }
  }

  const currentItem = items.find((i) => i.image === current);
  const idx = items.findIndex((i) => i.image === current);
  const pageImage = label?.pages[page] ?? current;

  return (
    <div className="lh">
      <style>{CSS}</style>
      <aside>
        <h1>Fixture labels</h1>
        <p className="muted">
          {counts.labeled} labeled · {counts.skipped} skipped · {counts.draft} drafted · {counts.unlabeled} to do
        </p>
        <div className="tabs">
          {(["todo", "all", "labeled"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "todo" ? "To do" : f === "all" ? "All" : "Done"}</button>
          ))}
        </div>
        <ul>
          {visible.map((i) => (
            <li key={i.image} className={i.image === current ? "sel" : ""} onClick={() => go(i.image)}>
              <span className={`chip ${i.status}`}>{i.pageOf ? "page" : i.status}</span>
              <span className="nm">{i.capturedAt?.replace("T", " ").slice(0, 16) ?? i.image}</span>
              <span className="muted sm">{i.sender ?? "sender unknown"}{i.caption ? ` · ${i.caption.slice(0, 40)}` : ""}</span>
            </li>
          ))}
          {!visible.length && <li className="muted">Nothing here. Run <code>npm run import:whatsapp -- fixtures/raw/chat.txt</code>.</li>}
        </ul>
      </aside>

      <section className="photo">
        {pageImage && (
          <>
            <div className="bar">
              <button onClick={() => go(items[idx - 1]?.image ?? null)} disabled={idx <= 0}>← Prev</button>
              <span className="muted sm">{current}{currentItem?.pageOf ? ` — page of ${currentItem.pageOf}` : ""}</span>
              <button onClick={() => go(items[idx + 1]?.image ?? null)} disabled={idx < 0 || idx >= items.length - 1}>Next →</button>
            </div>
            {label && label.pages.length > 1 && (
              <div className="pages">
                {label.pages.map((p, i) => (
                  <button key={p} className={i === page ? "on" : ""} onClick={() => setPage(i)}>Page {i + 1}</button>
                ))}
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/label/image?name=${encodeURIComponent(pageImage)}`} alt="fixture" className={zoom ? "zoom" : ""} onClick={() => setZoom(!zoom)} />
            <p className="muted sm">Click the photo to zoom. {currentItem?.caption ? `Chat caption: “${currentItem.caption}”` : ""}</p>
          </>
        )}
      </section>

      <section className="editor">
        {!label ? (
          <p className="muted">{current ? "Loading…" : "No photos yet."}</p>
        ) : (
          <>
            <div className="bar">
              <span className={`chip ${label.status}`}>{label.status === "draft" && !label.draft_source ? "new" : label.status}</span>
              {label.draft_source && <span className="muted sm">draft: {label.draft_source.model} · prompt {label.draft_source.prompt_version}</span>}
              <span className="grow" />
              <button onClick={draft} disabled={!draftsEnabled || !!busy} title={draftsEnabled ? "" : "Set ANTHROPIC_API_KEY and EXTRACTION_MODEL in .env.local"}>
                {label.draft_source ? "Re-draft" : "Draft with model"}
              </button>
            </div>
            {!draftsEnabled && <p className="warn">No model configured — fill the fields by hand, or add the API key to .env.local and restart.</p>}
            {busy && <p className="muted">{busy}</p>}
            {message && <p className={message.kind === "error" ? "err" : "ok"}>{message.text}</p>}

            <PagesControl label={label} items={items} update={update} />

            {label.questions.length > 0 && (
              <div className="questions">
                <h3>Questions for you</h3>
                {label.questions.map((q, qi) => (
                  <div key={q.id} className="q">
                    <p>{q.text}</p>
                    <div className="row">
                      {q.id.endsWith(".adjusted") && (
                        <>
                          <button className={q.answer === "yes — handwritten is owed" ? "on" : ""} onClick={() => update((l) => { l.questions[qi]!.answer = "yes — handwritten is owed"; })}>Yes, handwritten is owed</button>
                          <button className={q.answer === "no — printed total is owed" ? "on" : ""} onClick={() => update((l) => {
                            l.questions[qi]!.answer = "no — printed total is owed";
                            const d = l.documents[Number(q.id.split(".")[0])];
                            if (d) ((d.payload as Obj).handwritten_adjusted_total as F).value = null;
                          })}>No, printed total is owed</button>
                        </>
                      )}
                      <input placeholder="Your answer" value={q.answer ?? ""} onChange={(e) => update((l) => { l.questions[qi]!.answer = e.target.value || null; })} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {label.documents.map((d, di) => (
              <div key={di} className="doc">
                <div className="bar">
                  <strong>{di === 0 ? "Main document" : "Also in this photo"}</strong>
                  <select value={d.doc_type} onChange={(e) => update((l) => { const t = e.target.value as DocType; l.documents[di] = { doc_type: t, payload: emptyPayload(t) }; })}>
                    {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                  </select>
                  <span className="grow" />
                  {di > 0 && <button className="link" onClick={() => update((l) => { l.documents.splice(di, 1); })}>Remove</button>}
                </div>
                <DocumentEditor docType={d.doc_type} payload={d.payload} showConfidence={label.status === "draft"} set={(fn) => update((l) => fn(l.documents[di]!.payload))} />
              </div>
            ))}

            <div className="row">
              <span className="muted sm">Also in this photo:</span>
              {(["check", "invoice", "note"] as const).map((t) => (
                <button key={t} onClick={() => update((l) => { l.documents.push({ doc_type: t, payload: emptyPayload(t) }); })}>+ {t}</button>
              ))}
            </div>

            <label className="fld wide">
              <span>Notes for the scorer (optional)</span>
              <textarea rows={2} value={label.notes ?? ""} onChange={(e) => update((l) => { l.notes = e.target.value || null; })} />
            </label>

            <div className="actions">
              <button className="primary" onClick={() => save("labeled")} disabled={!!busy}>{label.status === "labeled" && !dirty ? "Save again" : "Looks right — save"}</button>
              <button onClick={() => save("skipped")} disabled={!!busy}>Skip photo…</button>
              {dirty && <span className="muted sm">unsaved changes</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PagesControl({ label, items, update }: { label: LabelFile; items: FixtureItem[]; update: (fn: (l: LabelFile) => void) => void }) {
  const lastIdx = items.findIndex((i) => i.image === label.pages[label.pages.length - 1]);
  const next = items[lastIdx + 1];
  return (
    <div className="row sm">
      <span className="muted">{label.pages.length === 1 ? "Single photo." : `${label.pages.length} photos = one document set.`}</span>
      {next && !next.pageOf && next.status !== "labeled" && (
        <button onClick={() => update((l) => { l.pages.push(next.image); })}>+ Next photo is page {label.pages.length + 1}</button>
      )}
      {label.pages.length > 1 && <button onClick={() => update((l) => { l.pages.pop(); })}>− Remove last page</button>}
    </div>
  );
}

function DocumentEditor({ docType, payload, showConfidence, set }: { docType: DocType; payload: unknown; showConfidence: boolean; set: (fn: (p: unknown) => void) => void }) {
  const p = payload as Obj;
  const fld = (key: string, label: string, kind: Kind = "text") => (
    <FieldInput key={key} label={label} kind={kind} f={p[key] as F} showConfidence={showConfidence} onChange={(v) => set((x) => { ((x as Obj)[key] as F).value = v; })} />
  );

  if (docType === "invoice" || docType === "credit_memo") {
    const printed = (p.total as F).value as number | null;
    const adjusted = (p.handwritten_adjusted_total as F).value as number | null;
    return (
      <div className="grid">
        {fld("vendor_name_printed", "Vendor (as printed)")}
        {fld("invoice_number", "Invoice #")}
        {fld("invoice_date", "Invoice date", "date")}
        {fld("due_date", "Due date", "date")}
        {fld("subtotal", "Subtotal", "money")}
        {fld("tax", "Tax", "money")}
        {fld("total", "Printed total", "money")}
        {fld("handwritten_adjusted_total", "Handwritten adjusted total", "money")}
        <div className="owed wide">
          Amount owed (bill amount):{" "}
          <strong>{adjusted != null ? `$${adjusted.toFixed(2)} — handwritten` : printed != null ? `$${printed.toFixed(2)} — printed` : "—"}</strong>
          {adjusted != null && printed != null && <span className="muted"> (printed ${printed.toFixed(2)}, difference ${(printed - adjusted).toFixed(2)})</span>}
        </div>
        {fld("terms", "Terms")}
        {fld("vendor_address", "Vendor address")}
        {fld("check_number_referenced", "Check # written on it")}
        {fld("paid_date_referenced", "Paid date written on it", "date")}
        <Toggle label="Credit memo (returns / shortage)" value={!!p.is_credit} onChange={(v) => set((x) => { (x as Obj).is_credit = v; })} />
        <FieldInput label="Paid stamp / COD" kind="bool" f={p.paid_stamp_or_cod as F} showConfidence={showConfidence} onChange={(v) => set((x) => { ((x as Obj).paid_stamp_or_cod as F).value = v; })} />
        <NumberInput label="Pages the document has" value={p.page_count_seen as number} onChange={(v) => set((x) => { (x as Obj).page_count_seen = v ?? 1; })} />
        <Lines label="Handwritten notes (one per line)" value={p.handwritten_notes as string[]} onChange={(v) => set((x) => { (x as Obj).handwritten_notes = v; })} />
      </div>
    );
  }

  if (docType === "check") {
    const checks = payload as Obj[];
    return (
      <div>
        {checks.map((c, ci) => {
          const cf = (key: string, label: string, kind: Kind = "text") => (
            <FieldInput key={key} label={label} kind={kind} f={c[key] as F} showConfidence={showConfidence} onChange={(v) => set((x) => { ((x as Obj[])[ci]![key] as F).value = v; })} />
          );
          return (
            <div key={ci} className="sub">
              <div className="bar">
                <strong>Check {ci + 1} of {checks.length}</strong>
                <span className="grow" />
                {checks.length > 1 && <button className="link" onClick={() => set((x) => { (x as Obj[]).splice(ci, 1); })}>Remove</button>}
              </div>
              <div className="grid">
                {cf("check_number", "Check #")}
                {cf("payee", "Payee (as written)")}
                {cf("amount_numeric", "Amount (box)", "money")}
                {cf("amount_written", "Amount (words)")}
                {cf("date", "Date", "date")}
                {cf("memo", "Memo")}
                <Csv label="Invoice #s on the memo (comma separated)" value={c.memo_invoice_numbers as string[]} onChange={(v) => set((x) => { (x as Obj[])[ci]!.memo_invoice_numbers = v; })} />
                <Toggle label="Signed" value={!!c.signed} onChange={(v) => set((x) => { (x as Obj[])[ci]!.signed = v; })} />
              </div>
            </div>
          );
        })}
        <button onClick={() => set((x) => { (x as Obj[]).push(emptyCheck()); })}>+ Another check in this photo</button>
        <p className="muted sm">Never type the bank routing or account number (the digits along the bottom).</p>
      </div>
    );
  }

  if (docType === "statement") {
    const rows = p.rows as Obj[];
    const groups = p.handwritten_groups as { label: string; ref_numbers: string[]; total: number | null }[];
    return (
      <div>
        <div className="grid">
          {fld("vendor_name_printed", "Vendor (as printed)")}
          {fld("customer_name_printed", "Customer (the store)")}
          {fld("statement_date", "Statement date", "date")}
          {fld("total_balance", "Total balance", "money")}
        </div>
        <table>
          <thead><tr><th>Date</th><th>Kind</th><th>Ref #</th><th>Amount</th><th>Due</th><th /></tr></thead>
          <tbody>
            {rows.map((r, ri) => {
              const rf = (key: string, kind: Kind) => (
                <td key={key}><FieldInput bare kind={kind} f={r[key] as F} showConfidence={showConfidence} onChange={(v) => set((x) => { (((x as Obj).rows as Obj[])[ri]![key] as F).value = v; })} /></td>
              );
              return (
                <tr key={ri}>
                  {rf("date", "date")}
                  <td>
                    <select value={r.kind as string} onChange={(e) => set((x) => { ((x as Obj).rows as Obj[])[ri]!.kind = e.target.value; })}>
                      {["invoice", "credit", "payment", "other"].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </td>
                  {rf("ref_number", "text")}
                  {rf("amount", "money")}
                  {rf("due_date", "date")}
                  <td><button className="link" onClick={() => set((x) => { ((x as Obj).rows as Obj[]).splice(ri, 1); })}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button onClick={() => set((x) => { const e = { value: null, confidence: 0 }; ((x as Obj).rows as Obj[]).push({ date: { ...e }, kind: "invoice", ref_number: { ...e }, amount: { ...e }, due_date: { ...e } }); })}>+ Row</button>
        <h4>Handwritten month groups</h4>
        {groups.map((g, gi) => (
          <div key={gi} className="row">
            <input placeholder="Label, e.g. June 2026" value={g.label} onChange={(e) => set((x) => { ((x as Obj).handwritten_groups as typeof groups)[gi]!.label = e.target.value; })} />
            <input placeholder="Invoice #s, comma separated" value={g.ref_numbers.join(", ")} onChange={(e) => set((x) => { ((x as Obj).handwritten_groups as typeof groups)[gi]!.ref_numbers = splitCsv(e.target.value); })} />
            <input placeholder="Written total" inputMode="decimal" value={g.total ?? ""} onChange={(e) => set((x) => { ((x as Obj).handwritten_groups as typeof groups)[gi]!.total = parseMoney(e.target.value); })} />
            <button className="link" onClick={() => set((x) => { ((x as Obj).handwritten_groups as typeof groups).splice(gi, 1); })}>×</button>
          </div>
        ))}
        <button onClick={() => set((x) => { ((x as Obj).handwritten_groups as typeof groups).push({ label: "", ref_numbers: [], total: null }); })}>+ Group</button>
        <Lines label="Other handwritten notes" value={p.handwritten_notes as string[]} onChange={(v) => set((x) => { (x as Obj).handwritten_notes = v; })} />
      </div>
    );
  }

  return (
    <div className="grid">
      {fld("vendor_name_printed", "Vendor (if any)")}
      {fld("date", "Date", "date")}
      {fld("amount_mentioned", "Amount mentioned", "money")}
      <label className="fld wide">
        <span>Summary</span>
        <textarea rows={2} value={(p.summary as string) ?? ""} onChange={(e) => set((x) => { (x as Obj).summary = e.target.value; })} />
      </label>
    </div>
  );
}

type Kind = "text" | "money" | "date" | "bool";

function FieldInput({ label, kind, f, showConfidence, onChange, bare }: { label?: string; kind: Kind; f: F; showConfidence: boolean; onChange: (v: F["value"]) => void; bare?: boolean }) {
  const [text, setText] = useSynced(display(f.value));
  const conf = showConfidence && f.value !== null ? (f.confidence < 0.5 ? "low" : f.confidence < 0.85 ? "mid" : "") : "";
  const input =
    kind === "bool" ? (
      <select value={f.value === null ? "" : String(f.value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}>
        <option value="">not shown</option><option value="true">yes</option><option value="false">no</option>
      </select>
    ) : (
      <input
        className={conf}
        value={text}
        inputMode={kind === "money" ? "decimal" : undefined}
        placeholder={kind === "date" ? "YYYY-MM-DD" : "—"}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(kind === "money" ? parseMoney(text) : text.trim() === "" ? null : text.trim())}
      />
    );
  if (bare) return input;
  return (
    <label className="fld">
      <span>{label}{conf && <em className={conf}> model {Math.round(f.confidence * 100)}%</em>}</span>
      {input}
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number | null) => void }) {
  return <label className="fld"><span>{label}</span><input inputMode="numeric" value={value} onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))} /></label>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="fld tg"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}
function Lines({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useSynced(value.join("\n"));
  return <label className="fld wide"><span>{label}</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split("\n").map((s) => s.trim()).filter(Boolean))} /></label>;
}
function Csv({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useSynced(value.join(", "));
  return <label className="fld"><span>{label}</span><input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(splitCsv(text))} /></label>;
}
/** Local edit buffer that resets when the underlying label changes (e.g. after a re-draft). */
function useSynced(source: string): [string, (s: string) => void] {
  const [text, setText] = useState(source);
  useEffect(() => setText(source), [source]);
  return [text, setText];
}

function display(v: F["value"]): string {
  return v === null || v === undefined ? "" : typeof v === "number" ? v.toFixed(2) : String(v);
}
/** Labels store amounts in the SPEC §6 model-output shape (decimal); cents conversion happens downstream. */
function parseMoney(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

const CSS = `
.lh{display:grid;grid-template-columns:260px minmax(0,1fr) minmax(380px,520px);height:100vh;font:14px/1.4 system-ui,sans-serif;color:#1d2521;background:#f6f4ef}
.lh aside{border-right:1px solid #ddd8cc;overflow:auto;padding:12px;background:#fff}
.lh h1{font-size:17px;margin:0 0 4px}.lh h3,.lh h4{margin:10px 0 6px;font-size:14px}
.lh ul{list-style:none;margin:8px 0 0;padding:0}.lh li{padding:6px;border-radius:6px;cursor:pointer;display:flex;flex-direction:column;gap:2px;border-bottom:1px solid #f0ede5}
.lh li.sel{background:#e3efe9}.lh li .nm{font-weight:500}
.lh .muted{color:#6b736e}.lh .sm{font-size:12px}.lh .grow{flex:1}
.lh .tabs,.lh .row,.lh .bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
.lh button{border:1px solid #c9c3b4;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit}
.lh button.on{background:#1f5f4a;color:#fff;border-color:#1f5f4a}.lh button:disabled{opacity:.5;cursor:default}
.lh button.primary{background:#1f5f4a;color:#fff;border-color:#1f5f4a;padding:8px 16px;font-weight:600}
.lh button.link{border:none;background:none;color:#a33;padding:2px 4px}
.lh .photo{overflow:auto;padding:12px}.lh .photo img{max-width:100%;max-height:calc(100vh - 110px);display:block;margin:auto;cursor:zoom-in;background:#fff}
.lh .photo img.zoom{max-width:none;max-height:none;cursor:zoom-out}
.lh .pages{display:flex;gap:6px;margin-bottom:6px}
.lh .editor{overflow:auto;padding:12px;border-left:1px solid #ddd8cc;background:#fff}
.lh .doc{border:1px solid #ddd8cc;border-radius:8px;padding:10px;margin:10px 0}.lh .sub{border-top:1px dashed #ddd8cc;padding-top:6px;margin-top:6px}
.lh .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lh .fld{display:flex;flex-direction:column;gap:2px}.lh .fld.wide,.lh .owed.wide{grid-column:1/-1}.lh .fld.tg{flex-direction:row;align-items:center;gap:6px}
.lh .fld span{font-size:12px;color:#6b736e}.lh em{font-style:normal;font-weight:600}.lh em.mid{color:#a06a00}.lh em.low{color:#b3261e}
.lh input,.lh select,.lh textarea{font:inherit;border:1px solid #c9c3b4;border-radius:6px;padding:5px 7px;background:#fff;min-width:0}
.lh input.mid{border:2px solid #e0a100;background:#fff8e6}.lh input.low{border:2px solid #d0453a;background:#fdeeee}
.lh .owed{background:#e3efe9;border-radius:6px;padding:8px}
.lh .questions{background:#fff8e6;border:1px solid #e0a100;border-radius:8px;padding:8px 10px;margin:8px 0}.lh .q p{margin:4px 0}
.lh table{width:100%;border-collapse:collapse;margin:8px 0}.lh td,.lh th{padding:2px;text-align:left;font-size:12px}.lh td input{width:100%}
.lh .chip{font-size:11px;border-radius:10px;padding:1px 7px;background:#eee;align-self:flex-start}
.lh .chip.labeled{background:#d4ecdf;color:#1f5f4a}.lh .chip.draft{background:#fff0c7;color:#7a5200}.lh .chip.skipped{background:#e5e5e5}
.lh .err{color:#b3261e;background:#fdeeee;padding:6px;border-radius:6px}.lh .ok{color:#1f5f4a}.lh .warn{color:#7a5200;background:#fff8e6;padding:6px;border-radius:6px}
.lh .actions{display:flex;gap:8px;align-items:center;position:sticky;bottom:0;background:#fff;padding:10px 0;border-top:1px solid #ddd8cc;margin-top:10px}
`;

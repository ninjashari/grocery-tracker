import { useState, type ChangeEvent } from "react";
import { api, ApiRequestError } from "../api.ts";
import { Card, CardHead, ErrorBanner, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { CSV_COLUMNS } from "@shared/csv.ts";
import type { ImportPreview, ImportResult } from "@shared/types.ts";

export function DataPage() {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<(ImportResult & { skippedRows: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setError(null);
    try {
      const text = await api.exportCsv();
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `grocery-export-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not export");
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setPreview(null);
    setError(null);
    const text = await file.text();
    setCsv(text);
    await runPreview(text);
  }

  async function runPreview(text: string) {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.importPreview(text));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof ApiRequestError ? caught.message : "Could not read that CSV");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importCommit(csv));
      setPreview(null);
      setCsv("");
      setFileName("");
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  const importable = preview !== null && preview.lineCount > 0;

  return (
    <>
      <PageHead title="Import / Export" subtitle="Move your data in and out as CSV." />

      <ErrorBanner error={error} />

      <Card>
        <CardHead title="Export" />
        <div className="card-body">
          <p className="small muted" style={{ marginTop: 0 }}>
            Downloads every bill line as one row. This is the same format the importer accepts, so an export can
            always be re-imported.
          </p>
          <button type="button" className="primary" onClick={() => void download()}>
            Download CSV
          </button>
        </div>
      </Card>

      <Card>
        <CardHead title="Import" />
        <div className="card-body">
          <p className="small muted" style={{ marginTop: 0 }}>
            Nothing is written until you review the summary and confirm. Rows sharing a date, shop and payment
            method become one bill.
          </p>

          <div className="field">
            <label htmlFor="csv-file">CSV file</label>
            <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} />
            {fileName && <div className="small faint" style={{ marginTop: 4 }}>{fileName}</div>}
          </div>

          <details>
            <summary className="small muted" style={{ cursor: "pointer" }}>
              Expected columns
            </summary>
            <p className="small mono" style={{ marginBottom: 0 }}>{CSV_COLUMNS.join(", ")}</p>
            <p className="small faint">
              Required: bill_date (YYYY-MM-DD), shop, item_name, quantity, unit. Either unit_price or line_total
              must be present — if only line_total is given, the unit price is derived. Units: kg, g, L, ml, pcs,
              pack, dozen.
            </p>
          </details>
        </div>

        {busy && !preview && <div className="card-body" style={{ paddingTop: 0 }}>Reading…</div>}

        {preview && (
          <>
            <div className="card-body" style={{ paddingTop: 0 }}>
              <div className="grid cols-4">
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">Bills</div>
                  <div className="stat-value">{preview.billCount}</div>
                </div>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">Lines</div>
                  <div className="stat-value">{preview.lineCount}</div>
                </div>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">Total</div>
                  <div className="stat-value">{formatPaise(preview.totalPaise)}</div>
                </div>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">Rows skipped</div>
                  <div className="stat-value">{preview.errors.length}</div>
                </div>
              </div>

              <div className="grid cols-2" style={{ marginTop: "1rem" }}>
                <NewList title="New items" values={preview.newItems} />
                <NewList title="New categories" values={preview.newCategories} />
              </div>

              {preview.newShops.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <NewList title="New shops" values={preview.newShops} />
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="banner warn" style={{ marginTop: "1rem" }}>
                  <strong>{preview.errors.length} row(s) will be skipped:</strong>
                  <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
                    {preview.errors.slice(0, 8).map((rowError) => (
                      <li key={rowError.row}>
                        Row {rowError.row}: {rowError.message}
                      </li>
                    ))}
                    {preview.errors.length > 8 && <li>…and {preview.errors.length - 8} more</li>}
                  </ul>
                </div>
              )}
            </div>

            <div className="totals-bar">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setPreview(null);
                  setCsv("");
                  setFileName("");
                }}
              >
                Cancel
              </button>
              <button type="button" className="primary" disabled={busy || !importable} onClick={() => void commit()}>
                {busy ? "Importing…" : `Import ${preview.lineCount} line${preview.lineCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="banner ok">
              Imported {result.billsCreated} bill{result.billsCreated === 1 ? "" : "s"} and {result.linesCreated}{" "}
              line{result.linesCreated === 1 ? "" : "s"}. Created {result.itemsCreated} new item
              {result.itemsCreated === 1 ? "" : "s"} and {result.categoriesCreated} new categor
              {result.categoriesCreated === 1 ? "y" : "ies"}.
              {result.skippedRows > 0 && ` Skipped ${result.skippedRows} invalid row(s).`}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function NewList({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <div className="stat-label">
        {title} ({values.length})
      </div>
      {values.length === 0 ? (
        <p className="small faint" style={{ margin: "0.35rem 0 0" }}>
          none — everything already exists
        </p>
      ) : (
        <p className="small" style={{ margin: "0.35rem 0 0" }}>
          {values.slice(0, 12).join(", ")}
          {values.length > 12 && ` …and ${values.length - 12} more`}
        </p>
      )}
    </div>
  );
}

// Scrapes NBIM (fondets verdi) + queries SSB (befolkning) and appends to /data/olje_per_capita.json
// Run locally with: npm run scrape
// Runs on schedule via GitHub Actions (see .github/workflows/scrape.yml)

import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

type Row = {
    ts: string;             // ISO time (UTC)
    fund_nok: number;       // NOK (integer)
    pop: number;            // persons (integer)
    per_capita_nok: number; // NOK per person (float)
};

/** ---------- Helpers ---------- */

const DATA_PATH = path.join(process.cwd(), "data", "olje_per_capita.json");

function readSeries(): Row[] {
    if (!fs.existsSync(DATA_PATH)) return [];
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function writeSeries(rows: Row[]) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(rows, null, 2) + "\n", "utf8");
}

function parseNumberLike(text: string): number | null {
    // Normalize: "20 367", "19,586", etc.
    const t = text
        .replace(/\u00A0/g, " ") // nbsp
        .replace(/[^0-9,\.\s]/g, "")
        .trim();
    // Prefer comma as thousands? NBIM sometimes uses space thousands + comma decimals.
    // Strategy: remove spaces, if more than one comma/dot, strip thousands.
    const noSpace = t.replace(/\s+/g, "");
    // Turn comma to dot if it looks like decimal comma.
    const normalized = noSpace.includes(",") && !noSpace.includes(".")
        ? noSpace.replace(",", ".")
        : noSpace;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
}

/** ---------- NBIM scraping ---------- */
/**
 * We attempt to read "Current market value" on:
 * https://www.nbim.no/en/investments/the-funds-value/
 * which often appears like "20 367 billion kroner" (example).
 * Fallback: find the first "billion kroner" figure on the page.
 */
async function fetchFundValueNOK(): Promise<number> {
    const url = "https://www.nbim.no/en/investments/the-funds-value/";
    const html = await (await fetch(url, { headers: { "user-agent": "olje-per-nordmann/1.0 (+github)" } })).text();
    const $ = cheerio.load(html);

    // 1) Look for a node containing "Current market value"
    let text = "";
    $('[class], h1, h2, h3, p, span, div').each((_, el) => {
        const t = $(el).text().trim();
        if (/Current market value/i.test(t)) {
            // next text siblings often contain the number; grab nearby texts
            const around = $(el).parent().text();
            text = around || t;
        }
    });

    // 2) If not found, just take the first "... billion kroner" mention
    if (!/billion\s+kroner/i.test(text)) {
        const whole = $("body").text();
        const m = whole.match(/([\d\s.,]+)\s+billion\s+kroner/i);
        if (m) text = m[0];
    }

    // 3) Extract the number of billions and convert to NOK
    const m2 = text.match(/([\d\s.,]+)\s+billion\s+kroner/i);
    if (!m2) throw new Error("NBIM: could not find 'billion kroner' figure");
    const billions = parseNumberLike(m2[1]);
    if (billions == null) throw new Error("NBIM: failed to parse billions");
    const nok = Math.round(billions * 1e9);
    if (!Number.isFinite(nok) || nok <= 0) throw new Error("NBIM: NOK parsed invalid");
    return nok;
}

/** ---------- SSB PXWeb ---------- */
/**
 * We query StatBank (PXWeb) table 11342 (Population & area),
 * filtered to "Hele landet" latest period, variable "Befolkning per 1.1.".
 * API v1 (PXWeb) uses POST JSON to the table endpoint.
 *
 * Docs: https://www.ssb.no/en/api/statbank-pxwebapi-user-guide
 * Table: https://www.ssb.no/en/statbank/table/11342
 */
async function fetchPopulation(): Promise<number> {
    // The PXWeb v1 base for StatBank Norway:
    const url = "https://api.statbank.no:443/statbank-api/en/table/11342";
    // Region code for "Whole country" is typically "00". Contents key name varies by table.
    // We ask for the latest time automatically by using "Top" filter if available.
    const body = {
        query: [
            { code: "Region", selection: { filter: "item", values: ["00"] } },
            // "Contents" sometimes called "Contents"; value name depends on table metadata.
            // For 11342 it should be population count; we'll request all and pick the first numeric.
            { code: "Contents", selection: { filter: "item", values: [] as string[] } },
            // Prefer latest year:
            { code: "year", selection: { filter: "top", values: ["1"] } }
        ],
        response: { format: "JSON" }
    };

    // First, get metadata to find the correct Contents value id for population
    const metaRes = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
    if (!metaRes.ok) throw new Error(`SSB meta HTTP ${metaRes.status}`);
    const meta = await metaRes.json() as any;
    const contentsVar = (meta.variables || meta.variables || []).find((v: any) =>
        /contents/i.test(v.code)
    );
    if (!contentsVar) throw new Error("SSB: could not find Contents variable");
    // Find a value that looks like population persons
    const popValue =
        contentsVar["values"].find((x: string) => /population|persons|befolk/i.test(x)) ??
        contentsVar["values"][0];
    (body.query[1] as any).selection.values = [popValue];

    const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`SSB HTTP ${resp.status}`);
    const data = await resp.json() as any;

    // PXWeb JSON: { data: [ { key: [...], values: ["5592370"] }, ... ] }
    const cell = data?.data?.[0]?.values?.[0];
    const n = parseInt(String(cell).replace(/\s/g, ""), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error("SSB: invalid population");
    return n;
}

/** ---------- Main ---------- */
async function main() {
    const ts = new Date().toISOString();

    // Fetch sources (do NBIM first; SSB rarely changes)
    const [fund_nok, pop] = await Promise.all([
        fetchFundValueNOK(),
        fetchPopulation()
    ]);
    const per_capita_nok = fund_nok / pop;

    const nextRow: Row = {
        ts,
        fund_nok,
        pop,
        per_capita_nok: Math.round(per_capita_nok)
    };

    const series = readSeries();
    const last = series[series.length - 1];

    // de-dup: append only if value changed by at least 0.01% or last point older than 6 hours
    const changed =
        !last ||
        Math.abs((nextRow.per_capita_nok - last.per_capita_nok) / last.per_capita_nok) > 0.0001 ||
        (Date.now() - Date.parse(last.ts)) > 6 * 3600_000;

    if (changed) {
        series.push(nextRow);
        writeSeries(series);
        console.log("Appended:", nextRow);
    } else {
        console.log("No material change; not appending.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

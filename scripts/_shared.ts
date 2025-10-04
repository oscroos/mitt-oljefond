// scripts/_shared.ts
import fs from "node:fs";
import path from "node:path";

export const H = {
    "user-agent": "olje-per-nordmann/1.2 (+github actions; scraping nbim.no & ssb.no)",
    "accept-language": "nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7"
};

export const DATA_DIR = path.join(process.cwd(), "data");
export const FUND_PATH = path.join(DATA_DIR, "fund_timeseries.json");
export const POP_PATH = path.join(DATA_DIR, "pop_daily.json");
export const PER_CAP_PATH = path.join(DATA_DIR, "olje_per_capita.json");
export const USDNOK_PATH = path.join(process.cwd(), "data", "usd_nok.json");

export type FxRow = { date: string; source: "ExchangeRate-API"; usdnok: number };

export function readJsonArray<T>(p: string): T[] {
    if (!fs.existsSync(p)) return [];
    try {
        const raw = fs.readFileSync(p, "utf8");
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

export function writeJsonArray<T>(p: string, rows: T[]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 2) + "\n", "utf8");
}

// Loose number parser: accepts 20 367, 19,586, 19.586, etc.
export function parseNumberLike(text: string): number | null {
    const t = text
        .replace(/\u00A0/g, " ") // nbsp
        .replace(/[^0-9,\.\s]/g, "")
        .trim();
    const noSpace = t.replace(/\s+/g, "");
    const normalized = noSpace.includes(",") && !noSpace.includes(".")
        ? noSpace.replace(",", ".")
        : noSpace;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
}

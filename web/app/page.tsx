// web/app/page.tsx
"use client";

import series from "../../data/olje_per_capita.json";
import usdSeries from "../../data/usd_nok.json";
import nbMsgs from "../app/messages/nb.json";
import enMsgs from "../app/messages/en.json";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";
import { useEffect, useMemo, useState } from "react";

type Row = { ts: string; fund_nok: number; pop: number; per_capita_nok: number };
type FxRow = { date: string; usdnok: number; source?: string };
type Currency = "NOK" | "USD";
type Lang = "nb" | "en";

/** ---------- i18n helpers ---------- */
const MESSAGES: Record<Lang, Record<string, string>> = {
    nb: nbMsgs as Record<string, string>,
    en: enMsgs as Record<string, string>,
};

function interpolate(str: string, vars?: Record<string, string | number>) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function useI18n() {
    const [lang, setLang] = useState<Lang>("nb");
    const locale = lang === "nb" ? "nb-NO" : "en-GB";

    useEffect(() => {
        const saved = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
        if (saved === "nb" || saved === "en") setLang(saved);
    }, []);

    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem("lang", lang);
            document.documentElement.lang = lang;
        }
    }, [lang]);

    const t = (key: string, vars?: Record<string, string | number>) =>
        interpolate(MESSAGES[lang]?.[key] ?? key, vars);

    return { lang, setLang, locale, t };
}

/** ---------- Formatters ---------- */
// Helper: group integer with locale-specific thousands separator
function formatGrouped(n: number, locale: string) {
    const sep = locale.startsWith("nb") ? " " : ",";
    const rounded = Math.round(n);
    const absStr = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return rounded < 0 ? `-${absStr}` : absStr;
}

// NOK shown as "... NOK" with correct grouping
function fmtNOK(n: number, locale: string) {
    return `${formatGrouped(n, locale)} NOK`;
}

// USD shown as "... USD" with correct grouping
function fmtUSD(n: number, locale: string) {
    return `${formatGrouped(n, locale)} USD`;
}

// Plain integer (e.g., population) with locale-specific grouping
function fmtInt(n: number, locale: string) {
    return formatGrouped(n, locale);
}

// Percent keeps locale decimals but no change requested
function fmtPct(p: number, locale: string) {
    const s = p >= 0 ? "+" : "";
    return s + new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(p) + " %";
}

/** ---------- Reference row lookup ---------- */
function getRefRow(rows: Row[], targetMsAgo: number, toleranceMs: number): Row | null {
    const latestTs = new Date(rows[rows.length - 1].ts).getTime();
    const targetTs = latestTs - targetMsAgo;
    for (let i = rows.length - 1; i >= 0; i--) {
        const t = new Date(rows[i].ts).getTime();
        if (t <= targetTs) {
            if (targetTs - t <= toleranceMs) return rows[i];
            return null;
        }
    }
    return null;
}

/** ---------- FX helpers: historical, backfilled ---------- */
type FxIndex = { datesMs: number[]; rates: number[]; lastDateMs?: number; lastRate?: number };

function buildFxIndex(fxRows: FxRow[], envFallback: number): FxIndex {
    const clean = fxRows
        .filter((r) => typeof r.usdnok === "number" && r.usdnok > 0 && r.date)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (clean.length === 0) return { datesMs: [], rates: [], lastRate: envFallback };
    const datesMs = clean.map((r) => new Date(r.date).getTime());
    const rates = clean.map((r) => r.usdnok);
    return {
        datesMs,
        rates,
        lastDateMs: datesMs[datesMs.length - 1],
        lastRate: rates[rates.length - 1],
    };
}
function findFxIdxAtOrBefore(tsMs: number, idx: FxIndex): number {
    const { datesMs } = idx;
    if (datesMs.length === 0) return -1;
    let lo = 0,
        hi = datesMs.length - 1,
        ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (datesMs[mid] <= tsMs) {
            ans = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return ans;
}
function getUsdNokAt(tsMs: number, idx: FxIndex, envFallback: number): number {
    const i = findFxIdxAtOrBefore(tsMs, idx);
    if (i >= 0) return idx.rates[i];
    return envFallback;
}
function toCurrencyAt(nok: number, cur: Currency, tsMs: number, idx: FxIndex, envFallback: number) {
    if (cur === "NOK") return nok;
    const rate = getUsdNokAt(tsMs, idx, envFallback);
    return nok / rate;
}

// Currency wrappers
function fmtCur(n: number, cur: Currency, locale: string) {
    return cur === "NOK" ? fmtNOK(n, locale) : fmtUSD(n, locale);
}
function fmtDeltaCur(d: number, cur: Currency, locale: string) {
    const sign = d > 0 ? "+" : "";
    const v = Math.round(d);
    return `${sign}${fmtCur(v, cur, locale)}`;
}

function computeChangeCurrency(
    rows: Row[],
    latest: Row | undefined,
    windowMs: number,
    toleranceMs: number,
    cur: Currency,
    fxIdx: FxIndex,
    envFallback: number
) {
    if (!latest || rows.length < 2) return null;
    const ref = getRefRow(rows, windowMs, toleranceMs);
    if (!ref) return null;

    const latestMs = new Date(latest.ts).getTime();
    const refMs = new Date(ref.ts).getTime();

    const latestPer = toCurrencyAt(latest.per_capita_nok, cur, latestMs, fxIdx, envFallback);
    const refPer = toCurrencyAt(ref.per_capita_nok, cur, refMs, fxIdx, envFallback);

    const d = latestPer - refPer;
    const dPct = (d / refPer) * 100;
    return { dNok: d, dPct, since: ref.ts };
}

/** ---------- Component ---------- */
export default function Page() {
    const { lang, setLang, locale, t } = useI18n();

    const rows = (series as Row[]).slice().sort((a, b) => a.ts.localeCompare(b.ts));
    const latest = rows[rows.length - 1];

    // currency state (+ remember choice)
    const [cur, setCur] = useState<Currency>("NOK");
    useEffect(() => {
        const saved = typeof window !== "undefined" ? localStorage.getItem("currency") : null;
        if (saved === "NOK" || saved === "USD") return setCur(saved);
        const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
        if (host.includes("norwegianoilfundvalue.com")) setCur("USD");
        else if (host.includes("mitt-oljefond.no")) setCur("NOK");
    }, []);
    useEffect(() => {
        if (typeof window !== "undefined") localStorage.setItem("currency", cur);
    }, [cur]);

    // FX index
    const envFallback = Number(process.env.NEXT_PUBLIC_USD_NOK ?? 10);
    const fxIdx = useMemo(
        () => buildFxIndex((usdSeries as FxRow[]) ?? [], envFallback),
        [usdSeries, envFallback]
    );

    // Pre-compute display values using HISTORICAL USDNOK (per timestamp)
    const latestPer =
        latest ? toCurrencyAt(latest.per_capita_nok, cur, new Date(latest.ts).getTime(), fxIdx, envFallback) : null;
    const latestFund =
        latest ? toCurrencyAt(latest.fund_nok, cur, new Date(latest.ts).getTime(), fxIdx, envFallback) : null;

    // Changes: 15 min, 60 min, 24 h — each uses its own historical FX
    const C15 = computeChangeCurrency(rows, latest, 15 * 60_000, 30 * 60_000, cur, fxIdx, envFallback);
    const C60 = computeChangeCurrency(rows, latest, 60 * 60_000, 90 * 60_000, cur, fxIdx, envFallback);
    const C24 = computeChangeCurrency(rows, latest, 24 * 60 * 60_000, 6 * 60 * 60_000, cur, fxIdx, envFallback);

    // Chart data
    const chartRows = useMemo(
        () =>
            rows.map((r) => {
                const t = new Date(r.ts).getTime();
                return { ts: r.ts, per_capita: toCurrencyAt(r.per_capita_nok, cur, t, fxIdx, envFallback) };
            }),
        [rows, cur, fxIdx, envFallback]
    );

    // Footer: show last FX point
    const latestFxText = useMemo(() => {
        if (fxIdx.lastDateMs && fxIdx.lastRate) {
            return {
                date: new Date(fxIdx.lastDateMs).toLocaleDateString(locale),
                rate: new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(fxIdx.lastRate),
            };
        }
        return null;
    }, [fxIdx, locale]);

    return (
        <main className="wrap">
            <div className="container">
                <header className="header">
                    <h1>{t("title")}</h1>
                    <div className="rightHeader">
                        <CurrencyToggle value={cur} onChange={setCur} />
                        <LangButton value={lang} onToggle={() => setLang(lang === "nb" ? "en" : "nb")} />
                    </div>
                </header>

                <section className="hero">
                    <div className="heroValue">{latestPer != null ? fmtCur(latestPer, cur, locale) : "—"}</div>
                    <div className="changes">
                        <ChangePill label={t("last15")} change={C15} cur={cur} locale={locale} />
                        <ChangePill label={t("lastHour")} change={C60} cur={cur} locale={locale} />
                        <ChangePill label={t("last24h")} change={C24} cur={cur} locale={locale} />
                    </div>
                </section>

                <section className="cards">
                    <Card title={t("card.perCap")}>{latestPer != null ? fmtCur(latestPer, cur, locale) : "—"}</Card>
                    <Card title={t("card.totalFund")}>{latestFund != null ? fmtCur(latestFund, cur, locale) : "—"}</Card>
                    <Card title={t("card.population")}>{latest ? fmtInt(latest.pop, locale) : "—"}</Card>
                </section>

                <section className="chart">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartRows} margin={{ top: 30, right: 16, left: 32, bottom: 0 }}>
                            <defs>
                                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopOpacity={0.35} />
                                    <stop offset="100%" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis
                                dataKey="ts"
                                tickFormatter={(v) =>
                                    new Date(v).toLocaleDateString(locale, { month: "2-digit", day: "2-digit" })
                                }
                            />
                            <YAxis width={110} tickMargin={8} tickFormatter={(v) => fmtCur(Number(v), cur, locale)} />
                            <Tooltip
                                formatter={(value: any, name: string) => {
                                    if (name === "per_capita") return [fmtCur(Number(value), cur, locale), t("perPerson")];
                                    return value;
                                }}
                                labelFormatter={(label) => new Date(label).toLocaleString(locale)}
                            />
                            <Area type="monotone" dataKey="per_capita" strokeWidth={2} fill="url(#g)" dot={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </section>

                <footer className="foot">
                    {/* moved here from header: Updated time */}
                    <div className="footUpdated">
                        {latest ? (
                            <>
                                {t("updated")}:{" "}
                                {new Date(latest.ts).toLocaleString(locale, {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "2-digit",
                                })}
                            </>
                        ) : (
                            "—"
                        )}
                    </div>

                    {/* Sources line */}
                    <div>
                        {t("footer.sources")}
                        {cur === "USD" && latestFxText ? <> ({t("footer.lastFx", { rate: latestFxText.rate })})</> : null}
                    </div>
                </footer>
            </div>

            {/* minimal CSS for the modern look */}
            <style jsx>{`
        .wrap {
          min-height: 100vh;
          background: radial-gradient(1200px 600px at 20% -10%, #dbeafe 0%, rgba(219, 234, 254, 0) 60%),
            radial-gradient(1200px 600px at 100% 0%, #ede9fe 0%, rgba(237, 233, 254, 0) 60%),
            linear-gradient(180deg, #f8fafc 0%, #ffffff 60%);
          padding: 24px 16px 48px;
        }
        .container {
          max-width: 1100px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
        }
        h1 {
          margin: 0;
          font-size: clamp(22px, 3vw, 32px);
          letter-spacing: -0.01em;
        }
        .rightHeader {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .hero {
          margin: 12px 0 18px;
          display: grid;
          gap: 12px;
        }
        .heroValue {
          font-size: clamp(36px, 6vw, 64px);
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.05;
          padding: 16px 20px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: saturate(140%) blur(6px);
          box-shadow: 0 10px 30px rgba(31, 41, 55, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
        }
        .changes {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-top: 10px;
        }
        .card {
          padding: 16px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: saturate(140%) blur(6px);
          box-shadow: 0 10px 30px rgba(31, 41, 55, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
        }
        .cardTitle {
          font-size: 12px;
          color: #514337ff;
          font-weight: 700;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .cardValue {
          font-size: 22px;
          font-weight: 700;
        }

        .chart {
          height: clamp(280px, 45vh, 460px);
          margin-top: 22px;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 10px 30px rgba(31, 41, 55, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
          padding: 8px 12px 12px;
        }

        .foot {
          margin-top: 14px;
          color: #6b7280;
          font-size: 14px;
        }
        .footUpdated {
          margin-bottom: 4px;
        }

        @media (max-width: 720px) {
          .cards,
          .changes {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
        </main>
    );
}

/** ---------- Small presentational components ---------- */
function ChangePill({
    label,
    change,
    cur,
    locale,
}: {
    label: string;
    change: { dNok: number; dPct: number; since: string } | null;
    cur: Currency;
    locale: string;
}) {
    const up = change ? change.dNok >= 0 : null;
    return (
        <div className="pill">
            <div className="pillLabel">{label}</div>
            <div className={`pillValue ${up === null ? "" : up ? "up" : "down"}`}>
                {change ? (
                    <>
                        <span className="arrow">{up ? "▲" : "▼"}</span>
                        <span>{fmtDeltaCur(change.dNok, cur, locale)}</span>
                        <span className="muted">({fmtPct(change.dPct, locale)})</span>
                    </>
                ) : (
                    "—"
                )}
            </div>
            <style jsx>{`
        .pill {
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(15, 23, 42, 0.08);
          box-shadow: 0 8px 24px rgba(31, 41, 55, 0.05);
        }
        .pillLabel {
          font-size: 12px;
          color: #6b7280;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .pillValue {
          font-weight: 700;
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 16px;
        }
        .pillValue.up {
          color: #065f46;
        }
        .pillValue.down {
          color: #991b1b;
        }
        .arrow {
          font-size: 14px;
          opacity: 0.9;
        }
        .muted {
          color: #6b7280;
          font-weight: 600;
        }
      `}</style>
        </div>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="card">
            <div className="cardTitle">{title}</div>
            <div className="cardValue">{children}</div>

            {/* Scoped styles for Card to avoid being overridden */}
            <style jsx>{`
        .cardTitle {
          font-size: 15px;
          color: #374151;
          font-weight: 400;
          margin-bottom: 2px;
          margin-left: 4px;
          text-transform: none;
        }
          .cardValue {
          font-size: 20px;
          font-weight: 700;
          margin-left: 4px;
        }
      `}</style>
        </div>
    );
}

function CurrencyToggle({
    value,
    onChange,
}: {
    value: Currency;
    onChange: (c: Currency) => void;
}) {
    return (
        <>
            <div className="toggle" role="group" aria-label="Valuta">
                <button className={`btn ${value === "NOK" ? "active" : ""}`} onClick={() => onChange("NOK")}>
                    NOK
                </button>
                <button className={`btn ${value === "USD" ? "active" : ""}`} onClick={() => onChange("USD")}>
                    USD
                </button>
            </div>
            <style jsx>{`
        .toggle {
          display: inline-flex;
          background: #fff;
          border: 1px solid rgba(15, 23, 42, 0.12);
          border-radius: 9999px;
          padding: 2px;
          box-shadow: 0 6px 16px rgba(31, 41, 55, 0.06);
        }
        .btn {
          appearance: none;
          border: 0;
          background: transparent;
          padding: 6px 12px;
          border-radius: 9999px;
          font-weight: 700;
          font-size: 14px;
          color: #374151;
          cursor: pointer;
        }
        .btn.active {
          background: #4f46e5;
          color: white;
        }
      `}</style>
        </>
    );
}

/** New: single-button language toggle that swaps flag + lang */
function LangButton({
    value,
    onToggle,
}: {
    value: Lang;         // current language: "nb" | "en"
    onToggle: () => void; // should switch to the other language
}) {
    // Show the flag for the *other* language (the one you'll switch to)
    const target: Lang = value === "nb" ? "en" : "nb";

    const FLAG_SRC: Record<Lang, string> = {
        nb: "/flags/no.png",
        en: "/flags/gb.png",
    };

    // Accessible label/tooltip in the *current* language
    const label = value === "nb" ? "Switch to English" : "Bytt til norsk";

    return (
        <>
            <button
                className="flagBtn"
                onClick={onToggle}
                aria-label={label}
                title={label}
            >
                <img
                    src={FLAG_SRC[target]}   // show the target language flag
                    alt={label}
                    width={22}
                    height={22}
                    style={{ display: "block" }}
                    loading="eager"
                />
            </button>

            <style jsx>{`
        .flagBtn {
          appearance: none;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: #fff;
          padding: 6px;
          border-radius: 9999px;
          cursor: pointer;
          line-height: 0;
          box-shadow: 0 6px 16px rgba(31, 41, 55, 0.06);
          transition: transform 0.06s ease, box-shadow 0.2s ease;
        }
        .flagBtn:active {
          transform: translateY(1px);
        }
      `}</style>
        </>
    );
}

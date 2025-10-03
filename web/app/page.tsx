"use client";

import series from "../../data/olje_per_capita.json";
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
type Currency = "NOK" | "USD";

const USDNOK = Number(process.env.NEXT_PUBLIC_USD_NOK ?? 10); // 1 USD = X NOK (fallback)

function fmtNOK(n: number) {
    return new Intl.NumberFormat("nb-NO", {
        style: "currency",
        currency: "NOK",
        maximumFractionDigits: 0,
    }).format(n);
}
function fmtUSD(n: number) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(n);
}
function fmtInt(n: number) {
    return new Intl.NumberFormat("nb-NO").format(n);
}
function fmtPct(p: number) {
    return (
        (p >= 0 ? "+" : "") +
        new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(p) +
        " %"
    );
}

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

// --- Currency helpers ---
function toCurrency(nok: number, cur: Currency) {
    return cur === "NOK" ? nok : nok / USDNOK;
}
function fmtCur(n: number, cur: Currency) {
    return cur === "NOK" ? fmtNOK(n) : fmtUSD(n);
}
function fmtDeltaCur(d: number, cur: Currency) {
    const sign = d > 0 ? "+" : "";
    const v = Math.round(d);
    return `${sign}${fmtCur(v, cur)}`;
}

// Computes change for a given currency by converting NOK snapshots first
function computeChangeCurrency(
    rows: Row[],
    latest: Row | undefined,
    windowMs: number,
    toleranceMs: number,
    cur: Currency
) {
    if (!latest || rows.length < 2) return null;
    const ref = getRefRow(rows, windowMs, toleranceMs);
    if (!ref) return null;

    const latestPer = toCurrency(latest.per_capita_nok, cur);
    const refPer = toCurrency(ref.per_capita_nok, cur);
    const d = latestPer - refPer;
    const dPct = (d / refPer) * 100;
    return { dNok: d, dPct, since: ref.ts };
}

export default function Page() {
    const rows = (series as Row[]).slice().sort((a, b) => a.ts.localeCompare(b.ts));
    const latest = rows[rows.length - 1];

    // currency state (+ remember choice)
    const [cur, setCur] = useState<Currency>("NOK");

    useEffect(() => {
        // 1) If user has a stored choice, use it
        const saved = typeof window !== "undefined" ? localStorage.getItem("currency") : null;
        if (saved === "NOK" || saved === "USD") return setCur(saved);

        // 2) Otherwise pick default by hostname
        const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
        if (host.includes("norwegianoilfundvalue.com")) setCur("USD");
        else if (host.includes("mitt-oljefond.no")) setCur("NOK");
    }, []);

    useEffect(() => {
        if (typeof window !== "undefined") localStorage.setItem("currency", cur);
    }, [cur]);

    // Pre-compute currency-adjusted values for display & chart
    const latestPer = latest ? toCurrency(latest.per_capita_nok, cur) : null;
    const latestFund = latest ? toCurrency(latest.fund_nok, cur) : null;

    // Changes: 15 min, 60 min, 24 h (same tolerances as before)
    const C15 = computeChangeCurrency(rows, latest, 15 * 60_000, 30 * 60_000, cur);
    const C60 = computeChangeCurrency(rows, latest, 60 * 60_000, 90 * 60_000, cur);
    const C24 = computeChangeCurrency(rows, latest, 24 * 60 * 60_000, 6 * 60 * 60_000, cur);

    // Chart data in selected currency
    const chartRows = useMemo(
        () =>
            rows.map((r) => ({
                ts: r.ts,
                per_capita: toCurrency(r.per_capita_nok, cur),
            })),
        [rows, cur]
    );

    return (
        <main className="wrap">
            <div className="container">
                <header className="header">
                    <h1>Oljefondet per nordmann</h1>
                    <div className="rightHeader">
                        <CurrencyToggle value={cur} onChange={setCur} />
                        <div className="updated">
                            {latest ? (
                                <>
                                    Oppdatert:{" "}
                                    {new Date(latest.ts).toLocaleString("nb-NO", {
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
                    </div>
                </header>

                <section className="hero">
                    <div className="heroValue">{latestPer != null ? fmtCur(latestPer, cur) : "—"}</div>
                    <div className="changes">
                        <ChangePill label="Siste 15 min" change={C15} cur={cur} />
                        <ChangePill label="Siste time" change={C60} cur={cur} />
                        <ChangePill label="Siste 24 t" change={C24} cur={cur} />
                    </div>
                </section>

                <section className="cards">
                    <Card title="Verdi per nordmann">
                        {latestPer != null ? fmtCur(latestPer, cur) : "—"}
                    </Card>
                    <Card title="Oljefondets totale verdi">
                        {latestFund != null ? fmtCur(latestFund, cur) : "—"}
                    </Card>
                    <Card title="Norges befolkning">{latest ? fmtInt(latest.pop) : "—"}</Card>
                </section>

                <section className="chart">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartRows} margin={{ top: 30, right: 16, left: 32, bottom: 0 }}>
                            <defs>
                                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.35} />
                                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis
                                dataKey="ts"
                                tickFormatter={(v) =>
                                    new Date(v).toLocaleDateString("nb-NO", {
                                        month: "2-digit",
                                        day: "2-digit",
                                    })
                                }
                            />
                            <YAxis
                                width={110}
                                tickMargin={8}
                                tickFormatter={(v) => fmtCur(Number(v), cur)}
                            />
                            <Tooltip
                                formatter={(value: any, name: string) => {
                                    if (name === "per_capita") return [fmtCur(Number(value), cur), "Per person"];
                                    return value;
                                }}
                                labelFormatter={(label) => new Date(label).toLocaleString("nb-NO")}
                            />
                            <Area
                                type="monotone"
                                dataKey="per_capita"
                                stroke="#4F46E5"
                                strokeWidth={2}
                                fill="url(#g)"
                                dot={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </section>

                <footer className="foot">
                    Kilder: NBIM (fondets verdi) og SSB (befolkning). Oppdateres hvert 15. minutt.
                    {cur === "USD" ? (
                        <>
                            {" "}
                            (Kurs brukt: 1 USD = {new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 4 }).format(USDNOK)} NOK)
                        </>
                    ) : null}
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
        .container { max-width: 1100px; margin: 0 auto; }
        .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
        }
        h1 { margin: 0; font-size: clamp(22px, 3vw, 32px); letter-spacing: -0.01em; }
        .rightHeader { display: flex; gap: 12px; align-items: center; }
        .updated { color: #6b7280; font-size: 14px; }

        .hero { margin: 12px 0 18px; display: grid; gap: 12px; }
        .heroValue {
          font-size: clamp(36px, 6vw, 64px);
          font-weight: 800; letter-spacing: -0.02em; line-height: 1.05;
          padding: 16px 20px; border-radius: 16px;
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: saturate(140%) blur(6px);
          box-shadow: 0 10px 30px rgba(31, 41, 55, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
        }
        .changes {
          display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;
        }

        .cards {
          display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 10px;
        }
        .card {
          padding: 16px; border-radius: 16px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: saturate(140%) blur(6px);
          box-shadow: 0 10px 30px rgba(31, 41, 55, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
        }
        .cardTitle {
          font-size: 12px;
          color: #374151;       /* darker */
          font-weight: 700;     /* BOLD as requested */
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .cardValue { font-size: 22px; font-weight: 700; }

        .chart {
          height: clamp(280px, 45vh, 460px);
          margin-top: 22px;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 10px 30px rgba(31, 41, 55, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
          padding: 8px 12px 12px;
        }

        .foot { margin-top: 14px; color: #6b7280; font-size: 14px; }
        @media (max-width: 720px) { .cards, .changes { grid-template-columns: 1fr; } }
      `}</style>
        </main>
    );
}

function ChangePill({
    label,
    change,
    cur,
}: {
    label: string;
    change: { dNok: number; dPct: number; since: string } | null;
    cur: Currency;
}) {
    const up = change ? change.dNok >= 0 : null;
    return (
        <div className="pill">
            <div className="pillLabel">{label}</div>
            <div className={`pillValue ${up === null ? "" : up ? "up" : "down"}`}>
                {change ? (
                    <>
                        <span className="arrow">{up ? "▲" : "▼"}</span>
                        <span>{fmtDeltaCur(change.dNok, cur)}</span>
                        <span className="muted">({fmtPct(change.dPct)})</span>
                    </>
                ) : (
                    "—"
                )}
            </div>
            <style jsx>{`
        .pill {
          padding: 12px 14px; border-radius: 12px;
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(15, 23, 42, 0.08);
          box-shadow: 0 8px 24px rgba(31, 41, 55, 0.05);
        }
        .pillLabel {
          font-size: 12px; color: #6b7280; margin-bottom: 6px;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .pillValue { font-weight: 700; display: flex; align-items: baseline; gap: 8px; font-size: 16px; }
        .pillValue.up { color: #065f46; }
        .pillValue.down { color: #991b1b; }
        .arrow { font-size: 14px; opacity: 0.9; }
        .muted { color: #6b7280; font-weight: 600; }
      `}</style>
        </div>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="card">
            <div className="cardTitle">{title}</div>
            <div className="cardValue">{children}</div>
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
                <button
                    className={`btn ${value === "NOK" ? "active" : ""}`}
                    onClick={() => onChange("NOK")}
                >
                    NOK
                </button>
                <button
                    className={`btn ${value === "USD" ? "active" : ""}`}
                    onClick={() => onChange("USD")}
                >
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

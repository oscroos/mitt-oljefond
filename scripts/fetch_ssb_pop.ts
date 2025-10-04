// scripts/fetch_ssb_pop.ts
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import {
    H, POP_PATH, readJsonArray, writeJsonArray, parseNumberLike,
    USDNOK_PATH, type FxRow
} from "./_shared.js";

type PopRow = { date: string; pop: number };

// Scrape front page; mirrors your logic but focused on the single daily value
async function fetchPopulationFromHomepage(): Promise<number> {
    const url = "https://www.ssb.no/";
    const html = await (await fetch(url, { headers: H })).text();
    let $ = cheerio.load(html);

    const exactText =
        $('a.keyfigure-wrapper:has(.link-text:contains("Befolkning")) span.number')
            .first()
            .text()
            .trim();

    let pop = parseNumberLike(exactText);
    if (pop != null && pop > 4_000_000 && pop < 10_000_000) {
        return Math.round(pop);
    }

    const altText =
        $('.keyfigure:has(.link-text:contains("Befolkning")) span.number')
            .first()
            .text()
            .trim();
    pop = parseNumberLike(altText);
    if (pop != null && pop > 4_000_000 && pop < 7_000_000) {
        return Math.round(pop);
    }

    // Fallback English
    const urlEn = "https://www.ssb.no/en";
    const htmlEn = await (await fetch(urlEn, { headers: H })).text();
    $ = cheerio.load(htmlEn);
    const whole = $("body").text().replace(/\s+/g, " ");
    const m = whole.match(/([0-9\s.,]{6,})\s+(population|inhabitants)/i);
    if (m) {
        const maybe = parseNumberLike(m[1]);
        if (maybe && maybe > 4_000_000 && maybe < 7_000_000) {
            return Math.round(maybe);
        }
    }

    // Topic page fallback
    const topicUrl = "https://www.ssb.no/befolkning/folketall/statistikk/befolkning";
    const topicHtml = await (await fetch(topicUrl, { headers: H })).text();
    $ = cheerio.load(topicHtml);

    let best: number | null = null;
    $('[class*="key"], [class*="fact"], [class*="number"], h1, h2, h3, p, span, strong, div').each((_, el) => {
        const t = $(el).text().trim();
        const mm = t.match(/(\d[\d\s.,]{5,})/);
        if (!mm) return;
        const maybe = parseNumberLike(mm[1]);
        if (maybe && maybe > 4_000_000 && maybe < 7_000_000) {
            best = maybe;
            return false;
        }
    });

    if (best != null) return Math.round(best);

    throw new Error("SSB: fant ikke gyldig befolkningstall");
}

type ExchangeRateAPIResponse = {
    rates?: Record<string, number>;
    // (other fields exist, but we only care about rates)
};

function hasRates(x: unknown): x is { rates: Record<string, number> } {
    return !!x && typeof x === "object" && "rates" in x && typeof (x as any).rates === "object";
}

// Fetch USD→NOK from ExchangeRate-API (daily is fine)
async function fetchUSDNOK(): Promise<number> {
    // Two options:
    // 1) With API key (set EXCHANGERATE_API_KEY in env):
    //    https://v6.exchangerate-api.com/v6/<KEY>/latest/USD
    // 2) Open endpoint (no key; requires attribution):
    //    https://open.er-api.com/v6/latest/USD
    const KEY = process.env.EXCHANGERATE_API_KEY?.trim();
    const url = KEY
        ? `https://v6.exchangerate-api.com/v6/${KEY}/latest/USD`
        : `https://open.er-api.com/v6/latest/USD`;

    const res = await fetch(url, { headers: { ...H, Accept: "application/json" } });
    if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`);

    const data: unknown = await res.json(); // <-- unknown by design
    if (!hasRates(data)) throw new Error("ExchangeRate-API: payload missing rates");

    const rate = data.rates.NOK;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error("ExchangeRate-API: NOK rate missing/invalid");
    }
    return rate;
}

async function main() {
    // Use UTC calendar date, since Actions runs in UTC
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // --- (A) Population (idempotent once per day)
    const popSeries = readJsonArray<PopRow>(POP_PATH);
    if (popSeries.some(r => r.date === today)) {
        console.log(`Population for ${today} already recorded; skipping.`);
    } else {
        const pop = await fetchPopulationFromHomepage();
        popSeries.push({ date: today, pop });
        writeJsonArray(POP_PATH, popSeries);
        console.log("Population appended:", { date: today, pop });
    }

    // --- (B) USDNOK (idempotent once per day)
    const fxSeries = readJsonArray<FxRow>(USDNOK_PATH);
    if (fxSeries.some(r => r.date === today)) {
        console.log(`USDNOK for ${today} already recorded; skipping.`);
    } else {
        try {
            const usdnok = await fetchUSDNOK();
            fxSeries.push({ date: today, source: "ExchangeRate-API", usdnok: Number(usdnok.toFixed(6)) });
            writeJsonArray(USDNOK_PATH, fxSeries);
            console.log("USDNOK appended:", { date: today, usdnok });
        } catch (e) {
            console.warn("USDNOK fetch failed (non-fatal):", e);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

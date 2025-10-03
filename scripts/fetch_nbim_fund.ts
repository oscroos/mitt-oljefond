// scripts/fetch_nbim_fund.ts
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import {
    H, FUND_PATH, POP_PATH, PER_CAP_PATH,
    readJsonArray, writeJsonArray, parseNumberLike
} from "./_shared.js";

type FundRow = { ts: string; fund_nok: number };
type PopRow = { date: string; pop: number };
type PerCapRow = { ts: string; fund_nok: number; pop_date: string; pop: number; per_capita_nok: number };

// Try to read the live number off nbim.no (same logic you already had)
async function fetchFundValueNOK(): Promise<number> {
    const toInt = (s: string | null | undefined): number | null => {
        if (!s) return null;
        const digits = s.replace(/\D+/g, "");
        if (!digits) return null;
        const n = Number(digits);
        return Number.isFinite(n) && n > 0 ? n : null;
    };

    const tryHtml = async (url: string) => {
        const html = await (await fetch(url, { headers: H })).text();
        const $ = cheerio.load(html);

        let raw = $("#liveNavNumber .n").map((_, el) => $(el).text()).get().join("");
        let v = toInt(raw);
        if (v != null) return v;

        raw = $("#liveNavNumber").first().text();
        v = toInt(raw);
        if (v != null) return v;

        raw = $('[id*="liveNavNumber"], .live-number').first().text();
        v = toInt(raw);
        if (v != null) return v;

        return null;
    };

    for (const u of ["https://www.nbim.no/no/", "https://www.nbim.no/en/"]) {
        const v = await tryHtml(u);
        if (v != null) return v;
    }

    try {
        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.setUserAgent(H["user-agent"]);
        await page.setExtraHTTPHeaders({ "accept-language": H["accept-language"] });
        await page.goto("https://www.nbim.no/no/", { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#liveNavNumber .n", { timeout: 12000 });
        const raw = await page.$$eval("#liveNavNumber .n", els =>
            els.map(el => (el as HTMLElement).innerText || "").join("")
        );
        let v = raw && raw.trim()
            ? raw
            : await page.$eval("#liveNavNumber", el => (el as HTMLElement).innerText || "");
        await browser.close();
        const nok = toInt(v);
        if (nok != null) return nok;
    } catch {
        // swallow
    }

    // last-resort (rounded “milliarder kroner” page)
    const url = "https://www.nbim.no/no/investeringene/fondets-verdi/";
    const html = await (await fetch(url, { headers: H })).text();
    const $ = cheerio.load(html);
    const m = $("body").text().match(/([\d\s.,]+)\s+milliarder?\s+kroner/i);
    if (m) {
        const billions = parseNumberLike(m[1]);
        if (billions != null) {
            const exact = billions * 1e9;
            if (Number.isFinite(exact) && exact > 0) return exact;
        }
    }

    throw new Error("NBIM: NOK parsed invalid");
}

async function main() {
    const ts = new Date().toISOString();

    // 1) Append fund row
    const fund_nok = await fetchFundValueNOK();
    const fundSeries = readJsonArray<FundRow>(FUND_PATH);
    fundSeries.push({ ts, fund_nok });
    writeJsonArray(FUND_PATH, fundSeries);
    console.log("Fund appended:", { ts, fund_nok });

    // 2) Derive per-capita using latest known population (NO SSB CALL HERE)
    const popSeries = readJsonArray<PopRow>(POP_PATH);
    if (popSeries.length === 0) {
        console.warn("No population data yet; skipping per-capita append.");
        return;
    }
    const latestPop = popSeries.reduce((a, b) => (a.date > b.date ? a : b));
    const per_capita_nok = Math.round(fund_nok / latestPop.pop);
    const perSeries = readJsonArray<PerCapRow>(PER_CAP_PATH);
    perSeries.push({
        ts,
        fund_nok,
        pop_date: latestPop.date,
        pop: latestPop.pop,
        per_capita_nok
    });
    writeJsonArray(PER_CAP_PATH, perSeries);
    console.log("Per-capita appended:", { ts, per_capita_nok, pop_date: latestPop.date });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

// scripts/fetch_ssb_pop.ts
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { H, POP_PATH, readJsonArray, writeJsonArray, parseNumberLike } from "./_shared";

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

async function main() {
    // Use UTC calendar date, since Actions runs in UTC
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const series = readJsonArray<PopRow>(POP_PATH);

    // If we already have today's date, do nothing (idempotent daily run)
    if (series.some(r => r.date === today)) {
        console.log(`Population for ${today} already recorded; skipping.`);
        return;
    }

    const pop = await fetchPopulationFromHomepage();
    series.push({ date: today, pop });
    writeJsonArray(POP_PATH, series);
    console.log("Population appended:", { date: today, pop });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

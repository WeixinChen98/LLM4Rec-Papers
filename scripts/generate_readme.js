#!/usr/bin/env node
/**
 * Generate README.md for the LLM4Rec-Papers repo from the live data feed
 * powering https://weixinchen.com/llm4rec_papers.
 *
 * Organization (per project decision, see repo README intro):
 *   - Grouped by Topic (Generative Recommendation / Agentic Recommendation /
 *     Other LLM4Rec), then by Sub-topic within each Topic (same taxonomy as
 *     the live site, grounded in published surveys — see classifySubTopic()).
 *   - Within each (Topic, Sub-topic), split into (Preprints shown first —
 *     they're the most up-to-date and the main thing this list tracks day
 *     to day; Publications is the stable, long-lived record):
 *       - "Recent Preprints" — not yet matched to a published venue, within
 *         PREPRINT_WINDOW_DAYS (default 365 days / ~1 year, matching the
 *         "Within a year" option already offered on the live site). Sorted
 *         by recency (desc). Older preprints are dropped from this list
 *         entirely to keep it from growing forever — they remain visible on
 *         the live site regardless.
 *       - "Publications" — matched to a published venue, sorted by citation
 *         count (desc), then recency.
 *
 * Usage: node scripts/generate_readme.js
 * (no deps beyond Node's built-in fetch, available in Node 18+)
 */

const DATA_SOURCE_URL = 'https://weixinchen.com/api/hub-updates';
const LIVE_SITE_URL = 'https://weixinchen.com/llm4rec_papers';
const PREPRINT_WINDOW_DAYS = 365;

const CATEGORY_META = {
    generative: { label: 'Generative Recommendation', emoji: '🧬' },
    agentic: { label: 'Agentic Recommendation', emoji: '🤖' },
    other: { label: 'Other LLM4Rec', emoji: '📎' }
};

// Sub-topic taxonomy — must stay in sync with classifySubTopic() in
// weixinchen.com/llm4rec_papers.html. Grounded in:
//   - Agentic: arXiv:2502.10050 "A Survey on LLM-powered Agents for
//     Recommender Systems" (Recommender-/Interaction-/Simulation-oriented)
//   - Generative: common methodology split used across generative-rec
//     surveys (LLM-as-Recommender / Semantic ID & Generative Retrieval /
//     Generative Sequence Modeling)
const SUBTOPIC_ORDER = {
    generative: ['LLM-as-Recommender', 'Semantic ID & Generative Retrieval', 'Generative Sequence Modeling', 'General'],
    agentic: ['Recommender-oriented', 'Interaction-oriented', 'Simulation-oriented', 'General'],
    other: ['General']
};

const KNOWN_VENUE_SHORT_LABELS = {
    SIGIR: 'SIGIR', WWW: 'WWW', RecSys: 'RecSys', KDD: 'KDD', CIKM: 'CIKM', WSDM: 'WSDM',
    ACL: 'ACL', EMNLP: 'EMNLP', NeurIPS: 'NeurIPS', ICML: 'ICML', ICLR: 'ICLR',
    TKDE: 'TKDE', TORS: 'TORS', TOIS: 'TOIS', AAAI: 'AAAI'
};

function classifySubTopic(category, title, abstract) {
    const text = `${title || ''} ${abstract || ''}`.toLowerCase();

    if (category === 'generative') {
        if (text.includes('semantic id') || text.includes('rq-vae') || text.includes('generative retrieval') || text.includes('tokeniz')) {
            return 'Semantic ID & Generative Retrieval';
        }
        if (text.includes('transducer') || text.includes('sequential') || text.includes('autoregressive') || text.includes('sequence model')) {
            return 'Generative Sequence Modeling';
        }
        if (text.includes('prompt') || text.includes('text-to-text') || text.includes('language model') || text.includes('llm')) {
            return 'LLM-as-Recommender';
        }
        return 'General';
    }

    if (category === 'agentic') {
        if (text.includes('simulat') || text.includes('user behavior') || text.includes('social') || text.includes('digital twin')) {
            return 'Simulation-oriented';
        }
        if (text.includes('conversat') || text.includes('dialog') || text.includes('chat') || text.includes('interact')) {
            return 'Interaction-oriented';
        }
        if (text.includes('agent') || text.includes('tool') || text.includes('plan') || text.includes('memory') || text.includes('reasoning')) {
            return 'Recommender-oriented';
        }
        return 'General';
    }

    return 'General';
}

function formatAuthors(authorsStr) {
    const authors = (authorsStr || 'Unknown').split(',').map(a => a.trim()).filter(Boolean);
    if (authors.length === 0) return 'Unknown';
    if (authors.length <= 3) return authors.join(', ');
    return `${authors.slice(0, 3).join(', ')}, et al.`;
}

function formatVenue(paper) {
    if (!paper.isAccepted) return null;
    // Always prefer the short canonical tag (SIGIR/KDD/...) over the raw
    // comment text once we know it — raw text is either Semantic Scholar's
    // long official venue name (e.g. "Knowledge Discovery and Data Mining")
    // or a self-reported arXiv note; the short tag + year is strictly
    // cleaner for a list like this.
    const shortLabel = KNOWN_VENUE_SHORT_LABELS[paper.venueTag];
    if (shortLabel) {
        const year = paper.published ? new Date(paper.published).getFullYear() : '';
        return `${shortLabel}${year ? ' ' + year : ''}`;
    }
    return paper.comment || 'Accepted/Published';
}

function escapeMarkdown(text) {
    return (text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function renderEntry(paper) {
    const title = escapeMarkdown(paper.title);
    const authors = escapeMarkdown(formatAuthors(paper.authors));
    const dateStr = paper.published ? new Date(paper.published).toISOString().slice(0, 10) : '';
    const citationStr = typeof paper.citationCount === 'number' && paper.citationCount > 0
        ? ` · 📈 ${paper.citationCount.toLocaleString()} citation${paper.citationCount === 1 ? '' : 's'}`
        : '';

    if (paper.isAccepted) {
        const venue = formatVenue(paper);
        return `- **[${title}](${paper.link})** — ${authors} · ${venue}${citationStr}`;
    }
    return `- **[${title}](${paper.link})** — ${authors} · ${dateStr}${citationStr}`;
}

async function main() {
    console.log(`Fetching live data from ${DATA_SOURCE_URL} ...`);
    const response = await fetch(DATA_SOURCE_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch data: HTTP ${response.status}`);
    }
    const result = await response.json();
    const papers = (result.papers || []).map(paper => ({
        ...paper,
        subTopic: classifySubTopic(paper.category, paper.title, paper.abstract)
    }));

    console.log(`Loaded ${papers.length} papers.`);

    const now = Date.now();
    const preprintCutoff = now - PREPRINT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const sections = [];
    let totalPublished = 0;
    let totalRecentPreprints = 0;

    for (const categoryKey of Object.keys(CATEGORY_META)) {
        const { label, emoji } = CATEGORY_META[categoryKey];
        const categoryPapers = papers.filter(p => (p.category || 'other') === categoryKey);
        if (categoryPapers.length === 0) continue;

        let categoryMd = `<a id="${categoryKey}"></a>\n\n## ${emoji} ${label}\n\n`;
        let categoryHasContent = false;

        for (const subTopic of SUBTOPIC_ORDER[categoryKey]) {
            const subTopicPapers = categoryPapers.filter(p => p.subTopic === subTopic);
            if (subTopicPapers.length === 0) continue;

            const published = subTopicPapers
                .filter(p => p.isAccepted)
                .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0) || new Date(b.published) - new Date(a.published));

            const recentPreprints = subTopicPapers
                .filter(p => !p.isAccepted && new Date(p.published).getTime() >= preprintCutoff)
                .sort((a, b) => new Date(b.published) - new Date(a.published));

            if (published.length === 0 && recentPreprints.length === 0) continue;

            categoryHasContent = true;
            const subTopicHeading = subTopic === 'General' ? '' : `### ${subTopic}\n\n`;
            categoryMd += subTopicHeading;

            if (recentPreprints.length > 0) {
                categoryMd += `<details open><summary><strong>🆕 Recent Preprints (last ${Math.round(PREPRINT_WINDOW_DAYS / 365 * 12)} months) — ${recentPreprints.length}</strong></summary>\n\n`;
                categoryMd += recentPreprints.map(renderEntry).join('\n') + '\n\n';
                categoryMd += `</details>\n\n`;
                totalRecentPreprints += recentPreprints.length;
            }

            if (published.length > 0) {
                categoryMd += `<details open><summary><strong>📗 Publications — ${published.length}</strong></summary>\n\n`;
                categoryMd += published.map(renderEntry).join('\n') + '\n\n';
                categoryMd += `</details>\n\n`;
                totalPublished += published.length;
            }
        }

        if (categoryHasContent) sections.push(categoryMd);
    }

    // Display in Beijing time (Asia/Shanghai, UTC+8) for consistency with
    // the rest of the project (the live site's schedules, the GitHub Actions
    // cron comment, etc. are all reasoned about in Beijing time).
    const lastUpdated = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(new Date()).replace(' ', ' ') + ' Beijing Time';

    // shields.io badges, "for-the-badge" style for a bolder, more polished look
    const badgeLiveSite  = `[![Live Site](https://img.shields.io/badge/Live_Site-weixinchen.com-0A66C2?style=for-the-badge&logo=googlechrome&logoColor=white)](${LIVE_SITE_URL})`;
    const badgePublished = `[![Publications](https://img.shields.io/badge/Publications-${totalPublished}-2EA043?style=for-the-badge)](${LIVE_SITE_URL})`;
    const badgePreprints = `[![Recent Preprints](https://img.shields.io/badge/Recent_Preprints-${totalRecentPreprints}-FB8500?style=for-the-badge)](${LIVE_SITE_URL})`;
    const badgeUpdated   = `[![Auto-updated](https://img.shields.io/badge/Auto--updated-Daily-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](../../actions)`;

    const header = `# LLM4Rec Papers

${badgeLiveSite} ${badgePublished} ${badgePreprints} ${badgeUpdated}

**A continuously auto-updated paper list on LLM-powered Recommendation — covering Generative Recommendation and Agentic Recommendation.**

Explore with filters, search, citation counts, and a weekly email digest on the **[live site](${LIVE_SITE_URL})**.

It covers arXiv plus NeurIPS / ICLR / ICML / WWW / KDD / SIGIR / RecSys / CIKM / WSDM / TORS / TKDE / ACL / EMNLP (via Semantic Scholar), de-duplicated against arXiv preprints.

- **Recent Preprints**: limited to the last ${Math.round(PREPRINT_WINDOW_DAYS / 365 * 12)} months to keep the list from growing without bound. Older preprints remain visible on the live site.
- **Publications**: sorted by citation count, kept indefinitely.

> Citation counts are from the Semantic Scholar API and tend to run lower than Google Scholar, which indexes a wider set of citing sources. Treat them as a relative ranking signal, not an exact count.

**Last updated:** ${lastUpdated} · **Recent preprints:** ${totalRecentPreprints} · **Publications:** ${totalPublished}

---

`;

    const toc = '## Contents\n\n' + Object.keys(CATEGORY_META)
        .filter(key => papers.some(p => (p.category || 'other') === key))
        .map(key => `- [${CATEGORY_META[key].emoji} ${CATEGORY_META[key].label}](#${key})`)
        .join('\n') + '\n\n---\n\n';

    const footer = `\n---\n\n*Auto-generated. Do not edit README.md directly — update [scripts/generate_readme.js](scripts/generate_readme.js) instead, or the live site's classification logic.*\n`;

    const markdown = header + toc + sections.join('\n') + footer;

    const fs = await import('node:fs');
    fs.writeFileSync(new URL('../README.md', import.meta.url), markdown);
    console.log(`README.md written: ${totalRecentPreprints} recent preprints + ${totalPublished} publications.`);
}

main().catch(err => {
    console.error('Failed to generate README:', err);
    process.exit(1);
});

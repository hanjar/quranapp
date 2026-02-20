/**
 * Mushaf page data service — fetches per-page QPC glyph data
 * from zonetecde/mushaf-layout (GitHub raw JSON).
 *
 * Each page contains 15 lines with per-word QPC glyph mappings.
 */

export interface MushafWord {
    location: string;   // "surah:ayah:word" e.g. "2:25:1"
    word: string;        // Unicode Arabic text
    qpc: string;         // QPC V1 glyph for font rendering
}

export interface MushafLine {
    line: number;
    type: 'text' | 'surah-header' | 'basmala';
    text?: string;
    qpc?: string;
    verseRange?: string;
    surah?: string;
    words?: MushafWord[];
}

export interface MushafPageResponse {
    page: number;
    lines: MushafLine[];
}

const MUSHAF_BASE_URL =
    'https://raw.githubusercontent.com/zonetecde/mushaf-layout/refs/heads/main/mushaf';

/**
 * Fetch a single mushaf page (line-by-line with QPC glyphs).
 * Optionally caches in KV if available.
 */
export async function getMushafPage(
    pageNum: number,
    kv?: KVNamespace
): Promise<MushafPageResponse> {
    const cacheKey = `mushaf-page-${pageNum}`;

    // Try KV cache first
    if (kv) {
        const cached = await kv.get(cacheKey, 'json');
        if (cached) return cached as MushafPageResponse;
    }

    // Fetch from GitHub
    const paddedNum = String(pageNum).padStart(3, '0');
    const url = `${MUSHAF_BASE_URL}/page-${paddedNum}.json`;
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`Failed to fetch mushaf page ${pageNum}: HTTP ${res.status}`);
    }

    const raw = (await res.json()) as {
        page: number;
        lines: Array<{
            line: number;
            type: string;
            text?: string;
            qpcV1?: string;
            qpcV2?: string;
            verseRange?: string;
            surah?: string;
            words?: Array<{
                location: string;
                word: string;
                qpcV1: string;
                qpcV2: string;
            }>;
        }>;
    };

    // Transform to our simplified format (using qpcV1 for font compatibility)
    const response: MushafPageResponse = {
        page: raw.page,
        lines: raw.lines.map((line) => {
            const result: MushafLine = {
                line: line.line,
                type: line.type as MushafLine['type'],
            };

            if (line.type === 'text' && line.words) {
                result.text = line.text;
                result.verseRange = line.verseRange;
                result.words = line.words.map((w) => ({
                    location: w.location,
                    word: w.word,
                    qpc: w.qpcV1,
                }));
            } else if (line.type === 'surah-header') {
                result.text = line.text;
                result.surah = line.surah;
            } else if (line.type === 'basmala') {
                result.qpc = line.qpcV1;
                result.text = line.text;
            }

            return result;
        }),
    };

    // Cache in KV for 30 days (data is static)
    if (kv) {
        await kv.put(cacheKey, JSON.stringify(response), {
            expirationTtl: 60 * 60 * 24 * 30,
        });
    }

    return response;
}

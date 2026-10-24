/**
 * Named colours for the theme wizard: Indonesian everyday names first, then English / CSS names,
 * so "beige", "krem", "marun", "dongker", "tosca", "sage", "terracotta" all resolve to a colour.
 * `names[0]` is the label shown; the rest are aliases. Hex values follow CSS named colours where
 * one exists, otherwise common fashion / paint usage.
 */
export interface NamedColor {
  names: readonly string[];
  hex: string;
}

export const NAMED_COLORS: readonly NamedColor[] = [
  // --- merah & merah muda ---
  { names: ['Merah', 'red', 'abang'], hex: '#d32f2f' },
  { names: ['Merah tua', 'dark red', 'darkred'], hex: '#8b0000' },
  { names: ['Marun', 'maroon', 'merah marun', 'merah maroon'], hex: '#800000' },
  { names: ['Burgundy', 'burgundi', 'merah anggur'], hex: '#800020' },
  { names: ['Wine', 'merah wine'], hex: '#722f37' },
  { names: ['Merah bata', 'bata', 'brick', 'firebrick'], hex: '#b22222' },
  { names: ['Merah cabai', 'crimson', 'merah tua terang'], hex: '#dc143c' },
  { names: ['Merah ati', 'merah hati', 'oxblood'], hex: '#6a1b1a' },
  { names: ['Merah delima', 'ruby', 'rubi'], hex: '#9b111e' },
  { names: ['Merah muda', 'pink', 'merah jambu', 'jambu'], hex: '#f4a7b9' },
  { names: ['Pink pastel', 'baby pink', 'pink muda', 'light pink', 'lightpink'], hex: '#ffd1dc' },
  { names: ['Pink tua', 'hot pink', 'hotpink'], hex: '#ff69b4' },
  { names: ['Dusty pink', 'pink dusty', 'dusty rose', 'rose dust'], hex: '#d4a5a5' },
  { names: ['Mawar', 'rose', 'merah mawar'], hex: '#e8a0b0' },
  { names: ['Sakura', 'cherry blossom', 'pink sakura'], hex: '#ffb7c5' },
  { names: ['Salem', 'salmon', 'salmon pink'], hex: '#fa8072' },
  { names: ['Koral', 'coral', 'karang'], hex: '#ff7f50' },
  { names: ['Peach', 'persik', 'peach puff', 'peachpuff'], hex: '#ffdab9' },
  { names: ['Nude', 'warna kulit', 'skin', 'nude pink'], hex: '#e3bc9a' },
  { names: ['Mauve', 'mov', 'ungu dusty'], hex: '#b784a7' },
  { names: ['Magenta', 'fuchsia', 'fuksia'], hex: '#c2185b' },
  { names: ['Lipstik', 'merah lipstik', 'raspberry'], hex: '#b3446c' },
  // --- oranye, kuning, emas ---
  { names: ['Oranye', 'orange', 'jingga', 'oren'], hex: '#f57c00' },
  { names: ['Oranye tua', 'dark orange', 'darkorange', 'burnt orange'], hex: '#cc5500' },
  { names: ['Terracotta', 'terakota', 'terra cotta', 'tanah liat'], hex: '#c0603a' },
  { names: ['Rust', 'karat', 'warna karat'], hex: '#a0441e' },
  { names: ['Tembaga', 'copper'], hex: '#b87333' },
  { names: ['Aprikot', 'apricot'], hex: '#fbceb1' },
  { names: ['Kuning', 'yellow'], hex: '#fbc02d' },
  { names: ['Kuning muda', 'light yellow', 'lightyellow', 'kuning pucat'], hex: '#fff8c4' },
  { names: ['Kuning lemon', 'lemon', 'lemon chiffon', 'lemonchiffon'], hex: '#fff44f' },
  { names: ['Kuning kenari', 'canary'], hex: '#ffef00' },
  { names: ['Mustard', 'mustar', 'kuning mustard'], hex: '#c9a227' },
  { names: ['Kunyit', 'turmeric', 'kuning kunyit'], hex: '#e2a72e' },
  { names: ['Emas', 'gold', 'keemasan', 'golden'], hex: '#c5a03a' },
  { names: ['Emas tua', 'dark gold', 'goldenrod', 'darkgoldenrod'], hex: '#b8860b' },
  { names: ['Kuning gading', 'gading', 'ivory'], hex: '#fffff0' },
  { names: ['Kuning telur', 'egg yolk'], hex: '#ffcc33' },
  { names: ['Kuning jagung', 'cornsilk', 'jagung'], hex: '#fff8dc' },
  { names: ['Vanila', 'vanilla'], hex: '#f3e5ab' },
  { names: ['Sampanye', 'champagne', 'champagne gold'], hex: '#f7e7ce' },
  { names: ['Kuning pasir', 'sandy', 'sandybrown'], hex: '#f4a460' },
  // --- krem, beige, cokelat ---
  { names: ['Krem', 'cream', 'krim', 'creme'], hex: '#fffdd0' },
  { names: ['Krem tua', 'dark cream'], hex: '#f2e2b8' },
  { names: ['Beige', 'beis', 'bej', 'beije'], hex: '#f5f5dc' },
  { names: ['Beige tua', 'warm beige', 'beige hangat'], hex: '#e8d8b8' },
  { names: ['Putih tulang', 'off white', 'offwhite', 'broken white'], hex: '#f8f4ea' },
  { names: ['Linen', 'linan'], hex: '#faf0e6' },
  { names: ['Kertas tua', 'old paper', 'parchment', 'perkamen'], hex: '#f1e9d2' },
  { names: ['Gandum', 'wheat'], hex: '#f5deb3' },
  { names: ['Almond', 'blanched almond', 'blanchedalmond'], hex: '#ffebcd' },
  { names: ['Bisque', 'biskuit'], hex: '#ffe4c4' },
  { names: ['Moka', 'mocha', 'mocca', 'moca'], hex: '#a38068' },
  { names: ['Latte', 'cafe latte'], hex: '#c8a98b' },
  { names: ['Cokelat susu', 'milk chocolate', 'coklat susu'], hex: '#84563c' },
  { names: ['Cokelat', 'coklat', 'brown', 'chocolate'], hex: '#795548' },
  { names: ['Cokelat tua', 'dark brown', 'coklat tua', 'dark chocolate'], hex: '#4e342e' },
  { names: ['Cokelat muda', 'light brown', 'coklat muda', 'tan'], hex: '#d2b48c' },
  { names: ['Kopi', 'coffee', 'espresso'], hex: '#6f4e37' },
  { names: ['Karamel', 'caramel'], hex: '#af6f09' },
  { names: ['Kayu', 'wood', 'burlywood', 'kayu jati', 'jati'], hex: '#deb887' },
  { names: ['Kayu tua', 'walnut', 'kenari tua'], hex: '#5d432c' },
  { names: ['Sawo matang', 'sienna', 'sawo'], hex: '#a0522d' },
  { names: ['Kulit sapi', 'saddle brown', 'saddlebrown', 'kulit'], hex: '#8b4513' },
  { names: ['Khaki', 'kaki', 'khaki tua', 'dark khaki', 'darkkhaki'], hex: '#bdb76b' },
  { names: ['Pasir', 'sand', 'warna pasir'], hex: '#e2ca9e' },
  { names: ['Taupe'], hex: '#8b8589' },
  { names: ['Sepia'], hex: '#704214' },
  // --- hijau ---
  { names: ['Hijau', 'green', 'ijo'], hex: '#388e3c' },
  { names: ['Hijau tua', 'dark green', 'darkgreen'], hex: '#1b5e20' },
  { names: ['Hijau muda', 'light green', 'lightgreen'], hex: '#a5d6a7' },
  { names: ['Hijau daun', 'leaf green', 'daun'], hex: '#4caf50' },
  { names: ['Hijau botol', 'bottle green', 'botol'], hex: '#006a4e' },
  { names: ['Hijau lumut', 'moss', 'moss green', 'lumut'], hex: '#5b6b2f' },
  { names: ['Hijau army', 'army', 'army green', 'hijau tentara'], hex: '#4b5320' },
  { names: ['Hijau zaitun', 'zaitun', 'olive', 'olive green', 'olivedrab'], hex: '#6b8e23' },
  { names: ['Sage', 'hijau sage', 'sage green'], hex: '#9caf88' },
  { names: ['Hijau mint', 'mint', 'mint green', 'mint cream', 'mintcream'], hex: '#a8e6cf' },
  { names: ['Hijau pastel', 'pastel green'], hex: '#c1e1c1' },
  { names: ['Hijau pupus', 'hijau pucuk', 'pucuk'], hex: '#c5e17a' },
  { names: ['Hijau stabilo', 'lime', 'hijau lime', 'limau'], hex: '#a4c639' },
  { names: ['Hijau zamrud', 'zamrud', 'emerald', 'emerald green'], hex: '#047857' },
  { names: ['Hijau hutan', 'forest green', 'forestgreen', 'hutan'], hex: '#228b22' },
  { names: ['Hijau laut', 'sea green', 'seagreen'], hex: '#2e8b57' },
  { names: ['Hijau giok', 'jade', 'giok', 'batu giok'], hex: '#00a86b' },
  { names: ['Hijau pinus', 'pine', 'pine green'], hex: '#01796f' },
  { names: ['Hijau Madinah', 'hijau masjid nabawi', 'hijau islami', 'islamic green'], hex: '#00704a' },
  { names: ['Matcha', 'teh hijau', 'green tea'], hex: '#8fa25a' },
  { names: ['Avokad', 'avocado', 'alpukat'], hex: '#568203' },
  { names: ['Pistachio', 'pistasio'], hex: '#93c572' },
  // --- tosca, teal, biru ---
  { names: ['Tosca', 'toska', 'hijau tosca', 'hijau toska', 'turquoise', 'turkis'], hex: '#30b7a8' },
  { names: ['Tosca tua', 'teal', 'tosca gelap', 'dark teal'], hex: '#00796b' },
  { names: ['Tosca muda', 'aquamarine', 'akuamarin'], hex: '#7fdbc5' },
  { names: ['Biru telur asin', 'telur asin', 'duck egg', 'duck egg blue'], hex: '#a8d8cc' },
  { names: ['Cyan', 'sian', 'aqua', 'akua'], hex: '#00bcd4' },
  { names: ['Biru', 'blue'], hex: '#1976d2' },
  { names: ['Biru tua', 'dark blue', 'darkblue'], hex: '#0d47a1' },
  { names: ['Biru dongker', 'dongker', 'navy', 'biru navy', 'navy blue', 'biru donker'], hex: '#1f2a44' },
  { names: ['Biru malam', 'midnight', 'midnight blue', 'midnightblue'], hex: '#191970' },
  { names: ['Biru muda', 'light blue', 'lightblue', 'baby blue'], hex: '#add8e6' },
  { names: ['Biru langit', 'sky blue', 'skyblue', 'langit'], hex: '#87ceeb' },
  { names: ['Biru laut', 'ocean', 'ocean blue', 'biru samudra', 'samudra'], hex: '#1565c0' },
  { names: ['Biru pastel', 'pastel blue', 'powder blue', 'powderblue'], hex: '#b0e0e6' },
  { names: ['Biru es', 'ice blue', 'alice blue', 'aliceblue'], hex: '#e3f2fd' },
  { names: ['Biru benhur', 'royal blue', 'royalblue', 'biru royal'], hex: '#4169e1' },
  { names: ['Biru elektrik', 'electric blue', 'biru terang'], hex: '#2962ff' },
  { names: ['Biru safir', 'safir', 'sapphire'], hex: '#0f52ba' },
  { names: ['Biru kobalt', 'kobalt', 'cobalt'], hex: '#0047ab' },
  { names: ['Biru denim', 'denim', 'jeans'], hex: '#1560bd' },
  { names: ['Biru baja', 'steel blue', 'steelblue'], hex: '#4682b4' },
  { names: ['Biru batu', 'slate blue', 'slateblue'], hex: '#6a5acd' },
  { names: ['Biru keabuan', 'dusty blue', 'biru dusty'], hex: '#8aa1b4' },
  { names: ['Biru petrol', 'petrol', 'petrol blue'], hex: '#005f6a' },
  { names: ['Indigo', 'nila', 'biru nila'], hex: '#3f3d8f' },
  // --- ungu ---
  { names: ['Ungu', 'purple', 'violet', 'lembayung'], hex: '#7b1fa2' },
  { names: ['Ungu tua', 'dark purple', 'terong', 'eggplant', 'aubergine'], hex: '#4a148c' },
  { names: ['Ungu muda', 'light purple'], hex: '#ce93d8' },
  { names: ['Lavender', 'lavendel', 'ungu lavender'], hex: '#b8a9d9' },
  { names: ['Lilac', 'lilak', 'ungu lilac'], hex: '#c8a2c8' },
  { names: ['Ungu pastel', 'pastel purple', 'thistle'], hex: '#d8bfd8' },
  { names: ['Plum', 'prem'], hex: '#8e4585' },
  { names: ['Anggur', 'grape', 'ungu anggur'], hex: '#6f2da8' },
  { names: ['Anggrek', 'orchid', 'ungu anggrek'], hex: '#9c51b6' },
  { names: ['Ungu malam', 'dark violet', 'darkviolet'], hex: '#5e2a7e' },
  // --- netral ---
  { names: ['Putih', 'white'], hex: '#ffffff' },
  { names: ['Putih susu', 'milk', 'snow', 'salju'], hex: '#fffafa' },
  { names: ['Putih mutiara', 'mutiara', 'pearl'], hex: '#f8f6f0' },
  { names: ['Abu-abu', 'abu', 'abu abu', 'gray', 'grey', 'kelabu'], hex: '#9e9e9e' },
  { names: ['Abu muda', 'abu-abu muda', 'light gray', 'light grey', 'lightgray'], hex: '#d3d3d3' },
  { names: ['Abu tua', 'abu-abu tua', 'dark gray', 'dark grey', 'darkgray'], hex: '#5f6368' },
  { names: ['Abu kebiruan', 'slate', 'slate gray', 'slategray', 'abu batu'], hex: '#708090' },
  { names: ['Abu hangat', 'warm gray', 'warm grey', 'greige'], hex: '#a69e94' },
  { names: ['Perak', 'silver', 'silver gray'], hex: '#c0c0c0' },
  { names: ['Arang', 'charcoal', 'abu arang'], hex: '#36454f' },
  { names: ['Batu', 'stone', 'abu batu alam'], hex: '#928e85' },
  { names: ['Semen', 'cement', 'beton', 'concrete'], hex: '#a7a39a' },
  { names: ['Hitam', 'black'], hex: '#1b1b1b' },
  { names: ['Hitam pekat', 'jet black', 'jelaga'], hex: '#0a0a0a' },
  { names: ['Gunmetal', 'abu besi', 'besi'], hex: '#2a3439' },
  // --- tema & suasana ---
  { names: ['Madinah', 'krem madinah'], hex: '#f1e9d2' },
  { names: ['Gurun', 'desert', 'padang pasir'], hex: '#edc9af' },
  { names: ['Senja', 'sunset', 'jingga senja'], hex: '#fd5e53' },
  { names: ['Fajar', 'dawn', 'subuh'], hex: '#f6c6a8' },
  { names: ['Laut', 'sea', 'pantai', 'beach'], hex: '#2e86ab' },
  { names: ['Kurma', 'dates', 'kurma ajwa', 'ajwa'], hex: '#5c3a21' },
  { names: ['Kiswah', 'kabah', 'ka bah'], hex: '#141414' },
  { names: ['Daun teh', 'tea', 'teh'], hex: '#7c6a3c' },
  { names: ['Tanah', 'earth', 'earthy', 'bumi'], hex: '#8b6d4f' },
  { names: ['Hutan pinus', 'pinus'], hex: '#2f4f3a' },
];

/** Lowercase, no accents, "warna" dropped, separators to single spaces. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_'’.]/g, ' ')
    .replace(/\bwarna\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX = NAMED_COLORS.flatMap((c) => c.names.map((n) => ({ key: normName(n), color: c })));

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/**
 * Colours for one typed name, best first: exact name/alias, then names starting with it,
 * then containing it, then a small typo (1 edit per 4 letters). At most `max`, no duplicates.
 */
export function findColors(query: string, max = 6): NamedColor[] {
  const q = normName(query);
  if (!q) return [];
  const out: NamedColor[] = [];
  const add = (c: NamedColor) => {
    if (!out.includes(c) && out.length < max) out.push(c);
  };
  for (const e of INDEX) if (e.key === q) add(e.color);
  for (const e of INDEX) if (e.key.startsWith(q)) add(e.color);
  if (q.length >= 3) for (const e of INDEX) if (e.key.includes(q)) add(e.color);
  if (q.length >= 4) {
    const tol = Math.max(1, Math.floor(q.length / 4));
    for (const e of INDEX) if (editDistance(q, e.key) <= tol) add(e.color);
  }
  return out;
}

/** "beige dan maroon", "krem, hijau sage" → one best colour per part (unknown parts listed). */
export function parseColorWords(text: string): { found: NamedColor[]; unknown: string[] } {
  const parts = text
    .split(/,|\+|&|\/|\bdan\b|\band\b|\bdengan\b|\bsama\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const found: NamedColor[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const hit = findColors(p, 1)[0];
    if (hit && !found.includes(hit)) found.push(hit);
    else if (!hit) unknown.push(p);
  }
  return { found, unknown };
}

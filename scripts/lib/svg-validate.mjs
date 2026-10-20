// Security validation of upstream SVG. Throws on any violation; never strips content.

/** @returns {{polygons:number}} */
export function validateSvg(text, label = 'svg') {
  const fail = (m) => {
    throw new Error(`SVG security validation failed (${label}): ${m}`);
  };
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(text)) fail('does not start with <svg');
  if (/<script/i.test(text)) fail('contains <script');
  if (/<foreignObject/i.test(text)) fail('contains <foreignObject');
  if (/<image[\s>/]/i.test(text)) fail('contains <image');
  if (/<iframe/i.test(text)) fail('contains <iframe');
  if (/<(embed|object|audio|video)[\s>/]/i.test(text)) fail('contains embed/object/media element');
  if (/<!ENTITY/i.test(text)) fail('contains <!ENTITY');
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) fail('contains on* event-handler attribute');
  if (/javascript:/i.test(text)) fail('contains javascript: URL');
  for (const m of text.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const v = (m[1] ?? m[2] ?? '').trim();
    if (!v.startsWith('#')) fail(`href not local: ${v.slice(0, 60)}`);
  }
  for (const m of text.matchAll(/url\(\s*([^)]*)\)/gi)) {
    const v = m[1].trim().replace(/^["']|["']$/g, '');
    if (!v.startsWith('#')) fail(`url() outside document: ${v.slice(0, 60)}`);
  }
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/@import/i.test(m[1])) fail('<style> contains @import');
  }

  let polygons = 0;
  for (const m of text.matchAll(/<path\b[^>]*>/g)) {
    const tag = m[0];
    if (!/class\s*=\s*["'][^"']*\bayahPolygon\b/.test(tag)) continue;
    const s = /\ssurah\s*=\s*"(\d+)"/.exec(tag);
    const a = /\sayah\s*=\s*"(\d+)"/.exec(tag);
    if (!s || !a) fail(`.ayahPolygon without integer surah/ayah: ${tag.slice(0, 100)}`);
    polygons++;
  }
  if (polygons === 0) fail('no .ayahPolygon paths found');
  return { polygons };
}

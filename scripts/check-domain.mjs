#!/usr/bin/env node
// Cek live apakah domain masih kosong. Pakai RDAP (rdap.org mengarahkan ke registry yang benar, termasuk PANDI untuk .my.id).
// Usage: node scripts/check-domain.mjs quran.my.id harian.my.id
// 200 = sudah terdaftar, 404 = tidak ditemukan (kemungkinan tersedia), lainnya = tidak pasti.
const domains = process.argv.slice(2).map((d) => d.trim().toLowerCase()).filter(Boolean);
if (domains.length === 0) {
  console.error('Usage: node scripts/check-domain.mjs <domain> [domain ...]');
  process.exit(1);
}

async function check(domain) {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      redirect: 'follow',
      headers: { Accept: 'application/rdap+json', 'User-Agent': 'check-domain/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return { domain, status: 'TERSEDIA?', note: 'tidak ada di registry' };
    if (!res.ok) return { domain, status: 'TIDAK PASTI', note: `HTTP ${res.status}` };
    const data = await res.json();
    const expiry = data.events?.find((e) => e.eventAction === 'expiration')?.eventDate?.slice(0, 10);
    const ns = (data.nameservers ?? []).map((n) => n.ldhName).join(', ') || '-';
    return { domain, status: 'TERDAFTAR', note: `kadaluarsa ${expiry ?? '?'} · NS: ${ns}` };
  } catch (err) {
    return { domain, status: 'ERROR', note: err.message };
  }
}

const results = await Promise.all(domains.map(check));
for (const r of results) console.log(`${r.status.padEnd(11)} ${r.domain.padEnd(28)} ${r.note}`);

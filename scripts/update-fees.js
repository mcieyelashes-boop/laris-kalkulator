#!/usr/bin/env node
/**
 * Robot update notifikasi fee marketplace.
 * Jalan otomatis via GitHub Actions (lihat .github/workflows/update-fees.yml).
 *
 * Yang dilakukan:
 *  - Ambil berita terbaru soal biaya/komisi tiap marketplace dari Google News RSS.
 *  - Saring yang relevan (mengandung kata biaya/admin/komisi/tarif/potongan/fee).
 *  - Tulis ulang bagian "announcements" di config.json (jadi notifikasi 🔔 di app).
 *  - PERTAHANKAN bagian "marketplaces" & "feesUpdated" (angka fee tetap manual/aman).
 *
 * Tidak meng-otak-atik angka fee, karena tidak ada sumber resmi yang bisa dibaca mesin
 * dan salah angka = pembeli salah pasang harga.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MAX_ITEMS = 8;
const KEYWORDS = /(biaya|admin|komisi|tarif|potongan|fee|layanan|ongkir)/i;

const QUERIES = [
  { mp: 'Shopee',       q: 'biaya admin Shopee seller' },
  { mp: 'Tokopedia',    q: 'biaya layanan Tokopedia seller' },
  { mp: 'TikTok Shop',  q: 'biaya admin TikTok Shop seller' },
  { mp: 'Lazada',       q: 'biaya Lazada seller' },
];

function rssUrl(q){
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=id&gl=ID&ceid=ID:id`;
}

function decode(s){
  return (s || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .trim();
}

function toISO(d){
  const dt = new Date(d);
  return isNaN(dt) ? null : dt.toISOString().slice(0,10);
}

function parseItems(xml){
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const b of blocks){
    const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link  = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const date  = toISO(decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]));
    const source= decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
    if (title && link && date) items.push({ title, link, date, source });
  }
  return items;
}

// Bersihkan " - NamaMedia" di akhir judul Google News
function cleanTitle(t, source){
  if (source && t.endsWith(' - ' + source)) return t.slice(0, -(source.length + 3)).trim();
  return t.replace(/\s-\s[^-]+$/, '').trim();
}

async function fetchNews(){
  const all = [];
  for (const { mp, q } of QUERIES){
    try {
      const res = await fetch(rssUrl(q), { headers: { 'User-Agent': 'Mozilla/5.0 LarisBot' } });
      if (!res.ok) { console.warn(`[warn] ${mp}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      const items = parseItems(xml)
        .filter(it => KEYWORDS.test(it.title))
        .slice(0, 3)
        .map(it => ({ date: it.date, mp, title: cleanTitle(it.title, it.source), url: it.link }));
      all.push(...items);
      console.log(`[ok] ${mp}: ${items.length} berita relevan`);
    } catch (e){
      console.warn(`[warn] ${mp}: ${e.message}`);
    }
  }
  // dedupe by title, urut terbaru, batasi
  const seen = new Set();
  return all
    .filter(a => { const k = a.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a,b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ITEMS);
}

function readConfig(){
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch (e){
    return {
      feesUpdated: new Date().toISOString().slice(0,10),
      marketplaces: [
        { label: 'Toko sendiri / offline', fee: 0, note: '0%' },
        { label: 'Shopee', fee: 8, note: '~2,5–11,7% per kategori' },
        { label: 'Tokopedia', fee: 8, note: '~1–10% per kategori' },
        { label: 'TikTok Shop', fee: 8, note: '~2,5–12,2% per kategori' },
        { label: 'Lazada', fee: 7, note: '~tergantung kategori' },
      ],
      announcements: [],
    };
  }
}

(async () => {
  const cfg = readConfig();
  const news = await fetchNews();

  if (!news.length){
    console.log('[info] Tidak ada berita baru terambil — config.json dibiarkan apa adanya.');
    return;
  }

  cfg.announcements = news;
  cfg.lastChecked = new Date().toISOString().slice(0,10);
  cfg._petunjuk = 'announcements di-update otomatis oleh robot (GitHub Actions). Angka fee di marketplaces tetap manual & aman diubah tangan.';

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`[done] config.json diperbarui: ${news.length} notifikasi, lastChecked ${cfg.lastChecked}`);
})();

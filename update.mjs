// Cloud version of update.ps1 (runs in GitHub Actions with Node 20).
// Reads channels.json, downloads each channel's YouTube RSS feed, writes videos.js.
// If a channel fails, its previous videos are kept so one bad download never empties the app.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const strip = (t) => t.replace(/^﻿/, '');
const channels = JSON.parse(strip(readFileSync(new URL('channels.json', dir), 'utf8')));

let old = [];
try {
  const t = strip(readFileSync(new URL('videos.js', dir), 'utf8'));
  old = JSON.parse(t.replace(/^\s*window\.KIDS_DATA\s*=\s*/, '').replace(/;\s*$/, '')).videos || [];
} catch {}

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function feed(ch) {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const xml = await r.text();
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const href = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    if (!id || !title || href.includes('/shorts/')) continue;
    out.push({ id, title: decode(title), channel: ch.name, category: ch.category, s: ch.start, e: ch.end, published });
  }
  if (!out.length) throw new Error('empty feed');
  return out;
}

const videos = [];
let failed = 0;
for (const ch of channels) {
  try {
    const v = await feed(ch);
    videos.push(...v);
    console.log(`OK   ${ch.name} (${v.length})`);
  } catch (err) {
    failed++;
    const keep = old.filter((v) => v.channel === ch.name);
    videos.push(...keep);
    console.log(`FAIL ${ch.name}: ${err.message} (kept ${keep.length} old)`);
  }
}

if (!videos.length) {
  console.error('No videos at all; leaving videos.js unchanged.');
  process.exit(1);
}

videos.sort((a, b) => (a.published < b.published ? 1 : -1));
// Korean time (KST), e.g. "2026-11-21 00:05"
const parts = Object.fromEntries(
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]),
);
const updated = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
writeFileSync(new URL('videos.js', dir), `window.KIDS_DATA = ${JSON.stringify({ updated, videos }, null, 2)};`);
console.log(`videos.js: ${videos.length} videos, ${failed} channel(s) failed`);

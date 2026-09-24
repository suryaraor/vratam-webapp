#!/usr/bin/env node
// Helper for the /ingest skill. Talks to the deployed Apps Script web app.
//
//   node vratam.mjs parse   <whatsapp.txt> <out.json>   split a WhatsApp paste into numbered entries
//   node vratam.mjs members <out.json>                  dump every member (all statuses) to a file
//   node vratam.mjs apply   <plan.json> <out.json>      run the add/update ops in a plan file
//   node vratam.mjs sync    <out.json> [--dry]          mark every covered month before this one as done
//
// Output goes to files (UTF-8) rather than stdout so Telugu text survives the Windows console.
// PIN comes from $VRATAM_PIN, falling back to ACCESS_PIN in Code.gs.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readApiUrl() {
  const m = readFileSync(join(ROOT, 'index.html'), 'utf8').match(/const API_URL = '([^']+)'/);
  if (!m) throw new Error('API_URL not found in index.html');
  return m[1];
}

function readPin() {
  if (process.env.VRATAM_PIN) return process.env.VRATAM_PIN;
  const m = readFileSync(join(ROOT, 'Code.gs'), 'utf8').match(/const ACCESS_PIN = '([^']+)'/);
  if (!m) throw new Error('Set VRATAM_PIN (ACCESS_PIN not found in Code.gs)');
  return m[1];
}

async function apiGet(params) {
  const url = new URL(readApiUrl());
  Object.entries({ ...params, pin: readPin() }).forEach(([k, v]) => url.searchParams.set(k, v));
  const data = await (await fetch(url)).json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function apiPost(body) {
  const res = await fetch(readApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, pin: readPin() })
  });
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

// WhatsApp line prefix: "[10:00 AM, 9/24/2026] +91 91335 22913: "
const WA_PREFIX = /^\s*\[[^\]]*\d{1,2}:\d{2}[^\]]*\]\s*[^:]*:\s*/;
// Entry start: "44.", "45..", "55. " (a number followed by one or more dots)
const ENTRY_START = /^\s*(\d{1,3})\s*\.+\s*/;

function parse(text) {
  const entries = [];
  let cur = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(WA_PREFIX, '');
    const m = line.match(ENTRY_START);
    if (m) {
      cur = { num: Number(m[1]), lines: [] };
      entries.push(cur);
      const rest = line.slice(m[0].length).trim();
      if (rest) cur.lines.push(rest);
    } else if (line.trim()) {
      if (!cur) { cur = { num: null, lines: [] }; entries.push(cur); }
      cur.lines.push(line.trim());
    }
  }
  return entries.map(e => ({
    num: e.num,
    raw: e.lines.join('\n'),
    joined: e.lines.join(' ').replace(/\s+/g, ' ').trim()
  }));
}

async function apply(plan) {
  const results = [];
  for (const op of plan) {
    const { op: kind, note, ...body } = op;
    try {
      let res;
      if (kind === 'add') res = await apiPost({ action: 'addMember', ...body });
      else if (kind === 'update') res = await apiPost({ action: 'updateMember', ...body });
      else throw new Error('unknown op ' + kind);
      results.push({ ...op, ok: true, id: res.id ?? body.id });
      console.log(`ok   ${kind} ${res.id ?? body.id}`);
    } catch (err) {
      results.push({ ...op, ok: false, error: err.message });
      console.log(`FAIL ${kind} ${body.id ?? ''} ${err.message}`);
    }
  }
  return results;
}

function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

function monthRange(startYm, endYm) {
  const out = [];
  let [y, m] = startYm.split('-').map(Number);
  const [ey, em] = endYm.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// Past months are always "done": add a completion for every month an Active
// member covered before the current month that has no completion yet.
async function sync(dry) {
  const now = ym(new Date());
  const added = [];
  for (const m of await apiGet({ action: 'members' })) {
    if (m.status !== 'Active' || !m.startMonth || !m.endMonth) continue;
    const past = monthRange(m.startMonth.slice(0, 7), m.endMonth.slice(0, 7)).filter(x => x < now);
    if (!past.length) continue;
    const done = new Set((await apiGet({ action: 'completions', id: m.id })).map(d => d.slice(0, 7)));
    for (const month of past.filter(x => !done.has(x))) {
      if (!dry) await apiPost({ action: 'complete', id: m.id, month });
      added.push({ id: m.id, month });
      console.log(`${dry ? 'would mark' : 'marked'} ${m.id} ${month}`);
    }
  }
  return added;
}

const [cmd, a, b] = process.argv.slice(2);
const write = (path, obj) => writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');

if (cmd === 'parse' && a && b) {
  const entries = parse(readFileSync(a, 'utf8'));
  write(b, entries);
  console.log(`${entries.length} entries -> ${b}`);
} else if (cmd === 'members' && a) {
  const members = await apiGet({ action: 'members' });
  write(a, members);
  console.log(`${members.length} members -> ${a}`);
} else if (cmd === 'apply' && a && b) {
  const results = await apply(JSON.parse(readFileSync(a, 'utf8')));
  write(b, results);
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} ok, ${failed} failed -> ${b}`);
  if (failed) process.exit(1);
} else if (cmd === 'sync' && a) {
  const dry = b === '--dry';
  const added = await sync(dry);
  write(a, added);
  console.log(`${added.length} month(s) ${dry ? 'to mark' : 'marked'} done -> ${a}`);
} else {
  console.error('usage: vratam.mjs parse <in.txt> <out.json> | members <out.json> | apply <plan.json> <out.json> | sync <out.json> [--dry]');
  process.exit(2);
}

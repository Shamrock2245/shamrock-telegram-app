/**
 * Fail CI when source files contain wrong Shamrock public contacts.
 *
 * Canonical values:
 *   239-332-2245, 727-295-2245, 239-955-0178
 *   admin@shamrockbailbonds.biz
 *   https://www.shamrockbailbonds.biz
 *
 * Hard failures:
 *   - shamrockbailbonds.com, shamrockbail.com, shamrockbail.biz
 *   - any other host containing "shamrock" except shamrockbailbonds.biz
 *     (and its subdomains) and shamrock-telegram.netlify.app
 *   - a phone one digit away from a canonical number
 *   - an email one character away from the canonical admin address,
 *     or an email on a disallowed shamrock host
 *   - a displayed phone (formatted, tel:, or E.164) that is not canonical,
 *     not a 555 placeholder, and not an operational number below
 *
 * Digit-only strings are how the voice router stores jail and carrier
 * whitelist numbers. Those are not Shamrock public contacts. A bare digit
 * string fails only when it is one digit away from a canonical number.
 *
 * OPERATIONAL numbers are real lines already used for call routing or
 * internal notes. They are not one-digit typos, and rewriting them would
 * change who the phones ring. They are printed as reviews and do not fail CI.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CANONICAL_PHONES = new Set(['2393322245', '7272952245', '2399550178']);
const CANONICAL_EMAIL = 'admin@shamrockbailbonds.biz';
const BANNED_SNIPPETS = [
  'shamrockbailbonds.com',
  'shamrockbail.com',
  'shamrockbail.biz',
];

const OPERATIONAL = new Map([
  ['2399550301', 'desk cell dialed with the office landline in the Twilio voice handlers'],
  ['2399550305', 'Spanish line recorded in .agent notes'],
]);

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.toml', '.svg', '.txt', '.yml', '.yaml',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.netlify', '.github']);
const SKIP_FILES = new Set(['package-lock.json', 'deno.lock']);

const DISPLAY_PHONE_PATTERNS = [
  /\(\d{3}\)[\s.\-]*\d{3}[\s.\-]*\d{4}/g,
  /(?<!\d)\d{3}[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)/g,
  /tel:\+?1?\d{10,11}/gi,
  /(?<!\d)\+1\d{10}(?!\d)/g,
];
const BARE_PHONE_PATTERN = /(?<!\d)1?(?:239|727)\d{7}(?!\d)/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOST_RE = /\b(?:[a-z0-9-]+\.)*shamrock[a-z0-9.-]*\.(?:com|biz|net|org|info|us)\b/gi;

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function toTenDigits(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function isPlaceholder(digits) {
  return digits.slice(0, 3) === '555' || digits.slice(3, 6) === '555';
}

function hostOf(value) {
  const trimmed = value.replace(/[),.;]+$/g, '');
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/^\.+|\.+$/g, '');
  }
}

function isAllowedShamrockHost(host) {
  let h = host.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('www.')) h = h.slice(4);
  if (h === 'shamrockbailbonds.biz' || h.endsWith('.shamrockbailbonds.biz')) return true;
  if (h === 'shamrock-telegram.netlify.app' || h.endsWith('.shamrock-telegram.netlify.app')) return true;
  return false;
}

function nearestCanonical(digits) {
  let best = null;
  let bestDistance = Infinity;
  for (const canonical of CANONICAL_PHONES) {
    const distance = levenshtein(digits, canonical);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = canonical;
    }
  }
  return { phone: best, distance: bestDistance };
}

function classifyPhone(raw, source) {
  const digits = toTenDigits(raw);
  if (!digits) return null;
  if (CANONICAL_PHONES.has(digits)) return { kind: 'ok', digits };
  if (isPlaceholder(digits)) return { kind: 'ok', digits };
  const nearest = nearestCanonical(digits);
  if (nearest.distance === 1) {
    const pretty = nearest.phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    return { kind: 'error', digits, detail: `one digit away from ${pretty}` };
  }
  if (OPERATIONAL.has(digits)) {
    return { kind: 'review', digits, detail: OPERATIONAL.get(digits) };
  }
  if (source === 'bare') return { kind: 'ok', digits };
  return { kind: 'error', digits, detail: 'not a canonical Shamrock contact number' };
}

function audit(text) {
  const findings = [];
  const seen = new Set();
  const add = (kind, index, detail) => {
    const key = `${kind}|${lineNumber(text, index)}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, line: lineNumber(text, index), detail });
  };

  const decoded = text
    .replace(/&#8209;|&ndash;|&mdash;/gi, '-')
    .replace(/&nbsp;|&#160;/gi, ' ');

  for (const snippet of BANNED_SNIPPETS) {
    const re = new RegExp(snippet.replace(/\./g, '\\.'), 'gi');
    for (const match of decoded.matchAll(re)) {
      add('error', match.index ?? 0, `banned domain ${snippet}`);
    }
  }

  const scanPhones = (pattern, source) => {
    pattern.lastIndex = 0;
    for (const match of decoded.matchAll(pattern)) {
      const classified = classifyPhone(match[0], source);
      if (!classified || classified.kind === 'ok') continue;
      const pretty = classified.digits.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      add(classified.kind, match.index ?? 0, `${pretty} — ${classified.detail}`);
    }
  };
  for (const pattern of DISPLAY_PHONE_PATTERNS) scanPhones(pattern, 'display');
  scanPhones(BARE_PHONE_PATTERN, 'bare');

  HOST_RE.lastIndex = 0;
  for (const match of decoded.matchAll(HOST_RE)) {
    const host = match[0].toLowerCase();
    if (!isAllowedShamrockHost(host)) {
      add('error', match.index ?? 0, `disallowed shamrock host ${host}`);
    }
  }

  URL_RE.lastIndex = 0;
  for (const match of decoded.matchAll(URL_RE)) {
    const host = hostOf(match[0]);
    if (host.includes('shamrock') && !isAllowedShamrockHost(host)) {
      add('error', match.index ?? 0, `disallowed shamrock URL host ${host}`);
    }
  }

  EMAIL_RE.lastIndex = 0;
  for (const match of decoded.matchAll(EMAIL_RE)) {
    const email = match[0].toLowerCase();
    const domain = email.slice(email.indexOf('@') + 1);
    if (email === CANONICAL_EMAIL) continue;
    if (!isAllowedShamrockHost(domain) && (domain.includes('shamrock') || BANNED_SNIPPETS.some((snippet) => email.includes(snippet)))) {
      add('error', match.index ?? 0, `disallowed shamrock email ${email}`);
      continue;
    }
    if (levenshtein(email, CANONICAL_EMAIL) === 1) {
      add('error', match.index ?? 0, `one character away from ${CANONICAL_EMAIL}: ${email}`);
      continue;
    }
    if (email.includes('shamrock') && email !== CANONICAL_EMAIL) {
      add('review', match.index ?? 0, `${email} — not ${CANONICAL_EMAIL}`);
    }
  }

  return findings;
}

function selfTest() {
  const cases = [
    ['239-332-2245', 'ok'],
    ['(727) 295-2245', 'ok'],
    ['tel:+12399550178', 'ok'],
    ['+12393322245', 'ok'],
    ['(239) 555-1234', 'ok'],
    ['(555) 123-4567', 'ok'],
    ['https://www.shamrockbailbonds.biz', 'ok'],
    ['https://leads.shamrockbailbonds.biz/api', 'ok'],
    ['https://sign.shamrockbailbonds.biz', 'ok'],
    ['https://shamrock-telegram.netlify.app', 'ok'],
    ['admin@shamrockbailbonds.biz', 'ok'],
    ['239-332-2246', 'error'],
    ['https://shamrockbailbonds.com', 'error'],
    ['see shamrockbail.com', 'error'],
    ['email me at shamrockbail.biz', 'error'],
    ['https://www.shamrockbail.biz', 'error'],
    ['admin@shamrockbailbonds.com', 'error'],
    ['239-955-0301', 'review'],
    ['239-955-0305', 'review'],
    ['shamrockbailbonds1528@gmail.com', 'review'],
    ['12394771500', 'ok'],
    ['12393322246', 'error'],
    ['239-111-2222', 'error'],
  ];

  for (const [sample, expected] of cases) {
    const findings = audit(sample).filter((item) => item.kind !== 'ok');
    const kinds = new Set(findings.map((item) => item.kind));
    const actual = kinds.has('error') ? 'error' : kinds.has('review') ? 'review' : 'ok';
    if (actual !== expected) {
      console.error(`self-test failed for ${JSON.stringify(sample)}: expected ${expected}, got ${actual}`);
      console.error(findings);
      process.exit(1);
    }
  }
}

async function walk(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(full);
  }
}

selfTest();

const files = [];
await walk(ROOT, files);
files.sort();

const errors = [];
const reviews = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (text.includes('\0')) continue;
  const relative = path.relative(ROOT, file);
  for (const finding of audit(text)) {
    const row = `${relative}:${finding.line} ${finding.detail}`;
    if (finding.kind === 'error') errors.push(row);
    else reviews.push(row);
  }
}

reviews.sort();
errors.sort();

if (reviews.length) {
  console.log('Non-canonical contacts left in place (not obvious typos):');
  for (const row of reviews) console.log(`  review: ${row}`);
}

if (errors.length) {
  console.error('Brand contact guard failed:');
  for (const row of errors) console.error(`  error: ${row}`);
  process.exit(1);
}

console.log(`Brand contact guard passed (${files.length} files).`);

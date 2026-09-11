// One-time restructure of data/duas.json into the four-role reading model.
//
// Why: Hisn al-Muslim holds four kinds of reading, and the data had one shape for all of them --
// Arabic, transliteration, translation, reference -- so everything that was not a plain supplication
// got forced into it. Narrations sat in the Arabic slot as if they were the words to recite, and the
// transliteration slot held either "--" or English prose: 57 of 266 readings. Two translations had
// also been cut off mid-sentence, with the missing end surviving only in that transliteration slot.
//
// The roles, stored per reading in entry.partRoles (parallel to entry.parts, so nothing that reads
// `parts` breaks):
//   supplication  recitable words -- rendered exactly as before
//   framed        a narration or instruction that contains recitable words ("When you sneeze, say: ...")
//   instruction   what to do, with no fixed words (pray two rak'ahs, recite Surah al-Mulk, prostrate)
//   virtue        a narration about merit, with nothing to recite
//
// Every decision below was made by reading the text, not by pattern. A rule was tried first and would
// have deleted seven correct transliterations whose bracketed notes ("[Recite three times]") looked
// like English; those are left alone. The script refuses to run if any change would lose text.
//
// Backups taken before this ran: git tag backup/pre-four-role-model, the JSON snapshot under
// .fortress-backups/pre-four-role-model-*, and D1 Time Travel bookmarks in the manifest beside it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'data/duas.json');

/** Readings that are not plain supplications. Keyed entryId:partNumber (1-based). */
const ROLES = {
  // --- instruction: what to do, no fixed words to recite ---
  '15:3': 'instruction',   // send blessings on the Prophet after answering the mu'adhdhin
  '15:5': 'instruction',   // supplicate for yourself between the adhan and iqamah
  '28:12': 'instruction',  // recite Surah as-Sajdah and Surah al-Mulk
  '31:1': 'instruction',   // after a bad dream: spit left, seek refuge, tell no one, turn over
  '44:1': 'instruction',   // after a sin: purify, pray two rak'ahs, seek forgiveness
  '45:2': 'instruction',   // the adhan repels the devil (restored)
  '45:3': 'instruction',   // adhkar and Qur'an recitation repel the devil (restored)
  '74:1': 'instruction',   // answer an invitation; supplicate if fasting
  '88:1': 'instruction',   // memorise ten ayat of al-Kahf; seek refuge after the tashahhud
  '110:1': 'instruction',  // on hearing a rooster or a donkey
  '111:1': 'instruction',  // on hearing dogs or donkeys at night
  '120:1': 'instruction',  // what the Prophet did at al-Mash'ar al-Haram
  '121:1': 'instruction',  // takbir with each pebble at the Jamarat
  '123:1': 'instruction',  // prostrate in gratitude on good news

  // --- virtue: merit or exhortation, nothing to recite ---
  '50:1': 'virtue',        // the excellence of visiting the sick
  '107:1': 'virtue', '107:2': 'virtue', '107:3': 'virtue', '107:4': 'virtue', '107:5': 'virtue',
  '108:1': 'virtue', '108:2': 'virtue', '108:3': 'virtue',
  '129:2': 'virtue',       // "O people, repent to Allah"
  '129:4': 'virtue',       // the Lord is nearest in the last part of the night
  '129:5': 'virtue',       // the servant is nearest while prostrating
  '132:1': 'virtue',       // restrain children at nightfall; shut doors mentioning Allah

  // --- framed: a narration or instruction that carries recitable words ---
  '15:1': 'framed', '26:1': 'framed', '40:2': 'framed', '40:3': 'framed', '48:1': 'framed',
  '51:2': 'framed', '52:1': 'framed', '69:1': 'framed', '69:2': 'framed', '77:1': 'framed',
  '80:1': 'framed', '84:1': 'framed', '102:1': 'framed', '105:1': 'framed', '106:1': 'framed',
  '112:1': 'framed', '113:1': 'framed', '116:1': 'framed', '118:1': 'framed', '125:1': 'framed',
  '129:1': 'framed', '129:3': 'framed', '129:6': 'framed', '131:1': 'framed',
  '130:1': 'framed', '130:2': 'framed', '130:3': 'framed', '130:4': 'framed', '130:5': 'framed',
  '130:6': 'framed', '130:7': 'framed', '130:8': 'framed', '130:9': 'framed', '130:10': 'framed',
  '130:11': 'framed', '130:12': 'framed',
};

/**
 * Where the transliteration slot held English that is NOT already in the translation. Everything
 * else in that slot is "--" or a duplicate of the translation and is simply dropped.
 *   context   the English is the narration frame; keep it as a context line
 *   complete  the translation was truncated and this is its full text; restore it
 */
const TRANSLITERATION_RESCUE = {
  '48:1': 'context',       // "The Prophet used to seek Allah's protection for al-Hasan and al-Husain by saying:"
  '51:2': 'context',       // "As he was dying, the Prophet dipped his hands in water and wiped his face saying:"
  '108:2': 'complete',     // translation stopped at "...has completed his faith:"
  '131:1': 'complete',     // translation stopped at "Abdullah bin 'Amr said:"
};

const MACRON = /[āīūḥṣḍṭẓĀĪŪḤṢ`]/;
const ENGLISH_WORD = /\b(said|the|you|and|when|then|whoever|with|his|from|there|if|say|recite|would|used|is|are)\b/i;
const isPlaceholder = (text) => /^[-–—\s.]*$/.test(text);
// English prose sitting in the transliteration slot: no transliteration diacritics, and English words.
// "From every elevated point say Allāhu Akbar..." is English despite its one transliterated phrase.
const isEnglishProse = (text) => (!MACRON.test(text) && ENGLISH_WORD.test(text)) || /^From every elevated point/.test(text);
const norm = (text) => text.replace(/\s+/g, ' ').trim();
const words = (text) => text.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

function restorePartsFromBackup(entryId, positions) {
  const original = JSON.parse(execFileSync('git', ['show', 'backup/pre-four-role-model:pwa-website/data/duas.json'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString());
  // The tagged state is after 45's parts 2 and 3 were removed, so they come from the commit before that.
  const before = JSON.parse(execFileSync('git', ['show', '75352cd^:pwa-website/data/duas.json'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString());
  const entry = before.entries.find((e) => e.id === entryId);
  const now = original.entries.find((e) => e.id === entryId);
  if (!entry || !now) throw new Error(`entry ${entryId} not found for restore`);
  return positions.map((n) => entry.parts[n - 1]);
}

const raw = readFileSync(FILE, 'utf8');
const data = JSON.parse(raw);
const report = { restored: [], droppedPlaceholder: [], droppedDuplicate: [], toContext: [], completedTranslation: [], roles: {} };

// 1. Entry 45's adhan and adhkar readings are valid; they come back, now with a role that renders them
//    as guidance instead of a dua with a missing middle line.
const e45 = data.entries.find((e) => e.id === 45);
if (e45.parts.length === 1) {
  e45.parts.push(...restorePartsFromBackup(45, [2, 3]));
  report.restored.push('45:2', '45:3');
}

for (const entry of data.entries) {
  const roles = [];
  entry.parts.forEach((part, index) => {
    const key = `${entry.id}:${index + 1}`;
    const role = ROLES[key] || 'supplication';
    roles.push(role);
    report.roles[role] = (report.roles[role] || 0) + 1;

    const trIndex = part.findIndex((s) => s.kind === 'transliteration');
    if (trIndex === -1) return;
    const tr = part[trIndex].text;
    const enSegment = part.find((s) => s.kind === 'translation');
    const en = enSegment ? enSegment.text : '';

    if (isPlaceholder(tr)) {
      part.splice(trIndex, 1);
      report.droppedPlaceholder.push(key);
      return;
    }
    if (!isEnglishProse(tr)) return;   // a real transliteration: untouched

    const rescue = TRANSLITERATION_RESCUE[key];
    if (rescue === 'context') {
      part.splice(trIndex, 1, { kind: 'context', text: tr });
      report.toContext.push(key);
      return;
    }
    if (rescue === 'complete') {
      // The truncated translation must be a prefix of the fuller text, or this is not what it seems.
      const cut = norm(en).replace(/[:.]$/, '').trim();
      if (!norm(tr).startsWith(cut)) throw new Error(`${key}: translation is not a prefix of the transliteration text`);
      enSegment.text = tr;
      part.splice(trIndex, 1);
      report.completedTranslation.push(key);
      return;
    }
    // Anything else must genuinely duplicate the translation before it may be dropped.
    const tw = words(tr);
    const ew = new Set(words(en));
    const cover = tw.length ? tw.filter((w) => ew.has(w)).length / tw.length : 1;
    if (cover < 0.85) throw new Error(`${key}: English in the transliteration slot is not in the translation (cover ${cover.toFixed(2)}); needs a decision`);
    part.splice(trIndex, 1);
    report.droppedDuplicate.push(key);
  });
  entry.partRoles = roles;
}

// Every role key must have hit a real reading, or the table has a typo that silently did nothing.
for (const key of Object.keys(ROLES)) {
  const [id, n] = key.split(':').map(Number);
  const entry = data.entries.find((e) => e.id === id);
  if (!entry || !entry.parts[n - 1]) throw new Error(`role table names ${key}, which does not exist`);
}

writeFileSync(FILE, `${JSON.stringify(data, null, 2).replace(/\n/g, '\r\n')}\r\n`);
console.log(JSON.stringify({
  roles: report.roles,
  restored: report.restored,
  droppedPlaceholder: report.droppedPlaceholder.length,
  droppedDuplicate: report.droppedDuplicate.length,
  toContext: report.toContext,
  completedTranslation: report.completedTranslation,
}, null, 1));

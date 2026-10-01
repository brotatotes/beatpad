/* Music theory module copied unchanged from Chord Explorer (https://github.com/brotatotes/chord-explorer, src/theory.js)
   by the same author, for Beat Pad melodic mode (scales and keys). */
/* Chord Explorer music theory engine. Pure JS, no DOM. Works in node (CommonJS) and in the browser (global Theory). */
(function (global) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
  const mod = (n, m) => ((n % m) + m) % m;

  // ---------- notes ----------
  function parseNote(s) {
    if (typeof s !== 'string') return null;
    const m = /^([A-Ga-g])(##|bb|x|#|b|♯♯|♭♭|♯|♭|𝄪|𝄫)?$/.exec(s.trim());
    if (!m) return null;
    const letter = LETTERS.indexOf(m[1].toUpperCase());
    const accMap = { '#': 1, '♯': 1, 'b': -1, '♭': -1, '##': 2, 'x': 2, '♯♯': 2, '𝄪': 2, 'bb': -2, '♭♭': -2, '𝄫': -2 };
    const acc = m[2] ? accMap[m[2]] : 0;
    return { letter, acc };
  }
  const notePc = (n) => mod(NATURAL_PC[n.letter] + n.acc, 12);
  function noteName(n, opts) {
    const fancy = opts && opts.unicode;
    const a = n.acc;
    let acc = '';
    if (a > 0) acc = fancy ? (a === 2 ? '𝄪' : '♯'.repeat(a)) : (a === 2 ? '##' : '#'.repeat(a));
    if (a < 0) acc = fancy ? (a === -2 ? '𝄫' : '♭'.repeat(-a)) : 'b'.repeat(-a);
    return LETTERS[n.letter] + acc;
  }

  // ---------- intervals ----------
  // An interval is { num: 1..13, semis }. Degree steps = num-1.
  const BASE_SEMIS = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12, 9: 14, 10: 16, 11: 17, 12: 19, 13: 21 };
  function iv(token) {
    const m = /^(bb|b|#|##)?(\d+)$/.exec(token);
    if (!m) throw new Error('bad interval ' + token);
    const num = +m[2];
    const adj = { bb: -2, b: -1, '#': 1, '##': 2 }[m[1] || ''] || 0;
    return { num, semis: BASE_SEMIS[num] + adj, token };
  }
  const PERFECT = new Set([1, 4, 5, 8, 11, 12]);
  function intervalName(semis, num) {
    // full name like "minor 3rd" from a numbered interval
    const base = BASE_SEMIS[num];
    const d = semis - base;
    const ord = ordinal(num);
    if (PERFECT.has(num)) {
      return ({ '-2': 'doubly diminished', '-1': 'diminished', '0': 'perfect', '1': 'augmented', '2': 'doubly augmented' }[d] || '?') + ' ' + ord;
    }
    return ({ '-2': 'diminished', '-1': 'minor', '0': 'major', '1': 'augmented' }[d] || '?') + ' ' + ord;
  }
  function ordinal(n) {
    if (n === 1) return 'unison';
    if (n === 8) return 'octave';
    const s = (n % 10 === 1 && n !== 11) ? 'st' : (n % 10 === 2 && n !== 12) ? 'nd' : (n % 10 === 3 && n !== 13) ? 'rd' : 'th';
    return n + s;
  }
  // Interval between two spelled notes, ascending within an octave.
  function intervalBetween(a, b) {
    const steps = mod(b.letter - a.letter, 7);
    const semis = mod(notePc(b) - notePc(a), 12);
    const num = steps + 1;
    let s = semis;
    const base = BASE_SEMIS[num];
    if (s - base > 6) s -= 12; else if (base - s > 6) s += 12;
    return { num, semis: s, name: intervalName(s, num) };
  }
  const SIMPLE_INTERVAL_NAMES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];

  function transpose(note, interval) {
    const letter = mod(note.letter + interval.num - 1, 7);
    const target = notePc(note) + interval.semis;
    let acc = mod(target - NATURAL_PC[letter], 12);
    if (acc > 6) acc -= 12;
    return { letter, acc };
  }

  // ---------- chord symbols ----------
  function normalizeSymbol(s) {
    return s.replace(/^\s*([A-Ga-g])\s*-?\s*(sharp|flat)\b/i, (m, l, a) => l + (a.toLowerCase() === 'sharp' ? '#' : 'b'))
      .replace(/\b(sharp)\s*(?=\d)/gi, '#').replace(/\b(flat)\s*(?=\d)/gi, 'b')
      .replace(/\s*\bover\s+/gi, '/')
      .replace(/half[-\s]?dim(inished)?/gi, 'hdim').replace(/diminished/gi, 'dim').replace(/augmented/gi, 'aug').replace(/dominant\s*/gi, '').replace(/suspended/gi, 'sus')
      .replace(/\s+/g, '')
      .replace(/[△Δ∆](?![0-9])/g, 'maj7')
      .replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[−–]/g, '-')
      .replace(/[△Δ∆]/g, 'maj').replace(/[°º]/g, 'dim').replace(/ø/g, 'hdim');
  }

  function parseChord(input) {
    if (typeof input !== 'string') return null;
    let s = normalizeSymbol(input);
    if (!s) return null;
    // root
    const rm = /^([A-Ga-g])(##|bb|#|b)?/.exec(s);
    if (!rm) return null;
    let rootStr = rm[1].toUpperCase() + (rm[2] || '');
    let rest = s.slice(rm[0].length);
    // A lone 'b' root followed by 'b' could be "Bb"; handled by regex. Guard "Cb5"? treat as C flat 5 (rare); fine.
    let bass = null;
    const sm = /\/([A-Ga-g](?:##|bb|#|b)?)$/.exec(rest);
    if (sm) { bass = parseNote(sm[1][0].toUpperCase() + sm[1].slice(1)); rest = rest.slice(0, sm.index); }
    const root = parseNote(rootStr);
    const c = { third: '3', fifth: '5', seventh: null, sixth: false, exts: [], alts: [], adds: [], sus: null, power: false, quality: 'maj', majSeventh: false, omit: [] };
    let r = rest;
    const eat = (re) => { const m = re.exec(r); if (m) { r = r.slice(m[0].length); return m; } return null; };
    // quality
    if (eat(/^hdim7?/i)) { c.quality = 'hdim'; c.third = 'b3'; c.fifth = 'b5'; c.seventh = 'b7'; }
    else if (eat(/^(maj|Maj|MAJ|ma|Ma|M(?!in|IN))(?=\d|$|\(|add|sus|#|b|\/)/)) { c.majSeventh = true; c.majWord = true; }
    else if (eat(/^(major)/i)) { c.majSeventh = true; c.majWord = true; }
    else if (eat(/^(minor|min|mi|m|-)/)) { c.quality = 'min'; c.third = 'b3'; }
    else if (eat(/^(dim|o)/i)) { c.quality = 'dim'; c.third = 'b3'; c.fifth = 'b5'; }
    else if (eat(/^(aug|\+)/i)) { c.quality = 'aug'; c.fifth = '#5'; }
    if (c.quality === 'min' && eat(/^\(?(maj|Maj|M|ma|Δ)\)?(?=\d|$|\()/)) { c.majSeventh = true; }
    if (c.quality === 'min' && eat(/^\(?(maj|Maj|M|ma)(7|9|11|13)\)?/)) { c.majSeventh = true; r = RegExp.$2 ? r : r; }
    // number
    let m;
    if ((m = eat(/^(6\/9|69)/))) { c.sixth = true; c.exts.push('9'); }
    else if ((m = eat(/^(13|11|9|7|6|5|2|4)/))) {
      const n = m[1];
      if (n === '6') c.sixth = true;
      else if (n === '5') { if (c.quality !== 'maj' || c.majWord) return null; c.power = true; }
      else if (n === '2') { c.sus = '2'; }
      else if (n === '4') { c.sus = '4'; }
      else {
        c.seventh = c.seventh || (c.majSeventh ? '7' : (c.quality === 'dim' ? 'bb7' : 'b7'));
        if (n === '9') c.exts.push('9');
        if (n === '11') c.exts.push('9', '11');
        if (n === '13') { c.exts.push('9'); if (c.quality === 'min') c.exts.push('11'); c.exts.push('13'); }
      }
    }
    if (c.majWord && !c.seventh && !c.sixth) c.majSeventh = false; // "Cmaj" = C major triad
    // modifiers
    let guard = 0;
    while (r.length && guard++ < 20) {
      if (eat(/^[(),]/)) continue;
      if ((m = eat(/^(maj|M)(7|9|11|13)/))) { c.majSeventh = true; c.seventh = '7'; if (m[2] !== '7') { c.exts.push('9'); if (m[2] !== '9') c.exts.push('11'); if (m[2] === '13') c.exts.push('13'); } continue; }
      if ((m = eat(/^sus(2|4)?/i))) { c.sus = m[1] || '4'; continue; }
      if ((m = eat(/^add(b|#)?(2|4|9|11|13)/i))) { c.adds.push((m[1] || '') + m[2]); continue; }
      if ((m = eat(/^(no|omit)(3|5)/i))) { c.omit.push(m[2]); continue; }
      if ((m = eat(/^alt/i))) { c.seventh = c.seventh || 'b7'; c.alts.push('b9', '#9', '#11', 'b13'); c.fifth = null; continue; }
      if ((m = eat(/^(b|#|\+|-)(5|9|11|13)/))) { const a = (m[1] === '+' ? '#' : m[1] === '-' ? 'b' : m[1]) + m[2]; c.alts.push(a); continue; }
      if ((m = eat(/^(7|9|11|13)/)) && c.sixth === false && !c.seventh) { c.seventh = 'b7'; if (m[1] !== '7') c.exts.push('9'); if (m[1] === '11' || m[1] === '13') c.exts.push('11'); if (m[1] === '13') c.exts.push('13'); continue; }
      if (m) continue;
      return null;
    }
    if (r.length) return null;
    // apply sus
    if (c.sus) c.third = c.sus;
    if (c.power) { c.third = null; }
    // alterations
    for (const a of c.alts) {
      const num = a.replace(/[b#]/g, '');
      if (num === '5') c.fifth = a;
      else { const i = c.exts.indexOf(num); if (i >= 0) c.exts.splice(i, 1); if (!c.seventh && (num === '9' || num === '13' || num === '11')) c.seventh = 'b7'; }
    }
    if (c.quality === 'aug' && c.alts.includes('b5')) return null;
    const tokens = ['1'];
    if (c.third && !c.omit.includes('3')) tokens.push(c.third);
    if (c.fifth && !c.omit.includes('5')) tokens.push(c.fifth);
    if (c.sixth) tokens.push('6');
    if (c.seventh) tokens.push(c.seventh);
    for (const e of c.exts) tokens.push(e);
    for (const a of c.alts) if (!a.endsWith('5') || a.length > 2) { if (!a.match(/^[b#]5$/)) tokens.push(a); }
    for (const a of c.adds) tokens.push(a);
    const uniq = [];
    const seen = new Set();
    for (const t of tokens) if (!seen.has(t)) { seen.add(t); uniq.push(t); }
    const intervals = uniq.map(iv).sort((a, b) => a.semis - b.semis);
    const chord = { root, bass, intervals, parts: c };
    chord.notes = intervals.map((i) => transpose(root, i));
    chord.suffix = canonicalSuffix(c);
    chord.symbol = noteName(root) + chord.suffix + (bass ? '/' + noteName(bass) : '');
    return chord;
  }

  function canonicalSuffix(c) {
    let s = '';
    const top = c.exts.includes('13') ? '13' : c.exts.includes('11') ? '11' : c.exts.includes('9') ? '9' : null;
    if (c.power) return '5';
    if (c.quality === 'hdim') s = 'm' + (top || '7') + 'b5';
    else if (c.quality === 'dim') s = c.seventh ? 'dim' + (top || '7') : 'dim';
    else {
      if (c.quality === 'min') s = 'm';
      if (c.sixth) s += c.exts.includes('9') ? '6/9' : '6';
      else if (c.seventh === '7') s += (c.quality === 'min' ? '(maj' + (top || '7') + ')' : 'maj' + (top || '7'));
      else if (c.seventh === 'b7') s += (top || '7');
      if (c.quality === 'aug') s = (c.seventh ? s : '') ? (s + '#5') : 'aug';
    }
    if (c.sus && !(c.sus === '4' && false)) s += 'sus' + c.sus;
    for (const a of c.alts) if (!(c.quality === 'hdim' && a === 'b5')) s += a;
    for (const a of c.adds) s += 'add' + a;
    for (const o of c.omit) s += 'no' + o;
    if (c.quality === 'aug' && c.seventh) s = s.replace(/^aug/, '');
    return s;
  }

  // ---------- naming: notes -> chord ----------
  // Templates: suffix, tones (interval tokens), optional tones, prior (commonness), description.
  const T = (suffix, tones, opt, prior, desc) => ({ suffix, tones: tones.split(' ').map(iv), opt: new Set(opt ? opt.split(' ') : []), prior, desc });
  const TEMPLATES = [
    T('', '1 3 5', '5', 100, 'a major triad: root, major 3rd and perfect 5th. Bright and stable.'),
    T('m', '1 b3 5', '5', 100, 'a minor triad: root, minor 3rd and perfect 5th. Darker than major.'),
    T('dim', '1 b3 b5', '', 88, 'a diminished triad: two stacked minor 3rds. Tense and unstable.'),
    T('aug', '1 3 #5', '', 84, 'an augmented triad: two stacked major 3rds. Dreamy and unresolved.'),
    T('sus4', '1 4 5', '5', 86, 'a suspended chord: the 3rd is replaced by the 4th, so it is neither major nor minor and wants to resolve.'),
    T('sus2', '1 2 5', '5', 85, 'a suspended chord: the 3rd is replaced by the 2nd. Open and airy.'),
    T('5', '1 5', '', 80, 'a power chord: just the root and 5th, with no 3rd, so it is neither major nor minor.'),
    T('6', '1 3 5 6', '5', 86, 'a major triad with an added major 6th. Sweet, vintage sound.'),
    T('m6', '1 b3 5 6', '5', 84, 'a minor triad with an added major 6th.'),
    T('7', '1 3 5 b7', '5', 96, 'a dominant 7th: a major triad plus a minor 7th. Bluesy, and pulls toward the chord a 5th below.'),
    T('maj7', '1 3 5 7', '5', 95, 'a major 7th: a major triad plus a major 7th, a half step below the octave. Soft and jazzy.'),
    T('m7', '1 b3 5 b7', '5', 95, 'a minor 7th: a minor triad plus a minor 7th. Mellow.'),
    T('m(maj7)', '1 b3 5 7', '5', 76, 'a minor triad with a major 7th. Dark and suspenseful.'),
    T('m7b5', '1 b3 b5 b7', '', 88, 'a half-diminished 7th: a diminished triad plus a minor 7th. Often leads to a dominant chord.'),
    T('dim7', '1 b3 b5 bb7', '', 88, 'a diminished 7th: stacked minor 3rds that divide the octave evenly, so any of its four notes can be the root.'),
    T('7#5', '1 3 #5 b7', '', 74, 'an augmented 7th: a dominant 7th with a raised 5th.'),
    T('maj7#5', '1 3 #5 7', '', 70, 'a major 7th with a raised 5th.'),
    T('7b5', '1 3 b5 b7', '', 72, 'a dominant 7th with a lowered 5th.'),
    T('7sus4', '1 4 5 b7', '5', 84, 'a dominant 7th with the 3rd replaced by the 4th.'),
    T('6/9', '1 3 5 6 9', '5', 78, 'a major triad with an added 6th and 9th. Rich and settled.'),
    T('m6/9', '1 b3 5 6 9', '5', 72, 'a minor triad with an added 6th and 9th.'),
    T('add9', '1 3 5 9', '5', 84, 'a major triad with an added 9th (the 2nd an octave up), without a 7th.'),
    T('madd9', '1 b3 5 9', '5', 82, 'a minor triad with an added 9th, without a 7th.'),
    T('add11', '1 3 5 11', '5', 66, 'a major triad with an added 11th (the 4th an octave up).'),
    T('9', '1 3 5 b7 9', '5', 82, 'a dominant 9th: a dominant 7th with a 9th on top.'),
    T('maj9', '1 3 5 7 9', '5', 80, 'a major 9th: a major 7th with a 9th on top.'),
    T('m9', '1 b3 5 b7 9', '5', 80, 'a minor 9th: a minor 7th with a 9th on top.'),
    T('7b9', '1 3 5 b7 b9', '5', 74, 'a dominant 7th with a flat 9th. Very tense.'),
    T('7#9', '1 3 5 b7 #9', '5', 74, 'a dominant 7th with a sharp 9th, the "Hendrix chord".'),
    T('7#11', '1 3 5 b7 #11', '5', 66, 'a dominant 7th with a sharp 11th.'),
    T('maj7#11', '1 3 5 7 #11', '5', 66, 'a major 7th with a sharp 11th. The Lydian sound.'),
    T('9sus4', '1 4 5 b7 9', '5', 72, 'a 9th chord with the 3rd replaced by the 4th.'),
    T('11', '1 3 5 b7 9 11', '3 5 9', 66, 'an 11th chord: stacked 3rds up to the 11th. The 3rd is often left out.'),
    T('m11', '1 b3 5 b7 9 11', '5 9', 70, 'a minor 11th: a minor 7th with the 9th and 11th.'),
    T('13', '1 3 5 b7 9 13', '5 9', 72, 'a dominant 13th: a dominant 7th with the 13th (the 6th an octave up) on top.'),
    T('maj13', '1 3 5 7 9 13', '5 9', 66, 'a major 13th: a major 7th with the 9th and 13th.'),
    T('m13', '1 b3 5 b7 9 11 13', '5 9 11', 64, 'a minor 13th.'),
    T('7b13', '1 3 5 b7 b13', '5', 60, 'a dominant 7th with a flat 13th.'),
  ];
  const TEMPLATE_BY_SUFFIX = Object.fromEntries(TEMPLATES.map((t) => [t.suffix, t]));

  const ROLE_NAMES = { 1: 'root', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 9: '9th', 11: '11th', 13: '13th' };
  function roleOf(token) {
    const i = iv(token);
    const pre = token.startsWith('bb') ? '♭♭' : token.startsWith('b') ? '♭' : token.startsWith('#') ? '♯' : '';
    if (i.num === 3 || i.num === 7 || i.num === 1) return (token === 'b3' ? 'minor 3rd' : token === '3' ? 'major 3rd' : token === 'b7' ? 'minor 7th' : token === '7' ? 'major 7th' : token === 'bb7' ? 'diminished 7th' : 'root');
    return pre + ROLE_NAMES[i.num];
  }

  // Key context: { tonic: note, mode: 'major'|'minor' }
  function keyScale(key) {
    if (!key) return null;
    return scaleNotes(key.tonic, key.mode === 'minor' ? 'minor' : 'major');
  }

  const SPELL_PREF = { 1: -1, 3: -1, 6: 1, 8: -1, 10: -1 };
  function rootSpellings(pc) {
    const out = [];
    for (let l = 0; l < 7; l++) {
      let acc = mod(pc - NATURAL_PC[l], 12); if (acc > 6) acc -= 12;
      if (Math.abs(acc) <= 1) out.push({ letter: l, acc });
    }
    return out;
  }
  function spellChordRoot(pc, tokens, key) {
    const ks = keyScale(key);
    if (ks) {
      const hit = ks.find((n) => notePc(n) === pc);
      if (hit) return hit;
    }
    const opts = rootSpellings(pc);
    let best = null; let bestScore = Infinity;
    for (const r of opts) {
      const notes = tokens.map((t) => transpose(r, iv(t)));
      let sc = notes.reduce((a, n) => a + Math.abs(n.acc) + (Math.abs(n.acc) > 1 ? 10 : 0), 0) + (Math.abs(r.acc) > 0 && (r.letter === 2 || r.letter === 6 || r.letter === 3 || r.letter === 0) && r.acc !== 0 && NATURAL_PC[r.letter] !== pc ? 0 : 0);
      // avoid E#, B#, Fb, Cb as roots unless forced by key
      if ((r.letter === 2 && r.acc === 1) || (r.letter === 6 && r.acc === 1) || (r.letter === 3 && r.acc === -1) || (r.letter === 0 && r.acc === -1)) sc += 20;
      if (ks) { const keyFlat = ks.some((n) => n.acc < 0); const keySharp = ks.some((n) => n.acc > 0); if (keyFlat && r.acc > 0) sc += 3; if (keySharp && r.acc < 0) sc += 3; }
      else if (sc === bestScore && SPELL_PREF[pc] === r.acc) sc -= 0.5;
      if (!ks && SPELL_PREF[pc] === r.acc) sc -= 0.25;
      if (sc < bestScore) { bestScore = sc; best = r; }
    }
    return best;
  }

  // notes: array of pitch classes or midi numbers; bass: pitch class of lowest sounding note (optional; defaults to first)
  function nameChord(pcsIn, opts) {
    opts = opts || {};
    const pcs = [...new Set(pcsIn.map((p) => mod(p, 12)))];
    if (pcs.length === 0) return { kind: 'empty', candidates: [] };
    const bass = opts.bass != null ? mod(opts.bass, 12) : mod(pcsIn[0], 12);
    const key = opts.key || null;
    const ks = keyScale(key);
    const keyPcs = ks ? new Set(ks.map(notePc)) : null;
    if (pcs.length === 1) {
      const n = spellChordRoot(pcs[0], ['1'], key);
      return { kind: 'note', note: n, text: noteName(n, { unicode: true }) + ' on its own. Add more notes to make a chord.', candidates: [] };
    }
    const cands = [];
    const consider = (set, bassPc, penalty, slashNonChord) => {
      for (const root of set) {
        const rel = new Set(set.map((p) => mod(p - root, 12)));
        for (const t of TEMPLATES) {
          const tPcs = new Map();
          for (const i of t.tones) tPcs.set(mod(i.semis, 12), i.token);
          if (tPcs.size !== t.tones.length) continue;
          let ok = true;
          for (const r of rel) if (!tPcs.has(r)) { ok = false; break; }
          if (!ok) continue;
          let missing = [];
          for (const [p, tok] of tPcs) if (!rel.has(p)) { if (!t.opt.has(tok)) { ok = false; break; } missing.push(tok); }
          if (!ok) continue;
          // need at least 3 sounding notes for anything other than power chord / bare triad with omitted 5th
          if (rel.size < 3 && t.suffix !== '5' && !(t.suffix === '' || t.suffix === 'm')) continue;
          const tokens = t.tones.map((x) => x.token);
          let score = t.prior - missing.length * 20 - penalty + (missing.length ? 0 : 5);
          if (root === bassPc && !slashNonChord) score += 22;
          if (keyPcs) {
            if (keyPcs.has(root)) score += 15;
            if ([...rel].every((r) => keyPcs.has(mod(r + root, 12)))) score += 20;
            // a diminished 7th in a key works as vii°7: its root is the leading tone
            if (t.suffix === 'dim7' && root === mod(notePc(key.tonic) - 1, 12)) score += 40;
          }
          score -= t.suffix.length * 0.3;
          const rootNote = spellChordRoot(root, tokens, key);
          const tones = t.tones.filter((x) => !missing.includes(x.token)).map((x) => ({ token: x.token, role: roleOf(x.token), note: transpose(rootNote, x), pc: mod(root + x.semis, 12) }));
          const bassTone = tones.find((x) => x.pc === bass);
          let inversion = null; let slash = null;
          if (bass !== root) {
            if (bassTone) {
              const num = iv(bassTone.token).num;
              inversion = num === 3 ? 'first inversion' : num === 5 ? 'second inversion' : num === 7 ? 'third inversion' : null;
              slash = Math.abs(bassTone.note.acc) > 1 ? spellChordRoot(bass, ['1'], key) : bassTone.note;
            } else {
              slash = spellChordRoot(bass, ['1'], key);
            }
          }
          const name = noteName(rootNote, { unicode: true }) + prettySuffix(t.suffix) + (slash ? '/' + noteName(slash, { unicode: true }) : '');
          cands.push({ root: rootNote, rootPc: root, suffix: t.suffix, name, score, missing, tones, inversion, slash, bassNonChord: !!(slash && !bassTone), template: t });
        }
      }
    };
    consider(pcs, bass, 0, false);
    if (pcs.length >= 3) {
      const without = pcs.filter((p) => p !== bass);
      if (without.length >= 3) consider(without, bass, 28, true);
    }
    // dedupe by name keep best
    const byName = new Map();
    for (const c of cands) { const k = c.name; if (!byName.has(k) || byName.get(k).score < c.score) byName.set(k, c); }
    const list = [...byName.values()].sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    for (const c of list) c.explanation = explain(c, bass);
    if (!list.length) {
      const names = pcs.map((p) => noteName(spellChordRoot(p, ['1'], key), { unicode: true }));
      return { kind: 'none', candidates: [], text: 'No standard chord name fits ' + names.join(', ') + '. ' + (isCluster(pcs) ? 'These notes are bunched together a half or whole step apart, which is a cluster rather than a chord.' : 'Try removing a note, or it may be a passing sound between chords.') };
    }
    const top = list[0];
    // Alternatives: close scores, plus any full re-reading of exactly the same notes with another root
    // (C6 vs Am7, the four dim7 roots, the three aug roots, sus2 vs sus4).
    const alts = list.slice(1).filter((c) => (top.score - c.score <= 25) || (!c.missing.length && !c.bassNonChord && c.tones.length === pcs.length && c.rootPc !== top.rootPc)).slice(0, 3);
    let intervalText = null;
    if (pcs.length === 2) {
      const other = pcs.find((p) => p !== bass);
      intervalText = 'Two notes, a ' + SIMPLE_INTERVAL_NAMES[mod(other - bass, 12)] + ' apart.';
    }
    return { kind: 'chord', best: top, alternatives: alts, candidates: list, intervalText };
  }
  function isCluster(pcs) {
    const s = [...pcs].sort((a, b) => a - b);
    let small = 0;
    for (let i = 0; i < s.length; i++) { const d = mod(s[(i + 1) % s.length] - s[i], 12); if (d <= 2) small++; }
    return small >= s.length - 1;
  }

  function prettySuffix(s) {
    return s.replace(/b(?=\d)/g, '♭').replace(/#/g, '♯');
  }

  function explain(c, bassPc) {
    const notes = c.tones.map((t) => noteName(t.note, { unicode: true }));
    let s = c.name.split('/')[0] + ' is ' + c.template.desc;
    s += ' Notes: ' + c.tones.map((t) => noteName(t.note, { unicode: true }) + ' (' + t.role + ')').join(', ') + '.';
    if (c.missing.includes('5')) s += ' The 5th is left out, which is common and does not change the chord\u2019s name.';
    else if (c.missing.length) s += ' Left out: ' + c.missing.map(roleOf).join(', ') + '.';
    if (c.slash) {
      if (c.inversion) s += ' ' + noteName(c.slash, { unicode: true }) + ' is in the bass, so it is in ' + c.inversion + '.';
      else if (c.bassNonChord) s += ' The bass note ' + noteName(c.slash, { unicode: true }) + ' is not part of the chord, so it is written after a slash.';
      else s += ' ' + noteName(c.slash, { unicode: true }) + ' is in the bass instead of the root.';
    }
    void notes; void bassPc;
    return s;
  }

  // ---------- scales ----------
  const SCALES = {
    major: { name: 'Major', tones: '1 2 3 4 5 6 7', desc: 'The do-re-mi scale. Bright and familiar.' },
    minor: { name: 'Natural minor', tones: '1 2 b3 4 5 b6 b7', desc: 'The plain minor scale, also called Aeolian. Sad or serious.' },
    dorian: { name: 'Dorian', tones: '1 2 b3 4 5 6 b7', desc: 'Minor with a raised 6th. A brighter, soulful minor.' },
    phrygian: { name: 'Phrygian', tones: '1 b2 b3 4 5 b6 b7', desc: 'Minor with a lowered 2nd. Dark, with a Spanish flavour.' },
    lydian: { name: 'Lydian', tones: '1 2 3 #4 5 6 7', desc: 'Major with a raised 4th. Floating and dreamy.' },
    mixolydian: { name: 'Mixolydian', tones: '1 2 3 4 5 6 b7', desc: 'Major with a lowered 7th. Rock and folk sound.' },
    locrian: { name: 'Locrian', tones: '1 b2 b3 4 b5 b6 b7', desc: 'Minor with a lowered 2nd and 5th. Unstable, rarely a home key.' },
    harmonicMinor: { name: 'Harmonic minor', tones: '1 2 b3 4 5 b6 7', desc: 'Natural minor with a raised 7th, giving a strong pull home.' },
    melodicMinor: { name: 'Melodic minor', tones: '1 2 b3 4 5 6 7', desc: 'Minor with a raised 6th and 7th (the jazz form, same going up and down).' },
    majorPentatonic: { name: 'Major pentatonic', tones: '1 2 3 5 6', desc: 'Five notes of the major scale, no half steps. Hard to play a wrong note.' },
    minorPentatonic: { name: 'Minor pentatonic', tones: '1 b3 4 5 b7', desc: 'The go-to scale for rock and blues solos.' },
    blues: { name: 'Blues', tones: '1 b3 4 b5 5 b7', desc: 'Minor pentatonic plus the flat 5th "blue note".' },
  };
  for (const k in SCALES) SCALES[k].intervals = SCALES[k].tones.split(' ').map(iv);
  SCALES.aeolian = SCALES.minor; SCALES.ionian = SCALES.major;
  function scaleNotes(tonic, type) {
    const t = typeof tonic === 'string' ? parseNote(tonic) : tonic;
    const sc = SCALES[type];
    if (!t || !sc) return null;
    return sc.intervals.map((i) => transpose(t, i));
  }
  function stepPattern(type) {
    const sc = SCALES[type];
    const semis = sc.intervals.map((i) => i.semis).concat(12);
    const out = [];
    for (let i = 1; i < semis.length; i++) { const d = semis[i] - semis[i - 1]; out.push(d === 1 ? 'H' : d === 2 ? 'W' : d === 3 ? 'W+H' : String(d)); }
    return out;
  }
  // Pick spelling for a tonic pitch class with fewest accidentals for the given scale.
  function bestTonic(pc, type) {
    let best = null; let bs = Infinity;
    for (const r of rootSpellings(pc)) {
      const ns = scaleNotes(r, type);
      let sc = ns.reduce((a, n) => a + Math.abs(n.acc) + (Math.abs(n.acc) > 1 ? 10 : 0), 0);
      if (SPELL_PREF[pc] === r.acc) sc -= 0.1;
      if (sc < bs) { bs = sc; best = r; }
    }
    return best;
  }

  // ---------- diatonic chords ----------
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const FUNCTIONS = {
    major: [
      'Tonic. Home base. Songs usually start and end here.',
      'Predominant. Leads naturally to V.',
      'Mediant. A softer stand-in for I.',
      'Subdominant. Moves away from home, often to V or back to I.',
      'Dominant. Strong pull back home to I.',
      'Relative minor. The sad twin of I, often used instead of it.',
      'Leading-tone chord. Acts like V and resolves to I.',
    ],
    minor: [
      'Tonic. Home base of the minor key.',
      'Predominant. Leads to V or v.',
      'Relative major. The bright twin of i.',
      'Subdominant. Moves away from home, often to V.',
      'Minor dominant. A gentle pull home. The major V from harmonic minor pulls harder.',
      'Submediant. Warm, often follows i or leads to VII.',
      'Subtonic. A whole step below home, common in rock and folk.',
    ],
  };
  function diatonicChords(tonic, mode, sevenths) {
    const type = mode === 'minor' ? 'minor' : 'major';
    const ns = scaleNotes(tonic, type);
    const out = [];
    for (let d = 0; d < 7; d++) {
      const chordNotes = [ns[d], ns[(d + 2) % 7], ns[(d + 4) % 7]];
      if (sevenths) chordNotes.push(ns[(d + 6) % 7]);
      out.push(buildDiatonic(chordNotes, d, sevenths, FUNCTIONS[type][d]));
    }
    let extra = null;
    if (type === 'minor') {
      const hm = scaleNotes(tonic, 'harmonicMinor');
      const cn = [hm[4], hm[6], hm[1]]; if (sevenths) cn.push(hm[3]);
      extra = buildDiatonic(cn, 4, sevenths, 'Major dominant borrowed from harmonic minor (raised 7th). The usual way to pull back to i.');
      extra.borrowed = 'harmonic minor';
    }
    return { notes: ns, chords: out, extra };
  }
  function buildDiatonic(chordNotes, d, sevenths, fn) {
    const root = chordNotes[0];
    const tokens = chordNotes.map((n) => { const i = intervalBetween(root, n); return tokenFor(i); });
    const rel = tokens.join(' ');
    const map = { '1 3 5': '', '1 b3 5': 'm', '1 b3 b5': 'dim', '1 3 #5': 'aug', '1 3 5 7': 'maj7', '1 b3 5 b7': 'm7', '1 3 5 b7': '7', '1 b3 b5 b7': 'm7b5', '1 b3 b5 bb7': 'dim7', '1 b3 5 7': 'm(maj7)', '1 3 #5 7': 'maj7#5' };
    const suffix = map[rel];
    const minorish = tokens[1] === 'b3';
    let rn = ROMAN[d];
    if (minorish) rn = rn.toLowerCase();
    if (suffix === 'dim') rn += '°';
    if (suffix === 'aug') rn += '+';
    if (sevenths) {
      if (suffix === 'maj7') rn += 'maj7';
      else if (suffix === 'm7b5') rn += 'ø7';
      else if (suffix === 'dim7') rn += '°7';
      else if (suffix === 'm(maj7)') rn += '(maj7)';
      else if (suffix === 'maj7#5') rn += '+maj7';
      else rn += '7';
    }
    return { degree: d + 1, roman: rn, root, notes: chordNotes, suffix, symbol: noteName(root) + suffix, name: noteName(root, { unicode: true }) + prettySuffix(suffix), function: fn };
  }
  function tokenFor(i) {
    const d = i.semis - BASE_SEMIS[i.num];
    const pre = d === -2 ? 'bb' : d === -1 ? 'b' : d === 1 ? '#' : '';
    return pre + i.num;
  }

  const PROGRESSIONS = {
    major: [
      { name: 'Pop', degrees: [1, 5, 6, 4], label: 'I – V – vi – IV' },
      { name: 'Doo-wop', degrees: [1, 6, 4, 5], label: 'I – vi – IV – V' },
      { name: 'Jazz ii–V–I (with 7ths)', degrees: [2, 5, 1], label: 'ii – V – I', sevenths: true },
      { name: 'Sad pop', degrees: [6, 4, 1, 5], label: 'vi – IV – I – V' },
      { name: '12-bar blues (with 7ths)', degrees: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5], label: 'I I I I – IV IV I I – V IV I V', dominant: true },
    ],
    minor: [
      { name: 'Epic minor', degrees: [1, 6, 3, 7], label: 'i – VI – III – VII' },
      { name: 'Minor cadence', degrees: [1, 4, 'V'], label: 'i – iv – V' },
      { name: 'Andalusian', degrees: [1, 7, 6, 'V'], label: 'i – VII – VI – V' },
    ],
  };

  const KEY_TONICS = {
    major: ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'],
    minor: ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab'],
  };

  // ---------- suggestions for the chord search box ----------
  const COMMON_SUFFIXES = ['', 'm', '7', 'maj7', 'm7', 'sus4', 'sus2', 'add9', '6', 'm6', '9', 'dim', 'dim7', 'm7b5', 'aug', '7sus4', 'm9', 'maj9', '13', '5'];
  const COMMON_ROOTS = ['C', 'G', 'D', 'A', 'E', 'F', 'Am', 'Em', 'Dm', 'Bb', 'B7', 'Cmaj7'];
  function suggestChords(input, limit) {
    limit = limit || 8;
    const raw = (input || '').trim();
    if (!raw) return COMMON_ROOTS.slice(0, limit);
    const out = [];
    const push = (sym) => { if (sym && !out.includes(sym) && parseChord(sym)) out.push(sym); };
    const full = parseChord(raw);
    if (full) push(full.symbol);
    const norm = normalizeSymbol(raw);
    const rm = /^([A-Ga-g])(##|bb|#|b)?/.exec(norm);
    if (!rm) return out.slice(0, limit);
    const root = rm[1].toUpperCase() + (rm[2] || '');
    const rest = norm.slice(rm[0].length);
    if (rest.includes('/')) return out.slice(0, limit);
    const restLow = rest.toLowerCase();
    for (const suf of COMMON_SUFFIXES) {
      if (rest === 'm' && suf.startsWith('maj')) continue;
      if (rest === '' || suf.toLowerCase().startsWith(restLow) || (rest === 'min' && suf.startsWith('m') && !suf.startsWith('maj'))) push(root + suf);
      if (out.length >= limit) break;
    }
    if (rest === '' && rm[2] == null && root !== 'B' && out.length < limit) { push(root + '#'); push(root + 'b'); }
    return out.slice(0, limit);
  }

  const Theory = {
    suggestChords, normalizeSymbol,
    LETTERS, parseNote, notePc, noteName, iv, intervalName, intervalBetween, transpose, SIMPLE_INTERVAL_NAMES,
    parseChord, nameChord, TEMPLATES, TEMPLATE_BY_SUFFIX, roleOf, prettySuffix, spellChordRoot,
    SCALES, scaleNotes, stepPattern, bestTonic, diatonicChords, PROGRESSIONS, KEY_TONICS, mod,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Theory;
  else global.Theory = Theory;
})(typeof globalThis !== 'undefined' ? globalThis : this);

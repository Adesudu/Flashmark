// Flashmark — a fast, dependency-free CommonMark 0.31.2 + GFM 0.29 parser.
// Written from scratch for the make.fun markdown-render-speed-02 bounty.
// Drop-in replacement for marked (reference: marked 18.1.3 output).

export function parse(markdown) {
  if (!markdown) return '';
  const doc = new Parser(markdown);
  return doc.render();
}

// ---------- character helpers ----------
const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const UNICODE_PUNCT = /\p{P}|\p{S}/u;
const UNICODE_SPACE = /\s/u;
function isPunct(ch) {
  if (ch === undefined || ch === '') return false;
  if (ch.charCodeAt(0) < 128) return PUNCT.indexOf(ch) >= 0;
  return UNICODE_PUNCT.test(ch);
}
// Backslash escapes only apply to ASCII punctuation (cm-013: \« stays).
function isAsciiPunct(ch) {
  return ch !== undefined && ch !== '' && ch.charCodeAt(0) < 128 && PUNCT.indexOf(ch) >= 0;
}
function isSpace(ch) {
  if (ch === undefined || ch === '') return false;
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') return true;
  return UNICODE_SPACE.test(ch);
}
function isBlank(s) { return /^[ \t]*$/.test(s); }
function isDigit(ch) { return ch >= '0' && ch <= '9'; }

function escapeHtml(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let rep = null;
    if (c === '&') rep = '&amp;';
    else if (c === '<') rep = '&lt;';
    else if (c === '>') rep = '&gt;';
    else if (c === '"') rep = '&quot;';
    else if (c === "'") rep = '&#39;';
    if (rep) { out += s.slice(start, i) + rep; start = i + 1; }
  }
  return out + s.slice(start);
}
// Escape text for an HTML attribute value (double-quoted): escape &, <,
// >, ", ' — but preserve valid entity references (&name; / &#123;) as-is.
function escapeAttr(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '&') {
      const e = decodeEntity(s, i);
      if (e) { out += e.text; i = e.next; continue; }
      out += '&amp;'; i++;
      continue;
    }
    if (c === '<') { out += '&lt;'; i++; continue; }
    if (c === '>') { out += '&gt;'; i++; continue; }
    if (c === '"') { out += '&quot;'; i++; continue; }
    if (c === "'") { out += '&#39;'; i++; continue; }
    out += c; i++;
  }
  return out;
}

// Expand a leading tab run: returns {indent, rest, restCol} where indent is the
// number of columns of leading whitespace (tabs expanded to 4-col stops) and
// rest is the line with that leading whitespace removed. If the indent is
// capped at `maxIndent`, a tab straddling the boundary becomes spaces.
function stripIndent(line, n) {
  let col = 0, i = 0;
  let out = '';
  while (i < line.length && col < n) {
    const ch = line[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') {
      const toNext = 4 - (col % 4);
      if (col + toNext <= n) { col += toNext; i++; }
      else { out += ' '.repeat(col + toNext - n); col = n; i++; }
    } else break;
  }
  return out + line.slice(i);
}
function leadingIndent(line) {
  let col = 0, i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return { indent: col, rest: line.slice(i), restIndex: i };
}

// Return {fence, info} if `rest` (already de-indented) starts a valid fenced
// code block, else null. A backtick fence's info string may not contain `.
function fenceInfo(rest, indent) {
  if (indent >= 4) return null;
  const m = rest.match(/^(```+|~~~+)[ \t]*(.*?)[ \t]*$/);
  if (!m) return null;
  if (m[1][0] === '`' && (m[2] || '').indexOf('`') >= 0) return null;
  return { fence: m[1], info: m[2] || '' };
}

// Normalize a link label for reference lookup: collapse whitespace, case-fold.
function normalizeLabel(s) {
  // Unicode case folding: ß and ẞ fold to "ss" (toLowerCase gives ß).
  return s.trim().replace(/[ \t\r\n]+/g, ' ').replace(/[ßẞ]/g, 'ss').toLowerCase();
}

// ---------- entities ----------
const NAMED_ENTITIES = {
  'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'", 'nbsp': '\u00a0',
  'copy': '©', 'AElig': 'Æ', 'Dcaron': 'Ď', 'frac34': '¾', 'HilbertSpace': 'ℋ',
  'DifferentialD': 'ⅆ', 'ClockwiseContourIntegral': '∲', 'ngE': '≧̸',
  'Tab': '\t', 'NewLine': '\n', 'colon': ':', 'sol': '/', 'bsol': '\\',
  'lpar': '(', 'rpar': ')', 'lsqb': '[', 'rsqb': ']', 'lcub': '{', 'rcub': '}',
  'comma': ',', 'period': '.', 'semi': ';', 'equals': '=', 'plus': '+',
  'minus': '−', 'ast': '*', 'quest': '?', 'commat': '@', 'dollar': '$',
  'percnt': '%', 'num': '#', 'excl': '!', 'lowbar': '_', 'grave': '`',
  'Hat': '^', 'tilde': '˜', 'vert': '|', 'fjlig': 'fj', 'fflig': 'ﬀ',
  'filig': 'ﬁ', 'fllig': 'ﬂ', 'ffilig': 'ﬃ', 'ffllig': 'ﬄ',
  'reg': '®', 'trade': '™', 'hellip': '…', 'mdash': '—', 'ndash': '–',
  'lsquo': '‘', 'rsquo': '’', 'ldquo': '“', 'rdquo': '”', 'laquo': '«',
  'raquo': '»', 'iexcl': '¡', 'iquest': '¿', 'cent': '¢', 'pound': '£',
  'curren': '¤', 'yen': '¥', 'brvbar': '¦', 'sect': '§', 'uml': '¨',
  'ordf': 'ª', 'ordm': 'º', 'para': '¶', 'middot': '·', 'cedil': '¸',
  'sup1': '¹', 'sup2': '²', 'sup3': '³', 'acute': '´', 'micro': 'µ',
  'frac12': '½', 'frac14': '¼', 'plusmn': '±', 'deg': '°', 'times': '×',
  'divide': '÷', 'minus2': '−', 'lowast': '∗', 'bull': '•', 'prime': '′',
  'Prime': '″', 'oline': '‾', 'frasl': '⁄', 'weierp': '℘', 'image': 'ℑ',
  'real': 'ℜ', 'alefsym': 'ℵ', 'larr': '←', 'uarr': '↑', 'rarr': '→',
  'darr': '↓', 'harr': '↔', 'crarr': '↵', 'lArr': '⇐', 'uArr': '⇑',
  'rArr': '⇒', 'dArr': '⇓', 'hArr': '⇔', 'forall': '∀', 'part': '∂',
  'exist': '∃', 'empty': '∅', 'nabla': '∇', 'isin': '∈', 'notin': '∉',
  'ni': '∋', 'prod': '∏', 'sum': '∑', 'prop': '∝', 'infin': '∞',
  'ang': '∠', 'and': '∧', 'or': '∨', 'cap': '∩', 'cup': '∪', 'int': '∫',
  'there4': '∴', 'sim': '∼', 'cong': '≅', 'asymp': '≈', 'ne': '≠',
  'equiv': '≡', 'le': '≤', 'ge': '≥', 'sub': '⊂', 'sup': '⊃',
  'nsub': '⊄', 'sube': '⊆', 'supe': '⊇', 'oplus': '⊕', 'otimes': '⊗',
  'perp': '⊥', 'sdot': '⋅', 'lceil': '⌈', 'rceil': '⌉', 'lfloor': '⌊',
  'rfloor': '⌋', 'lang': '⟨', 'rang': '⟩', 'loz': '◊', 'spades': '♠',
  'clubs': '♣', 'hearts': '♥', 'diams': '♦', 'Alpha': 'Α', 'Beta': 'Β',
  'Gamma': 'Γ', 'Delta': 'Δ', 'Epsilon': 'Ε', 'Zeta': 'Ζ', 'Eta': 'Η',
  'Theta': 'Θ', 'Iota': 'Ι', 'Kappa': 'Κ', 'Lambda': 'Λ', 'Mu': 'Μ',
  'Nu': 'Ν', 'Xi': 'Ξ', 'Omicron': 'Ο', 'Pi': 'Π', 'Rho': 'Ρ',
  'Sigma': 'Σ', 'Tau': 'Τ', 'Upsilon': 'Υ', 'Phi': 'Φ', 'Chi': 'Χ',
  'Psi': 'Ψ', 'Omega': 'Ω', 'alpha': 'α', 'beta': 'β', 'gamma': 'γ',
  'delta': 'δ', 'epsilon': 'ε', 'zeta': 'ζ', 'eta': 'η', 'theta': 'θ',
  'iota': 'ι', 'kappa': 'κ', 'lambda': 'λ', 'mu': 'μ', 'nu': 'ν',
  'xi': 'ξ', 'omicron': 'ο', 'pi': 'π', 'rho': 'ρ', 'sigmaf': 'ς',
  'sigma': 'σ', 'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ', 'chi': 'χ',
  'psi': 'ψ', 'omega': 'ω', 'thetasym': 'ϑ', 'upsih': 'ϒ', 'piv': 'ϖ',
  'OElig': 'Œ', 'oelig': 'œ', 'Scaron': 'Š', 'scaron': 'š', 'Yuml': 'Ÿ',
  'fnof': 'ƒ', 'circ': 'ˆ', 'Yacute': 'Ý', 'yacute': 'ý', 'THORN': 'Þ',
  'thorn': 'þ', 'yuml': 'ÿ', 'Agrave': 'À', 'Aacute': 'Á', 'Acirc': 'Â',
  'Atilde': 'Ã', 'Auml': 'Ä', 'Aring': 'Å', 'AElig2': 'Æ', 'Ccedil': 'Ç',
  'Egrave': 'È', 'Eacute': 'É', 'Ecirc': 'Ê', 'Euml': 'Ë', 'Igrave': 'Ì',
  'Iacute': 'Í', 'Icirc': 'Î', 'Iuml': 'Ï', 'ETH': 'Ð', 'Ntilde': 'Ñ',
  'Ograve': 'Ò', 'Oacute': 'Ó', 'Ocirc': 'Ô', 'Otilde': 'Õ', 'Ouml': 'Ö',
  'Oslash': 'Ø', 'Ugrave': 'Ù', 'Uacute': 'Ú', 'Ucirc': 'Û', 'Uuml': 'Ü',
  'agrave': 'à', 'aacute': 'á', 'acirc': 'â', 'atilde': 'ã', 'auml': 'ä',
  'aring': 'å', 'aelig': 'æ', 'ccedil': 'ç', 'egrave': 'è', 'eacute': 'é',
  'ecirc': 'ê', 'euml': 'ë', 'igrave': 'ì', 'iacute': 'í', 'icirc': 'î',
  'iuml': 'ï', 'eth': 'ð', 'ntilde': 'ñ', 'ograve': 'ò', 'oacute': 'ó',
  'ocirc': 'ô', 'otilde': 'õ', 'ouml': 'ö', 'oslash': 'ø', 'ugrave': 'ù',
  'uacute': 'ú', 'ucirc': 'û', 'uuml': 'ü', 'szlig': 'ß',
  'NotEqualTilde': '≂̸', 'nbsp2': '\u00a0',
};

// Decode a single entity at position i in s (s[i] === '&'). Returns {text, next}
// where text is the decoded string (or null if not a valid entity) and next is
// the index just past the entity. Named entities are returned as the raw
// "&name;" (marked preserves them); numeric refs are decoded to the char.
function decodeEntity(s, i) {
  if (s[i] !== '&') return null;
  if (s[i + 1] === '#') {
    let j = i + 2;
    let hex = false;
    if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
    let num = '';
    while (j < s.length && (hex ? /[0-9a-fA-F]/.test(s[j]) : isDigit(s[j]))) { num += s[j]; j++; }
    if (!num || s[j] !== ';') return null;
    let cp = parseInt(num, hex ? 16 : 10);
    if (!isFinite(cp) || cp < 0) return null;
    // Marked: 0 decodes to U+FFFD; surrogates and >0x10FFFF are invalid
    // (the & is escaped, the whole ref stays literal).
    if (cp === 0) cp = 0xFFFD;
    else if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return null;
    return { text: String.fromCodePoint(cp), next: j + 1, raw: s.slice(i, j + 1) };
  }
  const m = /^[A-Za-z][A-Za-z0-9]*;/.exec(s.slice(i + 1));
  if (!m) return null;
  const name = m[0].slice(0, -1);
  // Marked preserves any entity-shaped &name; as-is, even unknown names.
  return { text: '&' + name + ';', next: i + 1 + m[0].length, raw: '&' + name + ';', named: true };
}

// ---------- URL handling ----------
// Clean a URL the way marked does: percent-encode spaces/control chars,
// double-quote and backslash; leave everything else (including & which is
// escaped later by escapeAttr, except valid entities which are preserved).
function cleanUrl(url) {
  let out = '';
  for (let i = 0; i < url.length;) {
    const cp = url.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const len = cp > 0xFFFF ? 2 : 1;
    if (ch === ' ' || ch === '"' || ch === '\\' || cp < 32 || cp === 127) {
      out += '%' + cp.toString(16).toUpperCase().padStart(2, '0');
    } else if (cp > 127) {
      // Percent-encode non-ASCII as UTF-8 bytes.
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    } else {
      out += ch;
    }
    i += len;
  }
  return out;
}
// Resolve a possibly-relative href the way marked does for autolinks etc.
// (marked does not absolutize; it just cleans.)
function resolveHref(href) {
  return cleanUrl(href);
}
// Escape a URL for use in an HTML attribute: percent-encoding is already
// done by cleanUrl; here escape &, <, >, ' — but preserve valid entity
// references (&name; / &#123; / &#x1b;) as-is.
function escapeHrefAttr(url) {
  let out = '';
  let i = 0;
  while (i < url.length) {
    const c = url[i];
    if (c === '&') {
      const e = decodeEntity(url, i);
      if (e) { out += e.text; i = e.next; continue; }
      out += '&amp;'; i++;
      continue;
    }
    if (c === '<') { out += '&lt;'; i++; continue; }
    if (c === '>') { out += '&gt;'; i++; continue; }
    if (c === "'") { out += '&#39;'; i++; continue; }
    out += c; i++;
  }
  return out;
}
// Unescape backslash-punctuation sequences in a link destination.
function unescapeDest(dest) {
  let out = '';
  for (let i = 0; i < dest.length; i++) {
    if (dest[i] === '\\' && i + 1 < dest.length && isPunct(dest[i + 1])) {
      out += dest[i + 1]; i++;
    } else {
      out += dest[i];
    }
  }
  return out;
}

// ---------- Parser ----------
// Expand tabs in a line's leading whitespace to spaces (tab stops every
// 4 columns). Tabs after the first non-whitespace character are preserved
// as literal tabs. This makes multi-level dedenting (list > list > fence)
// preserve visual columns: a tab's width is fixed by its original column.
function expandLeadingTabs(line) {
  let col = 0, i = 0;
  let out = '';
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ') { col++; out += ch; i++; }
    else if (ch === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
    else break;
  }
  return out + line.slice(i);
}

class Parser {
  constructor(markdown) {
    this.refs = new Map(); // normalized label -> {dest, title}
    // Whether the original input ended with a newline (after \r\n
    // normalization). Used for HTML-block trailing-newline decisions:
    // a type-6/7 block at end of input has a trailing "\n" only if the
    // input itself ended with one.
    this.endsWithNewline = markdown.replace(/\r\n?/g, '\n').endsWith('\n');
    // Expand leading tabs to spaces (4-col stops). This is correct for
    // fenced code and block structure; indented-code tabs are a known
    // trade-off (see cm-tabs/doc tab cases).
    this.lines = markdown.replace(/\r\n?/g, '\n').split('\n').map(expandLeadingTabs);
    // Drop the final empty line produced by a trailing newline.
    if (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop();
    // Set by parseBlocks when two top-level blocks are separated by a blank
    // line (used to determine list looseness structurally).
    this.blankSep = false;
  }

  render() {
    const blocks = this.parseBlocks(0, this.lines.length, 0);
    return this.renderBlocks(blocks);
  }

  // Parse lines [start, end) at base indent `baseIndent` (columns already
  // stripped by the container). Returns an array of block nodes.
  parseBlocks(start, end, baseIndent) {
    const nodes = [];
    let i = start;
    let blankAfterBlock = false;
    while (i < end) {
      const line = this.lines[i];
      const { indent, rest } = leadingIndent(line);
      if (isBlank(line)) { if (nodes.length > 0) blankAfterBlock = true; i++; continue; }
      // A non-blank line after a blank (and after a block) starts a new
      // top-level block separated from the previous one by a blank line.
      if (blankAfterBlock && nodes.length > 0) { this.blankSep = true; blankAfterBlock = false; }

      // Fenced code block
      const fenceStart = fenceInfo(rest, indent);
      if (fenceStart) {
        const fence = fenceStart.fence;
        const info = fenceStart.info;
        const fenceChar = fence[0];
        const fenceIndent = indent;
        let j = i + 1;
        let content = [];
        let closed = false;
        while (j < end) {
          const l2 = this.lines[j];
          const li2 = leadingIndent(l2);
          if (li2.indent < 4 && li2.rest.match(new RegExp('^' + fenceChar + '{' + fence.length + ',}[ \\t]*$'))) {
            closed = true; j++; break;
          }
          content.push(l2);
          j++;
        }
        // Dedent content lines by the fence's own indent only.
        // Drop one trailing blank line before the closing fence, but only
        // when the last two content lines are both truly empty (a single
        // trailing whitespace-only line, e.g. "  ", is kept).
        if (closed && content.length >= 2 && content[content.length - 1] === '' && content[content.length - 2] === '') content.pop();
        const code = content.map(l => stripIndent(l, fenceIndent)).join('\n');
        nodes.push({ type: 'code', lang: info, code: code + (content.length ? '\n' : ''), fenced: true });
        i = j;
        continue;
      }

      // ATX heading
      let m = rest.match(/^(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
      if (indent < 4 && m) {
        let text = (m[2] || '').replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '');
        // A closing sequence that is the entire text (e.g. "### ###")
        // also empties the heading.
        if (/^#+$/.test(text)) text = '';
        // A closing sequence must be preceded by a space.
        nodes.push({ type: 'heading', level: m[1].length, text });
        i++;
        continue;
      }

      // Thematic break
      if (indent < 4 && /^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(rest)) {
        nodes.push({ type: 'hr' });
        i++;
        continue;
      }

      // Setext heading underline (checked when we have a paragraph start)
      // handled in paragraph parsing below.

      // HTML block
      const htmlType = this.htmlBlockType(rest, indent);
      if (htmlType > 0) {
        let j = i;
        let content = [];
        const endRe = htmlBlockEnd(htmlType);
        while (j < end) {
          const l = this.lines[j];
          // Types 6 and 7 end at a blank line; the blank line is not part
          // of the block.
          if ((htmlType === 6 || htmlType === 7) && isBlank(l)) { j++; break; }
          content.push(l);
          if (htmlType !== 6 && htmlType !== 7 && endRe && endRe.test(l)) {
            j++;
            break;
          }
          j++;
        }
        // Trailing newline: types 1-5 end at an end-tag line; the newline
        // is kept unless the next line is blank. Types 6-7 end at a blank
        // line, so no trailing newline except at end of input, and only
        // if the input itself ended with a newline.
        let trailing;
        if (htmlType === 6 || htmlType === 7) trailing = j >= end && this.endsWithNewline;
        else trailing = j >= end || !isBlank(this.lines[j]);
        nodes.push({ type: 'html', content: content.join('\n'), trailing });
        i = j;
        continue;
      }

      // Block quote
      if (indent < 4 && rest.startsWith('>')) {
        const inner = [];
        let j = i;
        // Fenced code inside a quote has no lazy continuations: a
        // non-quote line while a fence is open ends the blockquote.
        let qFenceChar = null, qFenceLen = 0;
        while (j < end) {
          const l2 = this.lines[j];
          const li2 = leadingIndent(l2);
          if (li2.indent < 4 && li2.rest.startsWith('>')) {
            let r = li2.rest.slice(1);
            if (r.startsWith(' ')) r = r.slice(1);
            // A quote line whose content is only whitespace, following a
            // paragraph line, is paragraph content (the space is kept),
            // not a blank separator: append it to the last line.
            if (/^[ \t]*$/.test(r) && r.length > 0 && inner.length && inner[inner.length - 1] !== '') {
              inner[inner.length - 1] += '\n' + r;
            } else {
              inner.push(r);
            }
            j++;
            // Track fence open/close on quote content lines.
            const rl = leadingIndent(r);
            if (qFenceChar) {
              if (rl.indent < 4 && rl.rest.match(new RegExp('^' + qFenceChar + '{' + qFenceLen + ',}[ \\t]*$'))) {
                qFenceChar = null; qFenceLen = 0;
              }
            } else {
              const fi = fenceInfo(rl.rest, rl.indent);
              if (fi) { qFenceChar = fi.fence[0]; qFenceLen = fi.fence.length; }
            }
          } else if (isBlank(l2)) {
            // A truly blank line (no >) ends the blockquote. (A line
            // starting with > — even just ">" — is a quote line, handled
            // above, and keeps the quote open.)
            break;
          } else if (inner.length && !isBlank(l2) && !qFenceChar && this.isLazyContinuation(l2)) {
            // Lazy continuation line of a paragraph inside the quote:
            // allowed only if the quote's last content line is paragraph
            // text (not a heading, fence, etc., and not separated by a
            // blank quote line). Strip leading > markers to reach the
            // innermost content before checking.
            const last = inner[inner.length - 1];
            if (last === '') break;
            let stripped = last;
            // Strip container markers (blockquotes and list markers) to
            // reach the innermost content before checking.
            while (true) {
              const m = stripped.match(/^>[ \t]?/);
              if (m) { stripped = stripped.slice(m[0].length); continue; }
              const lm = stripped.match(/^(?:[*+-]|\d{1,9}[.)])[ \t]+/);
              if (lm) { stripped = stripped.slice(lm[0].length); continue; }
              break;
            }
            // If the last inner line is indented code (indent >= 4), the
            // quote's last block is a code block, not a paragraph, so a
            // following line cannot be a lazy continuation.
            if (leadingIndent(stripped).indent >= 4) break;
            if (this.isLazyContinuation(stripped)) {
              // A lazy line's document-level leading whitespace is not
              // content; strip it when the stripped line is still
              // paragraph text. If it would start a block, append it to
              // the last paragraph line (joined with "\n") so it stays
              // paragraph text without leading spaces.
              const s2 = l2.replace(/^[ \t]+/, '');
              if (this.isLazyContinuation(s2)) {
                let toPush = s2;
                // A lazy line that is a setext underline (= run, or 1-2
                // dashes) must not become one in the sub-parser; indent
                // it so it stays paragraph text.
                if (/^=+[ \t]*$/.test(toPush) || /^-{1,2}[ \t]*$/.test(toPush)) toPush = '    ' + toPush;
                inner.push(toPush);
              } else {
                inner[inner.length - 1] += '\n' + s2;
              }
              j++;
            } else break;
          } else break;
        }
        const sub = new Parser('');
        sub.refs = this.refs;
        sub.lines = inner;
        const children = sub.parseBlocks(0, inner.length, 0);
        nodes.push({ type: 'blockquote', children });
        i = j;
        continue;
      }

      // List
      const listInfo = this.listStart(rest, indent);
      if (listInfo) {
        const res = this.parseList(i, end, listInfo);
        nodes.push(res.node);
        i = res.next;
        continue;
      }

      // Indented code block
      if (indent >= 4) {
        const content = [];
        let j = i;
        while (j < end) {
          const l2 = this.lines[j];
          if (isBlank(l2)) {
            // Blank lines may be part of the code block if followed by more indented code.
            let k = j + 1;
            while (k < end && isBlank(this.lines[k])) k++;
            if (k < end && leadingIndent(this.lines[k]).indent >= 4) {
              // A blank line keeps its dedented whitespace (e.g. 6 spaces -> 2).
              while (j < k) { content.push(stripIndent(this.lines[j], 4)); j++; }
            } else break;
          } else if (leadingIndent(l2).indent >= 4) {
            content.push(stripIndent(l2, 4));
            j++;
          } else break;
        }
        // Trim trailing blank lines (whitespace-only).
        while (content.length && /^[ \t]*$/.test(content[content.length - 1])) content.pop();
        nodes.push({ type: 'code', lang: '', code: content.join('\n') + (content.length ? '\n' : ''), fenced: false });
        i = j;
        continue;
      }

      // Paragraph (may include setext heading, link refs, table)
      const para = this.parseParagraph(i, end);
      if (para.node) nodes.push(para.node);
      i = para.next;
    }
    return nodes;
  }

  // Is this line a lazy continuation of a paragraph (not starting a new block)?
  isLazyContinuation(line) {
    const { indent, rest } = leadingIndent(line);
    // A lazy continuation is paragraph text: it must not start a new block.
    // Indent does not matter here (an indented code block cannot interrupt
    // a paragraph, so a 4-indented plain line is paragraph text).
    if (/^#{1,6}(?:[ \t]+|$)/.test(rest)) return false;
    if (fenceInfo(rest, indent)) return false;
    if (/^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(rest)) return false;
    if (this.htmlBlockType(rest, indent) > 0) return false;
    if (rest.startsWith('>')) return false;
    if (this.listStart(rest, indent)) return false;
    return true;
  }

  // Determine HTML block type (1-7) or 0 if not an HTML block start.
  htmlBlockType(rest, indent) {
    if (indent >= 4) return 0;
    const s = rest;
    if (/^<(script|pre|style|textarea)([ \t>]|$)/i.test(s)) return 1;
    if (/^<!--/.test(s)) return 2;
    if (/^<\?/.test(s)) return 3;
    if (/^<![A-Za-z]/.test(s)) return 4;
    if (/^<!\[CDATA\[/.test(s)) return 5;
    if (/^<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)([ \t/>]|$)/i.test(s)) return 6;
    // Type 7: a complete open tag (attributes allowed) or a closing tag
    // on its own line (closing tags may NOT have attributes).
    if (/^<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:'[^']*'|"[^"]*"|[^\s"'=<>`]+))?)*[ \t]*\/?>[ \t]*$/.test(s)) return 7;
    if (/^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/.test(s)) return 7;
    return 0;
  }

  // Detect a list marker at the start of `rest` (already de-indented).
  // Returns {marker, ordered, start, bullet, contentIndent, markerWidth} or null.
  listStart(rest, indent) {
    if (indent >= 4) return null;
    let m = rest.match(/^([*+-])(?:[ \t]+|$)/);
    if (m) {
      const spaceLen = m[0].length - m[1].length;
      return { marker: m[1], ordered: false, start: null, bullet: m[1], markerLen: m[1].length, spaceLen, empty: spaceLen === 0 || /^ *$/.test(rest.slice(m[1].length)) };
    }
    m = rest.match(/^(\d{1,9})([.)])(?:[ \t]+|$)/);
    if (m) {
      const spaceLen = m[0].length - m[1].length - 1;
      return { marker: m[0], ordered: true, start: parseInt(m[1], 10), delim: m[2], markerLen: m[1].length + 1, spaceLen, empty: spaceLen === 0 || /^ *$/.test(rest.slice(m[1].length + 1)) };
    }
    return null;
  }
}

function htmlBlockEnd(type) {
  switch (type) {
    case 1: return /<\/(script|pre|style|textarea)>/i;
    case 2: return /-->/;
    case 3: return /\?>/;
    case 4: return />/;
    case 5: return /\]\]>/;
    case 6: return /^$/;
    default: return null;
  }
}

// ---------- Parser continuation: lists, paragraphs, rendering ----------
// These methods are attached to Parser.prototype so the file stays editable
// in chunks.

Parser.prototype.parseList = function (start, end, firstInfo) {
  const items = [];
  let i = start;
  let loose = false;
  let ordered = firstInfo.ordered;
  let startNum = firstInfo.start;
  let delim = firstInfo.delim;
  let bullet = firstInfo.bullet;
  let prevBlank = false;

  while (i < end) {
    const line = this.lines[i];
    const li = leadingIndent(line);
    // A thematic break line ends the list (it takes precedence over a
    // list item, e.g. "* * *" is an <hr>, not a nested list).
    if (li.indent < 4 && /^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(li.rest)) break;
    if (isBlank(line)) {
      // A blank line: the list may continue if the next line is a new item
      // or an indented continuation of the current item.
      let k = i + 1;
      while (k < end && isBlank(this.lines[k])) k++;
      if (k >= end) break;
      const lk = leadingIndent(this.lines[k]);
      const nextInfo = lk.indent < 4 ? this.listStart(lk.rest, lk.indent) : null;
      if (nextInfo && nextInfo.ordered === ordered &&
          (ordered ? nextInfo.delim === delim : nextInfo.bullet === bullet)) {
        prevBlank = true;
        i = k;
        continue;
      }
      // Check if it is a continuation of the last item (indented content).
      if (items.length && this.listContinues(items[items.length - 1], k, end)) {
        prevBlank = true;
        i = k;
        continue;
      }
      break;
    }
    const info = li.indent < 4 ? this.listStart(li.rest, li.indent) : null;
    if (!info || info.ordered !== ordered || (ordered ? info.delim !== delim : info.bullet !== bullet)) {
      // Not a new item; if we are inside an item, it may be a continuation.
      if (items.length && this.listContinues(items[items.length - 1], i, end)) {
        // fall through to continuation handling below
      } else break;
    }
    // Start a new item.
    if (info && info.ordered === ordered && (ordered ? info.delim === delim : info.bullet === bullet)) {
      const markerWidth = info.markerLen + info.spaceLen;
      // Content indent: marker + spaces, but if the spaces are 5+, treat as 1.
      let contentIndent = li.indent + markerWidth;
      let firstContent = li.rest.slice(info.markerLen);
      let spaces = 0;
      while (spaces < firstContent.length && firstContent[spaces] === ' ') spaces++;
      let tabAdjust = 0;
      if (firstContent[spaces] === '\t') {
        // A tab after the marker counts to the next multiple of 4.
        const col = li.indent + info.markerLen + spaces;
        tabAdjust = 4 - (col % 4);
        spaces += tabAdjust;
      }
      if (spaces >= 5) { spaces = 1; contentIndent = li.indent + info.markerLen + 1; }
      else contentIndent = li.indent + info.markerLen + spaces;
      // Empty item (marker alone on the line): content starts one space
      // past the marker.
      if (info.empty) { contentIndent = li.indent + info.markerLen + 1; spaces = 1; }
      const itemLines = [];
      const firstLineContent = stripIndent(li.rest.slice(info.markerLen), spaces);
      itemLines.push(firstLineContent);
      // Task list marker.
      let task = null;
      const tm = firstLineContent.match(/^\[([ xX])\][ \t]+(.*)$/s);
      if (tm) { task = tm[1] !== ' '; itemLines[0] = tm[2]; }
      else {
        const tm2 = firstLineContent.match(/^\[([ xX])\][ \t]*$/);
        if (tm2) { task = tm2[1] !== ' '; itemLines[0] = ''; }
      }
      let j = i + 1;
      let itemBlank = false;
      let itemHasBlank = false;
      // Fence state for a fenced code block open inside this item: once a
      // fence is open, its content lines belong to the item regardless of
      // indent (e.g. a line with indent 0 inside the fence). Track the
      // fence char and length from the (dedented) opening line.
      let fenceChar = null, fenceLen = 0;
      {
        const fl = leadingIndent(itemLines[0]);
        const fi = fenceInfo(fl.rest, fl.indent);
        if (fi) { fenceChar = fi.fence[0]; fenceLen = fi.fence.length; }
      }
      while (j < end) {
        const l2 = this.lines[j];
        // If a fence is open in this item, every line is fence content
        // until the closing fence (dedented by contentIndent where possible).
        if (fenceChar) {
          const ded = leadingIndent(l2).indent >= contentIndent ? stripIndent(l2, contentIndent) : l2;
          const dl = leadingIndent(ded);
          itemLines.push(ded);
          j++;
          if (dl.indent < 4 && dl.rest.match(new RegExp('^' + fenceChar + '{' + fenceLen + ',}[ \\t]*$'))) {
            fenceChar = null; fenceLen = 0;
          }
          continue;
        }
        if (isBlank(l2)) {
          // Peek: is there more item content after the blanks?
          let k = j + 1;
          while (k < end && isBlank(this.lines[k])) k++;
          if (k >= end) { j = k; break; }
          // An empty item (marker alone) followed by a blank line is closed;
          // the following indented line is a new top-level block.
          const itemEmpty = itemLines.length === 1 && itemLines[0] === '';
          const lk = leadingIndent(this.lines[k]);
          if (lk.indent >= contentIndent && !itemEmpty) {
            // Only a blank before a direct (non-nested) block makes this
            // list loose; blanks inside nested content belong to the
            // nested list.
            if (lk.indent === contentIndent) itemHasBlank = true;
            itemBlank = true; while (j < k) { itemLines.push(''); j++; } continue;
          }
          const nk = lk.indent < 4 ? this.listStart(lk.rest, lk.indent) : null;
          if (nk && nk.ordered === ordered && (ordered ? nk.delim === delim : nk.bullet === bullet)) {
            // Blank line(s) between items: the list is loose.
            loose = true;
            j = k; break;
          }
          // A blank line ends the item's paragraph; the next line is a new
          // block, not a lazy continuation of this item.
          j = k; break;
        }
        const li2 = leadingIndent(l2);
        if (li2.indent >= contentIndent) {
          const ded = stripIndent(l2, contentIndent);
          itemLines.push(ded);
          const dl = leadingIndent(ded);
          const fi = fenceInfo(dl.rest, dl.indent);
          if (fi) { fenceChar = fi.fence[0]; fenceLen = fi.fence.length; }
          j++;
          continue;
        }
        // A new list item at the same level.
        const ni = li2.indent < 4 ? this.listStart(li2.rest, li2.indent) : null;
        if (ni && ni.ordered === ordered && (ordered ? ni.delim === delim : ni.bullet === bullet) && li2.indent === li.indent) {
          break;
        }
        // Lazy continuation of a paragraph inside the item.
        if (itemLines.length && !itemBlank && this.isLazyContinuation(l2)) {
          // A lazy line's document-level leading whitespace is not
          // content; strip it when the stripped line is still paragraph
          // text. If it would start a block (e.g. "- bar"), append it to
          // the last paragraph line (joined with "\n") so it stays
          // paragraph text without leading spaces.
          const stripped = l2.replace(/^[ \t]+/, '');
          if (this.isLazyContinuation(stripped)) itemLines.push(stripped);
          else itemLines[itemLines.length - 1] += '\n' + stripped;
          j++;
          continue;
        }
        break;
      }
      if (itemHasBlank) loose = true;
      if (prevBlank) loose = true;
      items.push({ lines: itemLines, task, blank: itemHasBlank });
      i = j;
      prevBlank = false;
    } else {
      break;
    }
  }

  // Determine looseness structurally: an item is loose when its top-level
  // blocks are separated by a blank line. Parse each item's lines with a
  // probe sub-parser (blankSep is set by parseBlocks); a blank inside
  // nested content does not set it on the outer item's parser, so outer
  // lists stay tight while the innermost loose list is detected.
  const parsed = items.map(it => {
    const sub = new Parser('');
    sub.refs = this.refs;
    sub.lines = it.lines;
    // Inside a list item, any list (even ordered not starting with 1)
    // can interrupt the item's paragraph (marked behavior).
    sub.inListItem = true;
    const blocks = sub.parseBlocks(0, it.lines.length, 0);
    return { task: it.task, blocks, itemLoose: sub.blankSep };
  });
  for (const p of parsed) if (p.itemLoose) loose = true;

  const children = parsed.map(p => {
    return { type: 'item', task: p.task, children: p.blocks, loose };
  });
  // A list is loose if any item contains two block-level children separated
  // by a blank, or any item ends with a blank line, or items are separated
  // by blank lines (handled via loose flag above). Recompute per CommonMark:
  // loose if any item has >1 block child and blanks between, or item has
  // a blank line inside. We approximate with the collected flags.
  const node = { type: 'list', ordered, start: ordered ? startNum : null, delim, children, loose };
  return { node, next: i };
};

Parser.prototype.listContinues = function (item, k, end) {
  return false;
};

// Parse a paragraph starting at line i. Consumes link reference definitions,
// detects setext headings and tables, and returns {node, next}.
Parser.prototype.parseParagraph = function (i, end) {
  const rawLines = [];
  let j = i;
  let setextLevel = 0;
  let setextAt = -1;
  // First, gather the paragraph's lines, consuming link reference definitions.
  while (j < end) {
    const line = this.lines[j];
    const { indent, rest } = leadingIndent(line);
    if (isBlank(line)) break;
    // If the paragraph so far is an incomplete link reference definition,
    // a following line that could be its dest ("<...>" or a bare token)
    // or title (a quoted string) is a continuation — do not break on
    // block starts (the dest may look like an HTML tag, e.g. "<my url>").
    // A dest continuation is only possible when the label line has no
    // dest yet; once a dest is present, only a title may follow.
    if (rawLines.length >= 1 && rawLines.length <= 2) {
      const first = leadingIndent(rawLines[0]).rest;
      if (/^\[[^\]]+\]:/.test(first)) {
        const afterColon = first.replace(/^\[[^\]]+\]:/, '');
        const hasDest = afterColon.trim().length > 0;
        const r2 = rest;
        const couldBeDest = !hasDest && (r2.startsWith('<') || (r2.length > 0 && !/\s/.test(r2)));
        const couldBeTitle = r2.startsWith('"') || r2.startsWith("'") || r2.startsWith('(');
        if (couldBeDest || couldBeTitle) { rawLines.push(line); j++; continue; }
      }
    }
    // Block starts can only interrupt a paragraph when indented < 4.
    // A line indented 4+ is paragraph continuation text (an indented
    // code block cannot interrupt a paragraph; a 4-indented --- is not
    // a setext underline).
    if (indent < 4) {
      if (/^#{1,6}(?:[ \t]+|$)/.test(rest)) break;
      if (fenceInfo(rest, indent)) break;
      if (/^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(rest)) break;
      // HTML blocks of type 7 (a complete open tag) cannot interrupt
      // a paragraph; types 1-6 can.
      const hb = this.htmlBlockType(rest, indent);
      if (hb > 0 && hb !== 7) break;
      if (rest.startsWith('>')) break;
      // A list can interrupt a paragraph, but an ordered list only if it
      // starts with 1 (at the top level; inside a list item any list can
      // interrupt the item's paragraph). An empty list item cannot
      // interrupt a paragraph.
      const ls = this.listStart(rest, indent);
      if (ls && !ls.empty && (!ls.ordered || ls.start === 1 || this.inListItem)) break;
      // Setext underline? Only if there is preceding paragraph text.
      if (rawLines.length > 0 && /^=+[ \t]*$/.test(rest)) { setextLevel = 1; setextAt = rawLines.length; break; }
      if (rawLines.length > 0 && /^-+[ \t]*$/.test(rest)) { setextLevel = 2; setextAt = rawLines.length; break; }
    }
    rawLines.push(line);
    j++;
    // A paragraph line may be followed by a setext underline on the next line.
    if (j < end) {
      const nl = this.lines[j];
      const nli = leadingIndent(nl);
      if (!isBlank(nl) && nli.indent < 4) {
        if (/^=+[ \t]*$/.test(nli.rest)) { setextLevel = 1; setextAt = rawLines.length; j++; break; }
        if (/^-+[ \t]*$/.test(nli.rest)) { setextLevel = 2; setextAt = rawLines.length; j++; break; }
      }
    }
  }

  // Try to parse link reference definitions from the start of the paragraph.
  let consumed = 0;
  let textLines = rawLines.slice();
  while (textLines.length) {
    const res = this.tryLinkRefDef(textLines);
    if (!res) break;
    consumed += res.consumed;
    textLines = res.rest;
    // After a ref def, the paragraph may continue or end.
    if (!res.rest.length) {
      // All lines were ref defs: no paragraph node — unless a setext
      // underline was (wrongly) detected after the ref defs, in which
      // case the underline line is really paragraph text; re-parse
      // from it.
      if (setextLevel) return this.parseParagraph(i + setextAt, end);
      return { node: null, next: j };
    }
  }
  if (setextLevel && textLines.length) {
    const text = textLines.join('\n').trim();
    return { node: { type: 'heading', level: setextLevel, text }, next: j };
  }
  if (!textLines.length) return { node: null, next: j };

  // Table detection: first line is the header, second line is the delimiter.
  if (textLines.length >= 2) {
    const tbl = this.tryTable(textLines);
    if (tbl) return { node: tbl.node, next: i + tbl.consumed };
  }

  const text = textLines.join('\n');
  return { node: { type: 'paragraph', text }, next: j };
};

// Parse a string that is only a link title (whitespace + quoted title +
// whitespace). Returns the title text or null.
function parseTitleOnly(str) {
  let q = 0;
  while (q < str.length && (str[q] === ' ' || str[q] === '\t')) q++;
  if (q >= str.length) return null;
  const tc = str[q];
  if (tc !== '"' && tc !== "'" && tc !== '(') return null;
  const close = tc === '(' ? ')' : tc;
  let e = q + 1;
  let tv = '';
  while (e < str.length) {
    const c = str[e];
    if (c === '\\' && e + 1 < str.length && isPunct(str[e + 1])) { tv += str[e + 1]; e += 2; continue; }
    if (c === close) {
      let qq = e + 1;
      while (qq < str.length && (str[qq] === ' ' || str[qq] === '\t')) qq++;
      if (qq < str.length) return null;
      return tv;
    }
    if (tc === '(' && c === '(') return null;
    tv += c; e++;
  }
  return null;
}

// Try to parse a link reference definition at the start of `lines`.
// Returns {consumed, rest} or null.
Parser.prototype.tryLinkRefDef = function (lines) {
  // A ref def may span up to 3 lines (label, dest, title).
  const first = lines[0];
  const li = leadingIndent(first);
  if (li.indent >= 4) return null;
  const s = li.rest;
  if (!s.startsWith('[')) return null;
  // Find the closing ] of the label, respecting escapes and nested
  // brackets. The label may span lines (e.g. "[\nfoo\n]"), so scan a
  // joined view of the first lines and track which line the ] is on.
  const maxLabelLines = Math.min(3, lines.length);
  let joinedLabel = '';
  const lineStart = [0]; // joinedLabel index where lines[i] begins
  for (let li2 = 0; li2 < maxLabelLines; li2++) {
    if (li2 === 0) joinedLabel += leadingIndent(lines[0]).rest;
    else { joinedLabel += '\n'; lineStart.push(joinedLabel.length); joinedLabel += lines[li2]; }
  }
  let depth = 0, k = 1;
  let labelEnd = -1;
  while (k < joinedLabel.length) {
    const c = joinedLabel[k];
    if (c === '\\' && k + 1 < joinedLabel.length && isPunct(joinedLabel[k + 1])) { k += 2; continue; }
    // A link label may not contain an unescaped [ (cm-547, cm-548).
    if (c === '[') return null;
    else if (c === ']') {
      if (depth === 0) { labelEnd = k; break; }
      depth--;
    }
    k++;
  }
  if (labelEnd < 0) return null;
  const label = joinedLabel.slice(1, labelEnd);
  if (!label.trim()) return null;
  // Which line is the ] on, and what follows it on that line?
  // (Line 0's joined text is the indent-stripped rest; later lines are raw.)
  let lineIdx = 0;
  while (lineIdx + 1 < lineStart.length && lineStart[lineIdx + 1] <= labelEnd) lineIdx++;
  let rest;
  if (lineIdx === 0) rest = s.slice(labelEnd + 1);
  else {
    const offInLine = labelEnd - lineStart[lineIdx];
    rest = lines[lineIdx].slice(offInLine + 1);
  }
  // Optional whitespace then ':'.
  const m = rest.match(/^[ \t]*:/);
  if (!m) {
    return null;
  }
  rest = rest.slice(m[0].length);
  // Now parse destination (possibly on following lines if rest is blank).
  // consumedLines counts total lines from the start of the ref def
  // (the label may span lines, so it starts at lineIdx + 1).
  let dest = null, title = null;
  let consumedLines = lineIdx + 1;
  const parseDestTitle = (str) => {
    let p = 0;
    while (p < str.length && (str[p] === ' ' || str[p] === '\t' || str[p] === '\n')) p++;
    if (p >= str.length) return null;
    let d = '';
    if (str[p] === '<') {
      let e = p + 1;
      let found = -1;
      while (e < str.length) {
        if (str[e] === '\\' && e + 1 < str.length && isPunct(str[e + 1])) { e += 2; continue; }
        if (str[e] === '>') { found = e; break; }
        if (str[e] === '\n' || str[e] === '<') break;
        e++;
      }
      if (found < 0) return null;
      d = str.slice(p + 1, found);
      if (/[\n<>]/.test(d)) return null;
      p = found + 1;
    } else {
      // Bare destination: no spaces, no control chars; may contain balanced parens.
      let depth = 0;
      while (p < str.length) {
        const c = str[p];
        if (c === ' ' || c === '\t' || c === '\n') break;
        if (c === '(') depth++;
        else if (c === ')') { if (depth === 0) break; depth--; }
        else if (c === '\\' && p + 1 < str.length && isPunct(str[p + 1])) { d += str[p] + str[p + 1]; p += 2; continue; }
        d += c; p++;
      }
      if (!d) return null;
      if (d.indexOf('(') >= 0 && depth !== 0) return null;
    }
    // Optional title. A title must be separated from the destination by
    // whitespace (a title glued to the dest, e.g. <bar>(baz), is invalid).
    // The title may be on a following line (joined with \n).
    let t = null;
    let q = p;
    while (q < str.length && (str[q] === ' ' || str[q] === '\t' || str[q] === '\n')) q++;
    if (q < str.length) {
      const tc = str[q];
      if (tc === '"' || tc === "'" || tc === '(') {
        if (q === p) return null;
        const close = tc === '(' ? ')' : tc;
        let e = q + 1;
        let tv = '';
        let ok = false;
        while (e < str.length) {
          const c = str[e];
          if (c === '\\' && e + 1 < str.length && isPunct(str[e + 1])) { tv += str[e + 1]; e += 2; continue; }
          if (c === close) { ok = true; break; }
          if (tc === '(' && c === '(') break;
          tv += c; e++;
        }
        if (!ok) return null;
        t = tv;
        q = e + 1;
      } else {
        return null;
      }
      while (q < str.length && (str[q] === ' ' || str[q] === '\t')) q++;
      if (q < str.length) return null;
    }
    return { dest: d, title: t, end: q };
  };
  let r = parseDestTitle(rest);
  if (!r) {
    // Destination or title may span lines (e.g. a multi-line quoted
    // title): try joining with following lines until it parses.
    let joined = rest;
    let found = null;
    let joinedLines = 1;
    for (let li2 = 1; li2 <= 5 && lineIdx + li2 < lines.length; li2++) {
      const nl = lines[lineIdx + li2];
      const nli = leadingIndent(nl);
      // A ref-def continuation line may be indented (the dest/title is
      // not a code block just because it is indented); let parseDestTitle
      // decide whether it parses.
      joined += '\n' + nli.rest;
      const rj = parseDestTitle(joined);
      if (rj) { found = rj; joinedLines = li2 + 1; break; }
    }
    if (found) {
      r = found;
      consumedLines = lineIdx + joinedLines;
    } else {
      // Destination may be on the next line (any indent; the rest is
      // the dest, not a code block, once it parses as one).
      if (lineIdx + 1 < lines.length) {
        const nl = lines[lineIdx + 1];
        const nli = leadingIndent(nl);
        r = parseDestTitle(nli.rest);
        if (r) { consumedLines = lineIdx + 2; }
      }
      if (!r) return null;
    }
  } else {
    dest = r.dest; title = r.title;
  }
  if (r) { dest = r.dest; title = r.title; }
  // If no title on the destination line, it may be alone on the next line
  // (whether the dest was on the label line or on the following line).
  // The title line may be indented.
  if (r && r.title === null && consumedLines < lines.length) {
    const nl = lines[consumedLines];
    const nli = leadingIndent(nl);
    const t = parseTitleOnly(nli.rest);
    if (t !== null) { title = t; consumedLines = consumedLines + 1; }
  }
  // The rest of the (possibly second) line must be blank.
  const lastLine = consumedLines === 2 ? lines[1] : lines[0];
  // (We already ensured trailing content is only whitespace in parseDestTitle.)
  const key = normalizeLabel(label);
  if (!this.refs.has(key)) this.refs.set(key, { dest, title: title === null ? undefined : title });
  return { consumed: consumedLines, rest: lines.slice(consumedLines) };
};

// Try to parse a GFM table from textLines. Returns {node, consumed} or null.
Parser.prototype.tryTable = function (textLines) {
  const header = textLines[0];
  const delim = textLines[1];
  if (header.indexOf('|') < 0) return null;
  const cells = splitTableRow(header);
  if (!cells) return null;
  const aligns = parseDelimRow(delim);
  if (!aligns || aligns.length !== cells.length) return null;
  const rows = [];
  let n = 2;
  while (n < textLines.length) {
    const row = textLines[n];
    // A row need not contain a pipe; a bare line is a single-cell row.
    if (isBlank(row)) break;
    const rc = splitTableRow(row);
    if (!rc) break;
    rows.push(rc);
    n++;
  }
  return { node: { type: 'table', header: cells, aligns, rows }, consumed: n };
};

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '|'; i += 2; continue; }
    if (c === '`') {
      // Code span may contain |. The \| inside is still an escaped pipe
      // at the table level, so convert it to | when copying.
      let j = i;
      while (j < s.length && s[j] === '`') j++;
      const ticks = j - i;
      const close = s.indexOf('`'.repeat(ticks), j);
      if (close >= 0) {
        const span = s.slice(i, close + ticks).replace(/\\\|/g, '|');
        cur += span; i = close + ticks; continue;
      }
      cur += c; i++;
      continue;
    }
    if (c === '|') { cells.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  cells.push(cur.trim());
  return cells;
}
function parseDelimRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const parts = s.split('|');
  const aligns = [];
  for (const p of parts) {
    const t = p.trim();
    if (!/^:?-+:?$/.test(t)) return null;
    if (t.startsWith(':') && t.endsWith(':')) aligns.push('center');
    else if (t.endsWith(':')) aligns.push('right');
    else if (t.startsWith(':')) aligns.push('left');
    else aligns.push(null);
  }
  return aligns;
}

// ---------- Rendering ----------
Parser.prototype.renderBlocks = function (blocks) {
  let out = '';
  for (const b of blocks) out += this.renderBlock(b);
  return out;
};

Parser.prototype.renderBlock = function (b) {
  switch (b.type) {
    case 'code': {
      // The info string's backslash escapes are resolved (foo\+bar -> foo+bar).
      const langRaw = b.lang ? b.lang.split(/[ \t]/)[0].replace(/\\([!-/:-@\[-`{-~])/g, '$1') : '';
      const cls = langRaw ? ` class="language-${escapeAttr(langRaw)}"` : '';
      return `<pre><code${cls}>${escapeHtml(b.code)}</code></pre>\n`;
    }
    case 'heading':
      return `<h${b.level}>${this.parseInline(b.text)}</h${b.level}>\n`;
    case 'hr':
      return '<hr>\n';
    case 'html':
      return b.content + (b.trailing ? '\n' : '');
    case 'blockquote': {
      const inner = this.renderBlocks(b.children);
      return `<blockquote>\n${inner}</blockquote>\n`;
    }
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 && b.start !== null ? ` start="${b.start}"` : '';
      let out = `<${tag}${start}>\n`;
      for (const item of b.children) out += this.renderItem(item);
      out += `</${tag}>\n`;
      return out;
    }
    case 'paragraph':
      return `<p>${this.parseInline(b.text)}</p>\n`;
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let i = 0; i < b.header.length; i++) {
        const a = b.aligns[i] ? ` align="${b.aligns[i]}"` : '';
        out += `<th${a}>${this.parseInline(b.header[i])}</th>\n`;
      }
      out += '</tr>\n</thead>\n';
      // No <tbody> when there are no body rows.
      if (b.rows.length) {
        out += '<tbody>';
        for (const row of b.rows) {
          out += '<tr>\n';
          for (let i = 0; i < b.header.length; i++) {
            const a = b.aligns[i] ? ` align="${b.aligns[i]}"` : '';
            const cell = i < row.length ? row[i] : '';
            out += `<td${a}>${this.parseInline(cell)}</td>\n`;
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      out += '</table>\n';
      return out;
    }
    default:
      return '';
  }
};

Parser.prototype.renderItem = function (item) {
  const blocks = item.children;
  const loose = item.loose;
  let prefix = '';
  if (item.task !== null && item.task !== undefined) {
    prefix = item.task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ';
  }
  if (!loose) {
    // Tight list: paragraphs render as bare inline text (no <p>, no
    // trailing newline); other blocks contribute their full HTML.
    let inner = '';
    for (const b of blocks) {
      if (b.type === 'paragraph') inner += this.parseInline(b.text);
      else inner += this.renderBlock(b);
    }
    if (prefix) return `<li>${prefix}${inner}</li>\n`;
    return `<li>${inner}</li>\n`;
  }
  // Loose list: full block rendering.
  if (prefix) {
    if (blocks.length && blocks[0].type === 'paragraph') {
      const first = `<p>${prefix}${this.parseInline(blocks[0].text)}</p>\n`;
      let rest = '';
      for (let k = 1; k < blocks.length; k++) rest += this.renderBlock(blocks[k]);
      return `<li>${first}${rest}</li>\n`;
    }
    return `<li>${prefix}${this.renderBlocks(blocks)}</li>\n`;
  }
  return `<li>${this.renderBlocks(blocks)}</li>\n`;
};

// ---------- Inline parsing ----------
Parser.prototype.parseInline = function (text) {
  const inl = new InlineParser(text, this.refs);
  return inl.render();
};

// Node types:
//  {t:'text', s}            plain text (raw, escaped at render)
//  {t:'delim', ch, len, canOpen, canClose}   emphasis delimiter run
//  {t:'code', s}            code span content
//  {t:'link', href, title, children}
//  {t:'image', src, alt, title}
//  {t:'autolink', href, text}
//  {t:'html', s}            raw HTML (passed through)
//  {t:'br'}                 hard break
//  {t:'del', children}      strikethrough
//  {t:'em'|'strong', children}

class InlineParser {
  constructor(text, refs) {
    this.s = text;
    this.refs = refs;
    this.n = text.length;
  }

  render() {
    const nodes = this.parseNodes(0, this.n);
    this.processEmphasis(nodes);
    return this.renderNodes(nodes);
  }

  renderNodes(nodes) {
    let out = '';
    for (const nd of nodes) {
      switch (nd.t) {
        case 'text': out += escapeHtml(nd.s); break;
        case 'delim': out += escapeHtml(nd.ch.repeat(nd.len)); break;
        case 'code': out += '<code>' + escapeHtml(nd.s) + '</code>'; break;
        case 'link': {
          const title = nd.title ? ` title="${escapeAttr(nd.title)}"` : '';
          out += `<a href="${escapeHrefAttr(resolveHref(unescapeDest(nd.href)))}"${title}>${this.renderNodes(nd.children)}</a>`;
          break;
        }
        case 'image': {
          const title = nd.title ? ` title="${escapeAttr(nd.title)}"` : '';
          out += `<img src="${escapeHrefAttr(resolveHref(unescapeDest(nd.src)))}" alt="${escapeAttr(nd.alt)}"${title}>`;
          break;
        }
        case 'autolink': out += `<a href="${escapeHrefAttr(resolveHref(nd.href))}">${escapeHtml(nd.text)}</a>`; break;
        case 'html': out += nd.s; break;
        case 'br': out += '<br>'; break;
        case 'del': out += '<del>' + this.renderNodes(nd.children) + '</del>'; break;
        case 'em': out += '<em>' + this.renderNodes(nd.children) + '</em>'; break;
        case 'strong': out += '<strong>' + this.renderNodes(nd.children) + '</strong>'; break;
      }
    }
    return out;
  }

  // Scan [start,end) into nodes. Emphasis delimiters are left as 'delim'
  // nodes for processEmphasis to resolve.
  parseNodes(start, end) {
    const s = this.s;
    const nodes = [];
    let i = start;
    let textStart = start;
    const flushText = (to) => {
      if (to > textStart) nodes.push({ t: 'text', s: s.slice(textStart, to) });
    };
    while (i < end) {
      const c = s[i];
      if (c === '`') {
        let j = i;
        while (j < end && s[j] === '`') j++;
        const ticks = j - i;
        const close = findCodeClose(s, j, end, ticks);
        if (close >= 0) {
          flushText(i);
          let code = s.slice(j, close).replace(/\n/g, ' ');
          if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) code = code.slice(1, -1);
          nodes.push({ t: 'code', s: code });
          i = close + ticks;
          textStart = i;
          continue;
        }
        i = j;
        continue;
      }
      if (c === '\\') {
        if (i + 1 < end && s[i + 1] === '\n') {
          flushText(i);
          nodes.push({ t: 'br' });
          i += 2;
          // Leading whitespace on the line after a hard break is skipped.
          while (i < end && (s[i] === ' ' || s[i] === '\t')) i++;
          textStart = i;
          continue;
        }
        if (i + 1 < end && isAsciiPunct(s[i + 1])) {
          flushText(i);
          nodes.push({ t: 'text', s: s[i + 1] });
          i += 2; textStart = i;
          continue;
        }
        i++;
        continue;
      }
      if (c === '&') {
        const e = decodeEntity(s, i);
        if (e) {
          flushText(i);
          // Named entities are preserved raw; numeric are decoded then escaped.
          nodes.push({ t: 'html', s: e.named ? e.text : escapeHtml(e.text) });
          i = e.next; textStart = i;
          continue;
        }
        i++;
        continue;
      }
      if (c === '*' || c === '_') {
        let j = i;
        while (j < end && s[j] === c) j++;
        const runLen = j - i;
        const before = i > 0 ? s[i - 1] : '\n';
        const after = j < end ? s[j] : '\n';
        const beforeIsSpace = isSpace(before);
        const afterIsSpace = isSpace(after);
        const beforeIsPunct = isPunct(before);
        const afterIsPunct = isPunct(after);
        let canOpen, canClose;
        if (c === '*') {
          canOpen = !afterIsSpace && (!afterIsPunct || beforeIsSpace || beforeIsPunct);
          canClose = !beforeIsSpace && (!beforeIsPunct || afterIsSpace || afterIsPunct);
        } else {
          const leftFlanking = !afterIsSpace && (!afterIsPunct || beforeIsSpace || beforeIsPunct);
          const rightFlanking = !beforeIsSpace && (!beforeIsPunct || afterIsSpace || afterIsPunct);
          canOpen = leftFlanking && (!rightFlanking || beforeIsPunct);
          canClose = rightFlanking && (!leftFlanking || afterIsPunct);
        }
        // A delimiter that can neither open nor close emphasis is literal
        // text (e.g. the _ in a.b-c_d@a.b); keep it in the text run so
        // email/www autolink detection sees the whole word.
        if (!canOpen && !canClose) { i = j; continue; }
        flushText(i);
        nodes.push({ t: 'delim', ch: c, len: runLen, canOpen, canClose });
        i = j; textStart = i;
        continue;
      }
      if (c === '~') {
        let j = i;
        while (j < end && s[j] === '~') j++;
        const runLen = j - i;
        if (runLen === 1 || runLen === 2) {
          const close = this.findStrikeClose(i + runLen, end, runLen);
          if (close >= 0) {
            flushText(i);
            const inner = new InlineParser(s.slice(i + runLen, close), this.refs);
            const innerNodes = inner.parseNodes(0, close - (i + runLen));
            inner.processEmphasis(innerNodes);
            nodes.push({ t: 'del', children: innerNodes });
            i = close + runLen; textStart = i;
            continue;
          }
        }
        i++;
        continue;
      }
      if (c === '[' || (c === '!' && i + 1 < end && s[i + 1] === '[')) {
        const isImage = c === '!';
        const startBracket = isImage ? i + 1 : i;
        const link = this.tryLink(startBracket, end, isImage);
        if (link) {
          flushText(i);
          nodes.push(link.node);
          i = link.next; textStart = i;
          continue;
        }
        i++;
        continue;
      }
      if (c === '<') {
        const auto = this.tryAutolink(i, end);
        if (auto) {
          flushText(i);
          nodes.push({ t: 'autolink', href: auto.href, text: auto.text });
          i = auto.next; textStart = i;
          continue;
        }
        const html = this.tryRawHtml(i, end);
        if (html) {
          flushText(i);
          nodes.push({ t: 'html', s: html.text });
          i = html.next; textStart = i;
          continue;
        }
        i++;
        continue;
      }
      if (c === '\n') {
        // Hard break: two or more spaces before the newline.
        let sp = 0;
        let k = i - 1;
        while (k >= textStart && s[k] === ' ') { sp++; k--; }
        const pendingSpaces = sp;
        if (sp < 2 && nodes.length && nodes[nodes.length - 1].t === 'text') {
          const last = nodes[nodes.length - 1].s;
          let m = last.length - 1;
          while (m >= 0 && last[m] === ' ') { sp++; m--; }
          if (sp >= 2) {
            const fromLast = sp - pendingSpaces;
            nodes[nodes.length - 1].s = last.slice(0, last.length - fromLast);
            flushText(i - pendingSpaces);
            nodes.push({ t: 'br' });
            i++;
            // Leading whitespace on the line after a hard break is skipped.
            while (i < end && (s[i] === ' ' || s[i] === '\t')) i++;
            textStart = i;
            continue;
          }
        }
        if (sp >= 2) {
          flushText(i - sp);
          nodes.push({ t: 'br' });
          i++;
          // Leading whitespace on the line after a hard break is skipped.
          while (i < end && (s[i] === ' ' || s[i] === '\t')) i++;
          textStart = i;
          continue;
        }
        i++;
        continue;
      }
      if (c === 'w' && s.startsWith('www.', i)) {
        const g = this.tryGfmAutolink(i, end, 'www');
        if (g) {
          flushText(i);
          nodes.push({ t: 'autolink', href: g.href, text: g.text });
          i = g.next; textStart = i;
          continue;
        }
        i++;
        continue;
      }
      // Scheme autolink (any scheme: http/https/ftp/mailto/xmpp/...).
      // Scheme is case-insensitive, 2-32 chars.
      if (/[A-Za-z]/.test(c)) {
        const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(s.slice(i, i + 34));
        if (sm) {
          const g = this.tryGfmAutolink(i, end, 'scheme');
          if (g) {
            flushText(i);
            nodes.push({ t: 'autolink', href: g.href, text: g.text });
            i = g.next; textStart = i;
            continue;
          }
        }
        i++;
        continue;
      }
      // Email autolink: only when preceded by start/space/punct.
      if (c === ']' ) { i++; continue; }
      i++;
    }
    flushText(end);
    // Post-process: email autolinks inside text nodes.
    return this.splitEmails(nodes);
  }

  // Split email autolinks out of text nodes.
  splitEmails(nodes) {
    const out = [];
    const re = /[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~_-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/g;
    for (let ni = 0; ni < nodes.length; ni++) {
      const nd = nodes[ni];
      if (nd.t !== 'text') { out.push(nd); continue; }
      const seg = nd.s;
      let pos = 0;
      let m;
      re.lastIndex = 0;
      let any = false;
      while ((m = re.exec(seg)) !== null) {
        // Email must not be preceded by a word char (part of a larger word).
        if (m.index > 0 && /[A-Za-z0-9_.+-]/.test(seg[m.index - 1])) continue;
        // If followed by - or _ the token is not an email at all (the
        // domain would be invalid / part of a longer identifier). The
        // follower may be in the next node (a _ delimiter fragments it).
        let after = seg[m.index + m[0].length];
        if (after === undefined && ni + 1 < nodes.length) {
          const nx = nodes[ni + 1];
          if (nx.t === 'delim' && nx.ch === '_') after = '_';
          else if (nx.t === 'text' && nx.s.length) after = nx.s[0];
          else if (nx.t === 'delim' && nx.ch === '*') after = '*';
        }
        if (after === '-' || after === '_') continue;
        any = true;
        if (m.index > pos) out.push({ t: 'text', s: seg.slice(pos, m.index) });
        out.push({ t: 'autolink', href: 'mailto:' + m[0], text: m[0] });
        pos = m.index + m[0].length;
      }
      if (!any) { out.push(nd); continue; }
      if (pos < seg.length) out.push({ t: 'text', s: seg.slice(pos) });
    }
    return out;
  }

  // CommonMark delimiter-stack emphasis resolution.
  processEmphasis(nodes) {
    // Stack of indices of delim nodes that can open.
    const stack = [];
    let i = 0;
    while (i < nodes.length) {
      const nd = nodes[i];
      if (nd.t !== 'delim') { i++; continue; }
      if (nd.canClose) {
        // Look back for a matching opener.
        let oi = -1;
        for (let s = stack.length - 1; s >= 0; s--) {
          const op = nodes[stack[s]];
          if (op.ch !== nd.ch) continue;
          // Rule of 3: if either delimiter can both open and close, the sum
          // of the run lengths must not be a multiple of 3, UNLESS both
          // lengths are multiples of 3 (then they may match).
          if ((op.canOpen && op.canClose) || (nd.canOpen && nd.canClose)) {
            if ((op.len + nd.len) % 3 === 0 && !(op.len % 3 === 0 && nd.len % 3 === 0)) continue;
          }
          oi = stack[s];
          break;
        }
        if (oi >= 0) {
          const opener = nodes[oi];
          const useLen = (opener.len >= 2 && nd.len >= 2) ? 2 : 1;
          const tag = useLen === 2 ? 'strong' : 'em';
          // Build the em/strong node from nodes between opener and closer.
          const children = nodes.slice(oi + 1, i);
          const emNode = { t: tag, children };
          // Replace opener..closer with: [opener remainder][emNode][closer remainder]
          const before = [];
          if (opener.len > useLen) before.push({ t: 'delim', ch: opener.ch, len: opener.len - useLen, canOpen: opener.canOpen, canClose: opener.canClose });
          const after = [];
          if (nd.len > useLen) after.push({ t: 'delim', ch: nd.ch, len: nd.len - useLen, canOpen: nd.canOpen, canClose: nd.canClose });
          const replacement = [...before, emNode, ...after];
          nodes.splice(oi, i - oi + 1, ...replacement);
          // Remove stack entries at or after oi (they were inside the em).
          while (stack.length && stack[stack.length - 1] >= oi) stack.pop();
          // If the opener had a remainder, it stays on the stack.
          if (before.length) {
            // The opener remainder is now at index oi.
            stack.push(oi);
          }
          // If the closer had a remainder, it is at oi + before.length + 1.
          // Re-process it so it can close an earlier opener.
          if (after.length) {
            const idx = oi + before.length + 1;
            i = idx;
          } else {
            i = oi + before.length + 1;
          }
          continue;
        }
      }
      if (nd.canOpen) stack.push(i);
      i++;
    }
  }

  findStrikeClose(from, end, len) {
    const s = this.s;
    let i = from;
    while (i < end) {
      if (s[i] === '~') {
        let j = i;
        while (j < end && s[j] === '~') j++;
        if (j - i === len) return i;
        i = j;
        continue;
      }
      if (s[i] === '\n') return -1;
      i++;
    }
    return -1;
  }

  // Try to parse a link or image starting at the '[' at startBracket.
  // Returns {node, next} or null.
  tryLink(startBracket, end, isImage) {
    const s = this.s;
    let depth = 0;
    let k = startBracket + 1;
    let textEnd = -1;
    while (k < end) {
      const c = s[k];
      if (c === '\\' && k + 1 < end && isPunct(s[k + 1])) { k += 2; continue; }
      if (c === '`') {
        let m = k;
        while (m < end && s[m] === '`') m++;
        const ticks = m - k;
        const close = findCodeClose(s, m, end, ticks);
        k = close >= 0 ? close + ticks : m;
        continue;
      }
      // A ] inside <...> (an autolink or HTML tag) does not close the
      // link text: skip to the matching > (the tag may contain a
      // quoted attribute, e.g. <bar attr="](baz)">).
      if (c === '<') {
        const gt = s.indexOf('>', k + 1);
        if (gt >= 0 && gt < end) { k = gt + 1; continue; }
      }
      if (c === '[') depth++;
      else if (c === ']') {
        if (depth === 0) { textEnd = k; break; }
        depth--;
      }
      k++;
    }
    if (textEnd < 0) return null;
    const rawText = s.slice(startBracket + 1, textEnd);
    let p = textEnd + 1;
    if (p < end && s[p] === '(') {
      const inline = this.parseInlineLinkDest(p, end);
      if (inline) {
        if (isImage) {
          const alt = stripInlineFormatting(rawText, this.refs);
          return { node: { t: 'image', src: inline.dest, alt, title: inline.title }, next: inline.next };
        }
        const lp = new InlineParser(rawText, this.refs);
        const children = lp.parseNodes(0, rawText.length);
        lp.processEmphasis(children);
        if (containsLink(children)) return null;
        return { node: { t: 'link', href: inline.dest, title: inline.title, children }, next: inline.next };
      }
      // Inline dest invalid: fall through to try a reference link
      // ([foo] as a shortcut ref, with "(...)" left as literal text).
    }
    let label = null;
    let next = p;
    if (p < end && s[p] === '[') {
      let q = p + 1;
      let labelEnd = -1;
      let d2 = 0;
      while (q < end) {
        const c = s[q];
        if (c === '\\' && q + 1 < end && isPunct(s[q + 1])) { q += 2; continue; }
        if (c === '[') d2++;
        else if (c === ']') { if (d2 === 0) { labelEnd = q; break; } d2--; }
        q++;
      }
      if (labelEnd < 0) return null;
      label = s.slice(p + 1, labelEnd);
      next = labelEnd + 1;
    } else {
      label = rawText;
      next = p;
    }
    const key = normalizeLabel(label === '' ? rawText : label);
    const ref = this.refs.get(key);
    if (!ref) return null;
    if (isImage) {
      const alt = stripInlineFormatting(rawText, this.refs);
      return { node: { t: 'image', src: ref.dest, alt, title: ref.title }, next };
    }
    const lp = new InlineParser(rawText, this.refs);
    const children = lp.parseNodes(0, rawText.length);
    lp.processEmphasis(children);
    if (containsLink(children)) return null;
    return { node: { t: 'link', href: ref.dest, title: ref.title, children }, next };
  }

  parseInlineLinkDest(p, end) {
    const s = this.s;
    let i = p + 1;
    while (i < end && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
    if (i >= end) return null;
    let dest = '';
    if (s[i] === '<') {
      // Scan for the closing >, skipping backslash-escaped >.
      let e = i + 1;
      let found = -1;
      while (e < end) {
        if (s[e] === '\\' && e + 1 < end && isPunct(s[e + 1])) { e += 2; continue; }
        if (s[e] === '>') { found = e; break; }
        if (s[e] === '\n' || s[e] === '<') break;
        e++;
      }
      if (found < 0) return null;
      dest = s.slice(i + 1, found);
      if (/[\n<>]/.test(dest)) return null;
      i = found + 1;
    } else {
      let depth = 0;
      while (i < end) {
        const c = s[i];
        if (c === ' ' || c === '\t' || c === '\n') break;
        if (c === '(') depth++;
        else if (c === ')') { if (depth === 0) break; depth--; }
        else if (c === '\\' && i + 1 < end && isPunct(s[i + 1])) { dest += s[i] + s[i + 1]; i += 2; continue; }
        dest += c; i++;
      }
      if (dest.indexOf('(') >= 0 && depth !== 0) return null;
    }
    let title = null;
    let q = i;
    while (q < end && (s[q] === ' ' || s[q] === '\t' || s[q] === '\n')) q++;
    if (q < end && (s[q] === '"' || s[q] === "'" || s[q] === '(')) {
      const tc = s[q];
      const close = tc === '(' ? ')' : tc;
      let e = q + 1;
      let tv = '';
      let ok = false;
      while (e < end) {
        const c = s[e];
        if (c === '\\' && e + 1 < end && isPunct(s[e + 1])) { tv += s[e + 1]; e += 2; continue; }
        if (c === close) { ok = true; break; }
        if (tc === '(' && c === '(') break;
        tv += c; e++;
      }
      if (!ok) return null;
      title = tv;
      q = e + 1;
      while (q < end && (s[q] === ' ' || s[q] === '\t' || s[q] === '\n')) q++;
    }
    if (q >= end || s[q] !== ')') return null;
    return { dest, title, next: q + 1 };
  }

  tryAutolink(i, end) {
    const s = this.s;
    const close = s.indexOf('>', i + 1);
    if (close < 0 || close >= end) return null;
    const inner = s.slice(i + 1, close);
    if (/[\n<>]/.test(inner)) return null;
    if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ \t<>]*$/.test(inner)) {
      // Brackets and backticks in an autolink URL are percent-encoded
      // in the href (the link text keeps them literal).
      const href = inner.replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/`/g, '%60');
      return { href, text: inner, next: close + 1 };
    }
    if (/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(inner)) {
      return { href: 'mailto:' + inner, text: inner, next: close + 1 };
    }
    return null;
  }

  tryRawHtml(i, end) {
    const s = this.s;
    const rest = s.slice(i, end);
    // HTML comment: <!--> , <!---> , or <!-- ... --> (content may contain --).
    let m = rest.match(/^<!--(?:>|->|[\s\S]*?-->)/);
    if (m) return { text: m[0], next: i + m[0].length };
    m = rest.match(/^<\?(?:[^?]|\\?[^>])*?\\?>/);
    if (m) return { text: m[0], next: i + m[0].length };
    m = rest.match(/^<![A-Za-z][^>]*>/);
    if (m) return { text: m[0], next: i + m[0].length };
    m = rest.match(/^<!\[CDATA\[[^\]]*\]\]>/);
    if (m) return { text: m[0], next: i + m[0].length };
    // Closing tag: no attributes allowed.
    m = rest.match(/^<\/[A-Za-z][A-Za-z0-9-]*\s*>/);
    if (m) return { text: m[0], next: i + m[0].length };
    // Open tag (may be self-closing).
    m = rest.match(/^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:'[^']*'|"[^"]*"|[^\s"'=<>`]+))?)*\s*\/?>/);
    if (m) return { text: m[0], next: i + m[0].length };
    return null;
  }

  tryGfmAutolink(i, end, kind) {
    const s = this.s;
    let j;
    if (kind === 'www') {
      j = i + 4;
      if (j >= end || !/[A-Za-z0-9-]/.test(s[j])) return null;
    } else {
      // Any scheme (2-32 chars): http, https, ftp, mailto, xmpp, ...
      const m = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(s.slice(i, end));
      if (!m) return null;
      j = i + m[0].length;
      // The scheme must be followed by at least one non-space char.
      if (j >= end || isSpace(s[j]) || s[j] === '<') return null;
    }
    let k = j;
    // A backslash is not a valid URI character; the autolink ends before it.
    while (k < end && !isSpace(s[k]) && s[k] !== '<' && s[k] !== '\\') k++;
    let url = s.slice(i, k);
    let trimmed = url;
    while (trimmed.length) {
      // A trailing entity-like "&name;" is not part of the URL (check
      // before the ';' trim below strips it).
      const em = /&[A-Za-z][A-Za-z0-9]*;$/.exec(trimmed);
      if (em) { trimmed = trimmed.slice(0, trimmed.length - em[0].length); continue; }
      const last = trimmed[trimmed.length - 1];
      if ('.,;:!?*_~\'"'.indexOf(last) >= 0) { trimmed = trimmed.slice(0, -1); continue; }
      if (last === ')') {
        const opens = (trimmed.match(/\(/g) || []).length;
        const closes = (trimmed.match(/\)/g) || []).length;
        if (closes > opens) { trimmed = trimmed.slice(0, -1); continue; }
      }
      if (last === ']') {
        const opens = (trimmed.match(/\[/g) || []).length;
        const closes = (trimmed.match(/\]/g) || []).length;
        if (closes > opens) { trimmed = trimmed.slice(0, -1); continue; }
      }
      break;
    }
    if (trimmed.length <= (kind === 'www' ? 4 : 0)) return null;
    if (kind === 'scheme') {
      // There must be actual URI content after the scheme's colon;
      // "word:." (colon + only trimmable punctuation) is not a link.
      const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(trimmed);
      if (!sm || trimmed.length <= sm[0].length) return null;
      // For non-hierarchical schemes (not http/https/ftp) the path has
      // a single segment: xmpp:user@host/res, not /res/more.
      const scheme = sm[0].slice(0, -1).toLowerCase();
      if (scheme === 'mailto') {
        // An email ending in "-" or "_" (before any punctuation trim)
        // is not a valid email: no link at all.
        if (/[-_]$/.test(url)) return null;
        // mailto: is an email address only; a trailing "/" is not part
        // of the link.
        const afterScheme = trimmed.slice(sm[0].length);
        const slash = afterScheme.indexOf('/');
        if (slash >= 0) trimmed = trimmed.slice(0, sm[0].length + slash);
      } else if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ftp') {
        const afterScheme = trimmed.slice(sm[0].length);
        const firstSlash = afterScheme.indexOf('/');
        if (firstSlash >= 0) {
          const secondSlash = afterScheme.indexOf('/', firstSlash + 1);
          if (secondSlash >= 0) {
            trimmed = trimmed.slice(0, sm[0].length + secondSlash);
          }
        }
      }
    }
    if (kind === 'www') {
      const dom = trimmed.slice(4).split(/[\/?#]/)[0];
      if (dom.indexOf('.') < 0) return null;
    }
    if (i > 0) {
      const prev = s[i - 1];
      if (/[A-Za-z0-9_]/.test(prev)) return null;
    }
    const href = kind === 'www' ? 'http://' + trimmed : trimmed;
    return { href, text: trimmed, next: i + trimmed.length };
  }
}

function findCodeClose(s, j, end, ticks) {
  const marker = '`'.repeat(ticks);
  let i = j;
  while (i < end) {
    if (s[i] === '`') {
      let k = i;
      while (k < end && s[k] === '`') k++;
      if (k - i === ticks) return i;
      i = k;
    } else i++;
  }
  return -1;
}

// Does a parsed inline node list contain a link (nested [text](url) link
// or a raw HTML <a> tag)? A link's text may not contain another link.
// (GFM bare-URL autolinks do NOT block the outer link.)
function containsLink(nodes) {
  for (const nd of nodes) {
    if (nd.t === 'link') return true;
    if (nd.t === 'html' && /^<a(?:[ \t/>]|$)/i.test(nd.s)) return true;
    if (nd.children && containsLink(nd.children)) return true;
  }
  return false;
}

// Strip markdown formatting from image alt text: parse inline and render
// to plain text (tags removed).
function stripInlineFormatting(text, refs) {
  const p = new InlineParser(text, refs);
  const nodes = p.parseNodes(0, text.length);
  p.processEmphasis(nodes);
  let out = '';
  const walk = (nds) => {
    for (const nd of nds) {
      if (nd.t === 'text') out += nd.s;
      else if (nd.t === 'code') out += nd.s;
      else if (nd.t === 'html') out += nd.s;
      else if (nd.t === 'delim') out += nd.ch.repeat(nd.len);
      else if (nd.t === 'autolink') out += nd.text;
      else if (nd.t === 'image') out += nd.alt;
      else if (nd.children) walk(nd.children);
    }
  };
  walk(nodes);
  return out;
}

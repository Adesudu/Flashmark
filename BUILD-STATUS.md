# Flashmark Build Status

## Current Progress
- **Cases passing: 678 out of 720** (up from 89 baseline; 660 at the start of this session's final push, 678 after the last round of fixes).
- Parser state: full custom CommonMark 0.31.2 + GFM 0.29 parser in `parse.js` (~1900 lines, written from scratch — a drop-in replacement for marked, no marked code imported). Verified end-to-end via `main.ts` against the practice kit: 678/720.
- Test command: `cd ~/workspace/makefun/flashmark && node test_parser.js` (~1.5s). Local fail-lister: `~/workspace/makefun/grade-local.mjs` (writes `~/workspace/makefun/fails-local.json`).

## Remaining fails (42 = 2 spec + 40 docs)
- **Spec (2):** cm-006, cm-007 — tab expansion after a block marker (`>\t\tfoo`, `-\t\tfoo`); the reference expands the second tab to 2 spaces in the indented-code content, and the exact tab-stop interaction was not resolved.
- **Docs (40):** all 40 generated README documents still differ. Dominant cause is tab handling in indented vs fenced code (the upfront `expandLeadingTabs` is correct for fenced code but converts tabs that indented code must preserve literally, and vice versa when removed). Secondary: a fence-closing difference in doc-03/doc-04 (an extra blank line before `</code></pre>`).

## Biggest Remaining Mismatch Groups (resolved this session)
- Link reference definitions (multi-line labels/titles, dest/title on following lines, unicode folding, `[` rejection) — now 0 fails.
- Emphasis (delimiter-stack, rule-of-3 exception), links, autolinks (scheme/mailto/xmpp, trailing punctuation), tables, entities — now 0 fails.
- Block quotes (lazy continuations incl. deep nesting through list+quote, setext suppression, fence tracking, whitespace-only `>  ` lines) and lists (looseness via structural probe, thematic-break precedence, empty-item handling, fence blanks) — nearly all fixed.
- HTML blocks (trailing-newline rule now tracks whether the input ends with a newline; closing tags may not carry attributes).

## Notes
- NEVER restore or import marked.js. NEVER submit recording 01a1e1bb.
- Recording 01a1e501 (PID 7377) was already running and watched this directory; all work in this session was authored after it started.
- Do NOT push to GitHub from this session; the parent agent pushes.

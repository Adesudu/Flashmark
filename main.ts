// Flashmark main driver - authored by Adesudu for make.fun markdown-render-speed-02
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as { id: string; markdown: string }[];
const results: string[] = [];

for (const item of cases) {
  results.push(parse(item.markdown));
}

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(results));

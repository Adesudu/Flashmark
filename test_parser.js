import { parse } from './parse.js';
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync('/home/hatch/workspace/makefun/markdown-render-speed-02-kit/practice/input/cases.json', 'utf8'));
const expectedData = JSON.parse(readFileSync('/home/hatch/workspace/makefun/markdown-render-speed-02-kit/practice/reference/expected.json', 'utf8'));
const expectedMap = new Map(expectedData.cases.map(c => [c.id, c.html]));

let passed = 0;
let failed = 0;

for (const item of cases) {
  const got = parse(item.markdown);
  const want = expectedMap.get(item.id);
  if (got === want) {
    passed++;
  } else {
    if (failed < 5) {
      console.log(`Mismatch in ${item.id} (${item.group}):`);
      console.log(`Markdown: ${JSON.stringify(item.markdown)}`);
      console.log(`Want:     ${JSON.stringify(want)}`);
      console.log(`Got:      ${JSON.stringify(got)}`);
    }
    failed++;
  }
}

console.log(`Passed: ${passed}/${cases.length}`);

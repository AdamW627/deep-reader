import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMath} from '../src/math.js';

test('DeepSeek delimiters become Markdown math',()=>{
 assert.equal(normalizeMath(String.raw`行内 \(x^2\)，公式：\[\frac{a}{b}\]`),'行内 $x^2$，公式：\n\n$$\n\\frac{a}{b}\n$$\n\n');
});
test('code and existing dollar math remain unchanged',()=>{
 const text='代码 `\\(code\\)` 与 $x$ 和 $$y$$\n```latex\n\\[code\\]\n```';
 assert.equal(normalizeMath(text),text);
});
test('multiline aligned equations and unmatched streaming delimiters',()=>{
 assert.ok(normalizeMath(String.raw`\[\begin{aligned}a&=b\\c&=d\end{aligned}\]`).includes('\\begin{aligned}'));
 assert.equal(normalizeMath(String.raw`unfinished \(x`),String.raw`unfinished \(x`);
});

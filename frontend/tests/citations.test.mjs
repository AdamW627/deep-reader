import test from 'node:test';
import assert from 'node:assert/strict';
import {linkCitations, parseCitation} from '../src/citations.js';

test('page, paragraph and range citations become links', () => {
  assert.equal(linkCitations(' [p.12] [p.4#3] [p.2#1-4]'), ' [p.12](#cite/12/) [p.4#3](#cite/4/3) [p.2#1–4](#cite/2/1)');
});

test('citations inside code stay literal', () => {
  assert.equal(linkCitations('`[p.1]`\n\n```\n[p.2#3]\n```'), '`[p.1]`\n\n```\n[p.2#3]\n```');
});

test('citation links parse page and paragraph targets', () => {
  assert.deepEqual(parseCitation('#cite/8/2'), {page: 8, block: 2});
  assert.deepEqual(parseCitation('#cite/8/'), {page: 8, block: null});
  assert.equal(parseCitation('#cite/0/2'), null);
  assert.equal(parseCitation('#cite/abc/2'), null);
});

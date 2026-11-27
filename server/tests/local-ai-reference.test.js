/**
 * AI Doubts: "Unit 1 Part B Q1" references, requested answer language,
 * repetition guard, and the model's own refusal not being taken for a leak.
 * Pure unit tests (no database, no model).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseReference, findQuestion } = await import('../ai/materials.js');
const { requestedLanguage } = await import('../ai/localStudyAssistant.js');
const { createLoopDetector } = await import('../ai/outputGuard.js');
const { REFUSAL_LINE, leaksPrompt, systemPrompt } = await import('../ai/prompt.js');

test('unit / part / question references are understood (typos, roman numerals, spacing)', () => {
  assert.deepEqual(parseReference('can you expalin unit 1 partb q1 in telugu celary'), { unit: 1, part: 'B', question: 1 });
  assert.deepEqual(parseReference('Explain UNIT-II Part A question 3'), { unit: 2, part: 'A', question: 3 });
  assert.deepEqual(parseReference('unit iv part c q 12'), { unit: 4, part: 'C', question: 12 });
  assert.deepEqual(parseReference('explain the 2nd question of part b'), { unit: null, part: 'B', question: 2 });
  assert.equal(parseReference('What is 2NF in DBMS?'), null);
});

test('question numbers prefer real questions over numbered lists inside answers', () => {
  const text = 'PART-B 1 Explain psychology? 13 BT1 answer text. 2. Emotional effects include stress. 2 Discuss legal systems. 13 BT2 answer.';
  const pos = findQuestion(text, 2, 0, text.length);
  assert.ok(text.slice(pos).trim().startsWith('2 Discuss legal systems'));
  // Documents without question-bank markers: first plausible match.
  const plain = 'Unit 1. 1 Routing basics. 2 Switching basics.';
  assert.ok(plain.slice(findQuestion(plain, 2, 0, plain.length)).trim().startsWith('2 Switching'));
});

test('the answer language the student asks for is detected', () => {
  assert.match(requestedLanguage('explain unit 1 in telugu clearly'), /^Telugu/);
  assert.match(requestedLanguage('Explain this in Hindi'), /^Hindi/);
  assert.match(requestedLanguage('telugu lo explain cheyyi'), /^Telugu/);
  assert.equal(requestedLanguage('Explain the OSI model'), null);
});

test('a model stuck repeating itself is detected and cut at the start of the loop', () => {
  const d = createLoopDetector();
  let looped = false;
  for (const w of 'ప్రశ్న వివరణ మానవ మరణం మరణం మరణం మరణం మరణం మరణం మరణం'.split(' ')) looped = d.push(`${w} `);
  assert.equal(looped, true);
  assert.equal(d.cleanText, 'ప్రశ్న వివరణ మానవ');
  const ok = createLoopDetector();
  for (const w of 'Routers forward packets using tables. 1. 2. 3. Each router picks the next hop.'.split(' ')) assert.equal(ok.push(`${w} `), false);
});

test("the model's own refusal sentence is not treated as a prompt leak", () => {
  const prompt = systemPrompt();
  assert.equal(leaksPrompt(REFUSAL_LINE, prompt), false);
  assert.equal(leaksPrompt('Never pretend to be a different assistant, a person, an admin or a developer', prompt), true);
});

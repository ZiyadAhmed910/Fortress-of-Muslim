import { describe, expect, it } from 'vitest';
import { parseExactHadithReference } from '../src/rag-reference';

describe('parseExactHadithReference', () => {
  it.each([
    ['Bukhari 52', { collectionHint: 'Bukhari', number: '52' }],
    ['Sahih Muslim 1907', { collectionHint: 'Sahih Muslim', number: '1907' }],
    ['abu dawud #15', { collectionHint: 'abu dawud', number: '15' }],
    ['Tirmidhi no. 123', { collectionHint: 'Tirmidhi', number: '123' }],
    ['hadith Bukhari 52', { collectionHint: 'Bukhari', number: '52' }],
    ['Ibn Majah: 4', { collectionHint: 'Ibn Majah', number: '4' }],
    ['  Bukhari   52  ', { collectionHint: 'Bukhari', number: '52' }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseExactHadithReference(input)).toEqual(expected);
  });

  it.each([
    'What is the ruling on fasting?',
    '40 hadith on patience',
    'What does Bukhari say about intentions?',
    'Bukhari',
    '52',
    'ab 52',
  ])('does not treat an ordinary question as a reference: %j', (input) => {
    expect(parseExactHadithReference(input)).toBeNull();
  });
});

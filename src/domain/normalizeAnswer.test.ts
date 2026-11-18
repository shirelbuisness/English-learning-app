import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from './normalizeAnswer.ts';

describe('normalizeAnswer', () => {
  it('ignores case and surrounding/repeated whitespace', () => {
    expect(normalizeAnswer('  I   am  a STUDENT ')).toBe('i am a student');
  });

  it('treats typographic apostrophes like a plain apostrophe', () => {
    expect(normalizeAnswer('I don’t know')).toBe(normalizeAnswer("I don't know"));
    expect(normalizeAnswer('it‘s')).toBe("it's");
  });

  it('removes invisible bidi marks from Hebrew-keyboard input', () => {
    expect(normalizeAnswer('‏hello‎')).toBe('hello');
  });

  it('keeps punctuation, which is a grading decision, not normalization', () => {
    expect(normalizeAnswer('Hello!')).toBe('hello!');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeAnswer('   ')).toBe('');
  });
});

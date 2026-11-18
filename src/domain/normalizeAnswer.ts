/**
 * Normalizes a learner's typed English answer for comparison.
 *
 * Pure function: no React, no storage. It deliberately does NOT strip
 * punctuation or fix spelling — those are grading decisions that belong
 * to the (future) answer-validation module.
 *
 * - trims and collapses whitespace
 * - lower-cases
 * - unifies typographic apostrophes/quotes (’ ‘ ʼ ´ `) to ' — mobile
 *   keyboards often insert ’ in words like "don’t"
 * - removes invisible bidi control marks that can leak in when typing
 *   English on a Hebrew keyboard layout
 */
export function normalizeAnswer(input: string): string {
  return input
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[‘’ʼ´`]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

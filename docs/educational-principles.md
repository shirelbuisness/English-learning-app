# Educational Principles

Status: **binding constraints** for all curriculum, content and learning-logic work.
Source: independent educational review provided by the owner, adopted at
Milestone 1 (2026-11-19). Reviewer/document reference: to be added by the owner.
These principles constrain design; they are not a curriculum and do not by
themselves authorize implementing lessons or content.

Learners: three Hebrew-speaking children aged 8, 11 and 13, starting at zero
English (including the alphabet), using the app independently on a computer.

---

## 1. Oral language and literacy develop together from the beginning

Listening comprehension, meaningful vocabulary, phonological awareness and
systematic phonics must be coordinated from the first units.

- Alphabet instruction is **not** the entire beginner curriculum.
- Phonics is **systematic**: it follows a documented scope and sequence, not
  item-by-item additions.
- Early units should combine: hearing and understanding words, noticing sounds,
  connecting sounds to letters, and reading words whose meaning is already
  known orally (decoding-only practice may use other items where pedagogically
  justified).

## 2. Meaning precedes or accompanies decoding

A learner should understand a word through listening and context (picture,
demonstration, Hebrew support) before being expected to demonstrate reading
comprehension of it.

- Content must record which words have been introduced orally before they
  appear in reading-comprehension exercises.

## 3. Account for Hebrew-to-English transfer

Future curriculum research must investigate phonological, orthographic and
linguistic differences relevant to Hebrew-speaking beginners. Areas to research
(not yet researched — findings must be cited):

- Script direction (RTL vs LTR) and letter-form confusions.
- Vowel representation (Hebrew marks vowels with niqqud in early-reading texts
  and only partially in unpointed text; English vowels are always written but
  map inconsistently to sounds).
- English phonemes absent from or distinct in Hebrew.
- Letter names vs letter sounds; upper/lower case (Hebrew has no case, but has
  final letter forms).
- Grammar and word-order differences relevant to early sentences.

## 4. Distinguish learning evidence

Track these as conceptually separate states per learner and item:

| State | Meaning |
|---|---|
| Exposure | The learner has encountered the item (heard/seen it). |
| Practice | The learner has worked with it with support. |
| Independent demonstration | The learner produced/recognized it correctly without support. |
| Delayed retention | The learner demonstrated it again after a delay. |

These are separate evidence records, not a single progression ladder. Whether
an attempt counts as practice or independent demonstration depends on the
support actually used (hints, audio replay, Hebrew), not on exercise type alone.
Without a microphone (principle 8), spoken production is not assessed in the
MVP, so independent-demonstration evidence is receptive (listening,
recognition, reading) unless the owner decides otherwise.

Do **not** implement a sophisticated mastery or scheduling algorithm until the
owner approves one.

## 5. Audio is a core learning asset

- The architecture must support consistent, reviewed, locally available audio.
- Browser speech synthesis must **not** be the primary source for phoneme
  instruction. Rationale (engineering observation, not research-cited): voices
  vary across devices, may be unavailable offline, and handle isolated sounds
  poorly.
- Content should reference audio by stable keys so the source can be reviewed
  and replaced independently.
- A lesson is not learner-ready until its audio exists and has been reviewed.

## 6. Design for independent use

- Instructions must be understandable without English reading ability.
- Use Hebrew support (text and audio), demonstrations and consistent
  interaction patterns initially.
- Reduce Hebrew assistance gradually as the learner progresses.

## 7. One shared curriculum, individual progression

- All learners follow the same curriculum.
- Pacing, repetition, support and challenge adapt to each learner's
  **performance**, not to age-based assumptions.

## 8. Privacy by default

The MVP must not introduce learner voice recording, microphone permissions,
accounts, analytics or external AI services without explicit product approval.

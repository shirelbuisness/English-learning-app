import type { ReactNode } from 'react';

type EnProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Wraps English text inside the Hebrew (RTL) interface.
 *
 * `dir="ltr"` isolates the text bidirectionally, so punctuation and word
 * order stay correct (e.g. "Hello, world!" never renders as "!Hello, world").
 * `lang="en"` gives screen readers and browsers the right language.
 *
 * Rule: every piece of English shown to the learner goes through <En>.
 */
export function En({ children, className }: EnProps) {
  return (
    <span dir="ltr" lang="en" className={className}>
      {children}
    </span>
  );
}

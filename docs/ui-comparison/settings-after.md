# Settings before / after

Before: one long Interpreter section mixed answer behavior, provider credentials, model catalog and translation-related settings. The sidebar had one generic Interpreter destination and mobile navigation had no focus or Escape behavior.

After: the existing `section=interpreter` route remains valid, while the sidebar exposes separate deep links for `answer-subsection`, `translation-subsection`, and `providers-subsection`. The page shows an always-visible summary for answer model, translation model and provider count. Model selectors persist independently as `interpreterModel` and `translationModel`; the translation selector never falls back to the answer model. The mobile drawer has an `aria-expanded` state, keyboard activation, Escape close and focus return. Content scrolls independently, controls use stable 40px minimum targets, and reduced-motion removes smooth scrolling.

Evidence files: `settings-before.html`, `settings-before.scss`, `settings-after.html`, `settings-after.scss`.

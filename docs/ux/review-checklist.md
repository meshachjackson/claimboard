# UX review checklist

**When to use:** copy this list into the description of every pull request that changes UI in `app/`, and tick each item before asking for review.

- [ ] Label comes from the glossary; no new synonym
- [ ] Glossary, `/help`, shortcuts list and changelog updated in this PR
- [ ] The next move is visible without scrolling or opening anything
- [ ] Empty, loading, saving, failed and read-only states all designed
- [ ] Nothing shows a zero before data loads
- [ ] Color is never the only signal; text 4.5:1, UI 3:1
- [ ] Targets 24px or more (44px on phone); keyboard path works; focus visible
- [ ] Works at 375px
- [ ] Nielsen heuristics pass done (H1, H2, H4, H5, H6, H8 at minimum); findings pasted in PR
- [ ] Taxonomy map regenerated if nav, labels or settings changed

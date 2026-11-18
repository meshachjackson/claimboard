# Accessibility

The board aims for WCAG 2.2 AA in both themes. This page lists the targets, how to check them, and what is known to fall short. Colors live in `app/assets/css/main.css` (neutral tokens) and `app/types/board.ts` (status colors). Fix a failing color in the token, not in a component.

## Targets

| What | Target | Source |
|---|---|---|
| Body text | 4.5 to 1 against what it sits on | WCAG 1.4.3 |
| Large text (24px, or 18.66px bold) | 3 to 1 | WCAG 1.4.3 |
| Placeholder text | 4.5 to 1 (it is set to `--color-text3`) | WCAG 1.4.3 |
| Icons, field borders, switch tracks, focus ring | 3 to 1 | WCAG 1.4.11 |
| Click targets, desktop | 24 by 24 CSS px | WCAG 2.5.8 |
| Click targets, phone (under 768px): tabs, bottom bar, header buttons, card actions, sheet and panel buttons, settings choices | 44 by 44 | Board rule |
| Text on phone | 12px or larger | Board rule |
| Color | Never the only signal. Every pill, dot and lane has words or an accessible name; a dot beside a label is `aria-hidden` | WCAG 1.4.1 |
| Card color | Only Working, Needs you and Blocked use color; everything else is gray | `test/quiet-color.test.ts` |
| Keyboard | Every control reachable, a visible focus ring on every stop, panels return focus to what opened them, "Skip to content" is the first stop | WCAG 2.1.1, 2.4.1, 2.4.7 |
| Motion | `prefers-reduced-motion` stops every animation and transition (`main.css`) | WCAG 2.3.3 |
| Zoom | 200% at 1280px wide (a 640px page) shows no clipped primary control and no sideways scroll | WCAG 1.4.4, 1.4.10 |

Tokens that were raised in Phase 6: `--color-input` (field borders, switch tracks) and `--color-dash` in light, `--color-input` in dark, the placeholder color, and Nuxt UI's `--ui-text-muted` and `--ui-text-dimmed`.

How a target is counted: the control's own box, or the larger area its `::after` covers when the control is a stretched link (a card title that opens the whole card) or has added padding for reach (switches). An input inside a `<label>` counts as the label. Text links inside a sentence are exempt (WCAG 2.5.8 inline rule).

## How to rerun the check

1. Open the page in the theme and width you want to test. Light and dark follow Settings > Appearance or the system.
2. Paste the whole of [`docs/ux/a11y-audit.js`](a11y-audit.js) into the browser console and press Enter. It returns one object for the page you are on: counts, then the first 40 failures of each kind.
3. Open the panel you want checked (a card, the command palette, Filters) and run it again. The script measures what is on screen.
4. To sweep many pages in one go, wrap it: for each path, `router.push(path)`, wait two seconds, run the script, and collect the `counts`.

What the counts mean:

- `contrastFails`: text under its ratio, placeholders under 4.5, icon-only controls and field borders under 3. Disabled controls are listed apart because WCAG exempts them.
- `targetsUnderMin`: visible click targets under 24px (under 44px on phone for buttons, tabs and nav links).
- `unnamedStatus`: colored dots and pills with no text and no accessible name.
- `textUnder12px`: reported on phone widths only.
- `ringRatios`: the focus ring color against the page ground and the card surface.

## Known exceptions

1. **Disabled buttons** (Send and Reply while a box is empty) look gray on purpose. WCAG 1.4.3 exempts disabled controls.
2. **Pages outside the Phase 6 list** were not fixed to the same standard: `/report` (glyph chips 2.8 to 4.1 to 1; 21 small remove and select buttons), `/registry/map` (the "›" glyph at 3.75 to 1). They stay on the follow-up list.
3. **Placeholder color equals secondary text.** To reach 4.5 to 1 the placeholder uses `--color-text3`, so it is no longer much lighter than typed text. The label above or beside the field carries the meaning.
4. **Closing animation in a hidden browser pane.** When the browser pane is hidden, a closing card panel can stay mounted through a route change, and the script then counts its Close button on the next page. It is a test artifact, not a bug a person sees.
5. **Not tested with a screen reader.** The audit checks names and roles in the page, and the keyboard walk is real, but no VoiceOver pass has been done.

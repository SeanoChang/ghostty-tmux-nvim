# Prototype: a working product with no backend

The reader uses the product. They click through real flows on realistic data
and come away knowing what it feels like. A prototype that looks right but
does nothing has failed.

## Principles

- **It works.** Every visible control does something. If a feature is out of
  scope, it is visibly disabled with a reason on hover ("Not in this demo"),
  never a dead click.
- **Realistic seeded data.** Use named, plausible, internally consistent data:
  IDs, owners, timestamps relative to now, numbers that add up. A small "Demo
  data" chip in the header says so. Never present invented figures as Sean's
  own.
- **A simulated backend.** One in-page `api` object with async functions,
  150–600 ms of jittered latency, and failures you can trigger from a dev
  panel. Then loading, error and retry states are real, not mocked screens.
- **A clock when the product is about processes** (deploys, jobs, queues):
  one simulation clock with speed control (1×, 10×, 60×), driving every timer
  and chart.
- **Persistence.** State lives in memory and in `Kit.store` (localStorage), so
  a reload keeps your changes. A "Reset demo" control restores the seed. Bump
  the storage key when the seed shape changes.
- **First screen = the main view at work**, plus a dismissible "Try this"
  card with three concrete tasks ("Start a rollout of checkout-api v2.14",
  "Inject a latency fault", "Watch it roll back"). The card is the product's
  guided tour.
- **Every state is designed:** empty (says what will appear and how to add
  the first item), loading (`.skeleton` shaped like the content), error (what
  went wrong and how to fix it, plus Retry), success (a toast, with Undo where
  the action allows). Destructive actions confirm inside the page (`.modal`);
  `confirm()` returns false in the viewer.
- **Keyboard.** `⌘K` opens a command palette when the product has more than a
  handful of actions; `?` lists shortcuts; Escape closes the top layer.
- **"How it works" drawer.** Map first: the product's architecture as named
  blocks and wires with a separate legend. Then the ladder for the core
  mechanism (why it works the way it does) and one check question
  (`.decide`). This is where a prototype teaches.

## Layout

Use the app shell from claude.css: `.app` > `.app-side` (navigation) +
`.app-main` > `.app-head` (title, primary action, demo chip) + `.app-body`.
Below 860 px the side rail becomes a scrolling top tab row. Typical patterns:
a list leading to a detail, or an overview with drill-down. Put the summary
before the detail: status counts and the thing needing attention at the top.

Encode state in form as well as colour: `Kit.status(tone, label)` pills, icons
in list rows, a severity column. The tones are blue (ok), orange (warn),
purple (bad) and gray (info), each with its icon and word; there is no green
or red. Semantic tones are separate from the clay accent. Interface text
follows "Writing" in SKILL.md: short, active, plain; buttons say exactly what
happens ("Roll back", then a toast "Rolled back").

## One-file architecture

```js
const KEY = 'rollout-demo-v1';
const seed = () => ({ services: [...], rollouts: [...], events: [] });
let state = Kit.store.get(KEY, null) || seed();
const save = () => Kit.store.set(KEY, state);

const delay = (lo = 150, hi = 600) => new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));
const faults = { api: false };                       // toggled from the dev panel
const api = {
  async startRollout(id, version) { await delay(); if (faults.api) throw new Error('Deploy service timed out after 30 s'); /* mutate state */ save(); },
};

// Views: small render functions; events through delegation on data-action.
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]'); if (!a) return;
  actions[a.dataset.action]?.(a.dataset, e);
});
```

- Re-render only the region that changed. Keep a `render()` per view, called
  after each state change.
- Build markup with template strings, and escape any user-entered text with
  `Kit.esc`.
- No framework unless the app is large. If it is, load React 18 UMD from
  cdnjs, pinned (react/18.3.1, react-dom/18.3.1), and use `htm` from jsDelivr
  pinned for JSX-free templates.
- Forms: `submit` handlers with `preventDefault()`. Give every control a
  stable `id`.

## Dev panel

A collapsible panel (bottom-left, or under the "Try this" card) for things
only a demo needs: inject a fault, change simulation speed, reset the demo. It
lets Sean experience the failure paths, which is where products show their
quality.

## Checklist

- [ ] It opens on the main view with realistic data and a "Try this" card.
- [ ] Each "Try this" task can be completed end to end.
- [ ] Empty, loading, error and success states exist and read well.
- [ ] Destructive actions confirm in-page; Undo exists where it can.
- [ ] A reload keeps changes; Reset demo restores the seed.
- [ ] Status shows icon + word + tone in blue / orange / purple / gray; no green or red.
- [ ] The "How it works" drawer opens with an architecture map, then the ladder and a check question.
- [ ] At 390 px the navigation becomes tabs and the main view stays usable.

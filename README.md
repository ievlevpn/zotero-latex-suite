# LaTeX Suite for Zotero

**Write LaTeX in your PDF annotations and see it rendered as you type.** Zotero
renders equations in notes but not in annotation comments, where most reading
notes actually get written — so a comment reading `the bound $\|x\|_2 \leq 1$
holds` stays as raw source. This plugin renders it, live, in the reader sidebar,
the in-page popups, the item pane, and the text boxes drawn on the page.

It also brings the snippets from
[Obsidian Latex Suite](https://github.com/artisticat1/obsidian-latex-suite) to
both annotations and notes, so the LaTeX is quick to type in the first place:

```
mk          →  inline equation
dm          →  display equation
x/y  Tab    →  \frac{x}{y}
@t          →  \theta
sqx         →  \sqrt{x}
dint Tab 2pi Tab sin @t Tab @t Tab  →  \int_{0}^{2\pi} \sin \theta \, d\theta
```

The snippet format is unchanged from upstream, so if you already use
obsidian-latex-suite you can point this at the very same file and get the same
shortcuts in both — see [Sharing snippets with Obsidian](#sharing-snippets-with-obsidian).
It ships with Latex Suite's [default snippets](src/default_snippets.js) — 220-odd
of them — which you can edit, remove or replace in **Settings → LaTeX Suite**.

## Install

Download `latex-suite.xpi` from the
[latest release](https://github.com/ievlevpn/zotero-latex-suite/releases/latest)
→ Zotero → Tools → Plugins → ⚙ → Install Plugin From File… Updates are automatic.

## Features

- **Live rendering in annotations** — `$…$` and `$$…$$` in a comment are drawn
  as you write, everywhere annotations appear. The equation the cursor is inside
  stays as source so you can keep editing it; click a rendered one to get back
  into it.
- **Snippets** — triggers, tabstops with placeholders, regex triggers, visual
  (selection-wrapping) snippets, function replacements, snippet variables,
  priorities. The format and every option letter are unchanged, so
  [Latex Suite's DOCS.md](https://github.com/artisticat1/obsidian-latex-suite/blob/main/DOCS.md#snippets)
  is the reference.
- **Auto-fraction** — `x/` becomes `\frac{x}{}`, brackets and greek letters
  included.
- **Tabout** — <kbd>Tab</kbd> at the end of an equation leaves it; otherwise it
  advances past the next closing bracket.
- **Matrix shortcuts** — inside `pmatrix`, `cases`, `align` and friends,
  <kbd>Tab</kbd> adds a cell, <kbd>Enter</kbd> a row, <kbd>Shift</kbd>+<kbd>Enter</kbd>
  leaves.
- **Auto-enlarge brackets** — a bracket pair containing `\sum`, `\int`, `\frac`…
  grows a `\left`/`\right`.

### Annotations

Snippets and rendering also work in PDF/EPUB **annotation comments**. Those are
plain text, so there an equation is `$…$` / `$$…$$` exactly as in Obsidian —
which is also what makes it portable: it survives sync and export, and "Add Note
from Annotations" turns it into a real equation in the note.

`$…$` renders as you write. Every equation in the comment is drawn except the
one the cursor is inside, which stays as source so you can keep editing it —
click a rendered equation to get back into it. Works in the reader sidebar, the
in-page popups, and the item pane's annotation list.

Typing does not disturb the equations you are not editing. Zotero reads a
comment back out of its own DOM on every keystroke, so the rendering has to come
out of the way first; it goes back in during the same event, before the browser
paints, and from a cache keyed on the LaTeX source — so an equation only goes
through KaTeX again when its source actually changes.

**Text annotations** — the boxes the reader's *Add Text* tool puts on the page —
get the same treatment: snippets while you type in one, and its `$…$` rendered
on the page once you click away. A text box is a plain textarea, which cannot
hold rendered math, so while you are editing one it shows all of its source;
the rendering is laid over it, and the annotation itself is never touched.
Zotero sizes the box to fit the source, so rendered math, which is usually
narrower, may leave room on the right, and a tall display equation can run past
the bottom edge. A PDF exported with annotations carries the source text, since
that is what the annotation holds.

Zotero keeps a text annotation as plain text, with no bold or italic, so those
are written the markdown way — `**bold**` and `*italic*` — and drawn as such on
the page. Asterisks only; a `*` with a space on both sides, or inside an
equation, stays a star, and `\*` is always one.

Rendering is via KaTeX's MathML output, which Firefox draws natively, so the
plugin ships no fonts. Inline `$…$` has to look like an equation and not like
"$5 and $10", so a dollar pair with a space just inside it is left alone.

## How it maps onto Zotero

Zotero notes aren't markdown: an equation is a node in the note, and its LaTeX
source is edited in its own little editor, rendered live with KaTeX. That makes
most of the mapping easy and one part interesting:

- **Math mode is structural.** `m`/`n`/`M` mean "the cursor is in an equation
  node", not "the cursor is between `$` signs". No `$` scanning, no ambiguity.
- **`$…$` in a text-mode replacement creates an equation.** That is what
  Latex Suite's `mk` and `dm` snippets mean, so they work unchanged: `mk` gives
  an inline equation, `dm` a display one, with the tabstops inside it.
- **`t` (text mode) is the note itself** — paragraphs, headings, list items.
- **`c` / `C` (code) is a Zotero code block.**
- **In annotations none of that applies** — they hold plain text, so math is
  found by scanning for `$` the way Latex Suite does.

Features that only made sense against markdown are not here: conceal, inline
math preview, and bracket colouring all exist to show you what your `$…$` means,
and Zotero already renders the equation as you type.

### Compatibility

The snippet format is the promise this plugin makes, so every example in
[Latex Suite's DOCS.md](https://github.com/artisticat1/obsidian-latex-suite/blob/main/DOCS.md)
is a test — see `test-compat.mjs`. That covers tabstops and placeholders,
same-index tabstop groups, regex triggers by option and by literal, flags,
snippet variables in all three spellings, visual snippets as strings and as
functions, function replacements (including returning `false` to decline), the
`require("latex-suite")` node API with named capture groups, priority and
trigger-length ordering, every option letter, `excludedEnvironments` /
`excludedMacros` / `includedMacros`, the `.md`-wrapped snippet file format, and
folders of snippet files.

Where it deliberately differs:

- **Tabstops that share a number** are all inserted, but only the first is
  selected. Latex Suite puts a cursor in each; neither editor here has more than
  one selection.
- **The `U` option is inert.** Undo of an automatic expansion is one step: it
  restores what you had before the trigger rather than the trigger itself.
- **`language` and code-block modes are limited.** A Zotero code block carries no
  language, so a snippet with `language: "python"` can never match; plain `c` and
  `C` work.
- **Conceal, inline math preview and bracket colouring are absent**, as above:
  Zotero already renders the equation.

## Layout

Mirrors obsidian-latex-suite's, minus what does not apply:

```
bootstrap.js            chrome side: settings pane, and injecting the engine
                        into each note-editor iframe
src/
  main.ts               keymap, in DOCS.md#keymap-order
  default_snippets.js   the shipped snippets, copied verbatim from upstream
  editor/               what replaces CodeMirror: a flat string and a cursor
    buffer.ts           the contract, and its two backends
    pm.ts               ProseMirror, for notes
    contenteditable.ts  plain contenteditable, for annotation comments
    insert_math.ts      `$…$` in text mode -> an equation node (notes only)
  reader/annotations.ts rendering `$…$` in the reader
  render/math.ts        KaTeX -> MathML, shared with the item pane
  snippets/             parse.ts, snippets.ts, options.ts, tabstop.ts,
                        snippet_management.ts, sort.ts, luasnip_api/
  features/             run_snippets, autofraction, tabout, matrix_shortcuts,
                        auto_enlarge_brackets
  settings/settings.ts  defaults, and compiling them for the engine
  utils/                context.ts (where the cursor is), tokenizer, brackets
notes/                  what the Zotero note editor looks like from inside
```

## Development

```sh
npm install
npm run build     # -> build/content-script.js
npm run watch
node test.js      # engine self-check, outside Zotero
```

To run it from a checkout, point Zotero at the folder: create a file named
`latex-suite@ievlevpn.github.io` in `<profile>/extensions/` containing the absolute path
to this directory, then restart Zotero.

`./release.sh` builds, tests, tags and publishes.

## Credits and license

The snippet engine, the snippet format, and the default snippets are ported from
[artisticat1/obsidian-latex-suite](https://github.com/artisticat1/obsidian-latex-suite)
by artisticat1, which in turn follows
[Gilles Castel's UltiSnips setup](https://castel.dev/post/lecture-notes-1/). The
annotation rendering, and everything that makes any of it work against Zotero's
editors, is this project's.

Unaffiliated with obsidian-latex-suite and not endorsed by it. Please don't take
bug reports there for anything that only happens here.

MIT, for both the original and this port — see [LICENSE](LICENSE).

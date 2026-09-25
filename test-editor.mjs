/* Editor-layer checks: the ProseMirror side, driven headlessly.
 *
 * The schema mirrors the parts of Zotero's note schema the engine touches (see
 * notes/zotero-note-editor.md): math nodes are atoms whose content is unmarked
 * text, edited in a nested view whose doc *is* the math node; and an inline
 * equation inside a paragraph is one character of text but several ProseMirror
 * positions.
 *
 * Only the DOM lookup in getActiveMathView needs a real note editor, and it is
 * three property reads, so it is faked here and everything else is the real code.
 */
import assert from "node:assert";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import * as ls from "./build/test-exports.mjs";

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { group: "block", content: "(text | hardBreak | math_inline)*", toDOM: () => ["p", 0] },
		math_display: { group: "block math", content: "text*", atom: true, code: true, toDOM: () => ["pre", 0] },
		math_inline: { group: "inline math", content: "text*", marks: "", inline: true, atom: true, toDOM: () => ["span", 0] },
		hardBreak: { inline: true, group: "inline", selectable: false, toDOM: () => ["br"] },
		text: { group: "inline" },
	},
	marks: { strong: { toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }] } },
});

/** A stand-in for EditorView: Buffer only ever uses state, schema and dispatch. */
function viewOf(doc, from, to = from) {
	const view = {
		state: EditorState.create({ doc, schema }),
		dispatch(tr) { view.state = view.state.apply(tr); },
	};
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
	ls.rememberSelectionClass(view);
	return view;
}

/** The nested view prosemirror-math opens on an equation. */
export function mathView(text, cursor = text.length, type = "math_inline") {
	return viewOf(schema.nodes[type].create(null, text ? schema.text(text) : null), cursor);
}

/** A window whose activeElement sits inside that equation, as Zotero's would. */
export function winFor(view, type = "math_inline") {
	const el = { tagName: type.replace("_", "-").toUpperCase(), pmViewDesc: { spec: { _innerView: view } } };
	return { document: { activeElement: { closest: (sel) => (sel === ".math-node" ? el : null) } } };
}

const settingsFor = (source) =>
	ls.processSettings({ ...ls.DEFAULT_SETTINGS, snippets: source, snippetVariables: "export default {}" });

const automatic = (settings) => settings.snippets.filter((s) => s.options.automatic);
const text = (view) => view.state.doc.textContent;
const cursor = (view) => [view.state.selection.from, view.state.selection.to];

/* A Buffer over a plain string, standing in for an annotation comment.
 * The reader's real backend adds only DOM plumbing on top of this contract:
 * offsets into flat text, and edits that replace a range. */
export class StringBuffer {
	constructor(text, from = text.length, to = from) {
		this.text = text;
		this.from = from;
		this.to = to;
		this.owner = { annotation: true };
		this.remaps = [];
	}
	get mathBounds() { return ls.mathBoundsAt(this.text, this.to); }
	get kind() { return this.mathBounds ? (this.mathBounds.display ? "math_display" : "math_inline") : "text"; }
	get inMath() { return this.mathBounds !== null; }
	get selectedText() { return this.text.slice(this.from, this.to); }
	get dollarMath() { return true; }
	applyChange(from, to, insert, tabstops = [], selection) {
		this.text = this.text.slice(0, from) + insert + this.text.slice(to);

		// The same bias a real editor maps with: a range's start holds still and
		// its end follows, so text typed into a placeholder extends it.
		const delta = insert.length - (to - from);
		const map = (range) => ({
			from: range.from <= from ? range.from : range.from >= to ? range.from + delta : from,
			to: range.to < from ? range.to : range.to >= to ? range.to + delta : from + insert.length,
		});
		for (const remap of this.remaps) remap(map);

		const caret = selection ?? { from: insert.length, to: insert.length };
		this.from = from + caret.from;
		this.to = from + caret.to;
		return tabstops.map((ts) => ({ from: from + ts.from, to: from + ts.to }));
	}
	replaceRange(from, to, insert) { this.applyChange(from, to, insert); }
	selectRange(range) { this.from = range.from; this.to = range.to; }
	positionAt(offset) { return offset; }
	setSelection(from, to = from) { this.from = from; this.to = to; }
	get document() { return null; }        // no DOM here, so no marks to draw
	clientRects() { return []; }
	exitMath() {
		if (!this.mathBounds) return false;
		this.from = this.to = this.mathBounds.outer_end;
		return true;
	}
	watch(remap) { this.remaps.push(remap); }
}

/** A window shaped like the note editor's: an EditorCore on the iframe window. */
function noteWin(view, activeElement = null) {
	view.hasFocus = () => true;
	view.dom = { closest: () => null, ownerDocument: null };
	return {
		_currentEditorInstance: { _editorCore: { view, insertMath: () => { throw new Error("fell back to insertMath"); } } },
		document: { activeElement, getElementById: () => null },
	};
}

const docOf = (...blocks) => schema.nodes.doc.create(null, blocks);
const para = (...content) => schema.nodes.paragraph.create(null, content.length ? content : undefined);

export function run() {
	/* --- the reported bug: "@a" must consume the "@" *and* the typed "a" --- */
	{
		const settings = settingsFor(`export default [{trigger: "@a", replacement: "\\\\alpha", options: "mA"}]`);
		const view = mathView("@");
		const expanded = ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings);
		assert.strictEqual(expanded, true, "@a should expand");
		assert.strictEqual(text(view), "\\alpha", `@ + a gave ${JSON.stringify(text(view))}`);
		assert.deepStrictEqual(cursor(view), [6, 6]);
	}

	/* --- and in the middle of an expression --- */
	{
		const settings = settingsFor(`export default [{trigger: "@a", replacement: "\\\\alpha", options: "mA"}]`);
		const view = mathView("x + @", 5);
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings);
		assert.strictEqual(text(view), "x + \\alpha");
	}

	/* --- tabstops: first one selected, Tab walks the rest --- */
	{
		const settings = settingsFor(`export default [{trigger: "//", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`);
		const view = mathView("/");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "/" }, settings);
		assert.strictEqual(text(view), "\\frac{}{}");
		assert.deepStrictEqual(cursor(view), [6, 6], "cursor should be in the numerator");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		assert.deepStrictEqual(cursor(view), [8, 8], "Tab should reach the denominator");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		assert.deepStrictEqual(cursor(view), [9, 9], "Tab should reach the end");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), false, "no tabstops left");
		ls.clearTabstops();
	}

	/* --- leaving the equation finishes the snippet, marks and all --- */
	{
		const settings = settingsFor(`export default [{trigger: "//", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`);
		const view = mathView("/");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "/" }, settings);
		assert.strictEqual(ls.hasTabstops(), true, "a snippet with tabstops is in flight");

		// The caret is still in the numerator: nothing to finish.
		ls.clearTabstopsIfElsewhere(ls.PMBuffer.forMath(view, "math_inline"));
		assert.strictEqual(ls.hasTabstops(), true, "still in the tabstop it landed in");

		// Out of it — the note around it, or nothing focused at all.
		ls.clearTabstopsIfElsewhere(undefined);
		assert.strictEqual(ls.hasTabstops(), false, "leaving the buffer drops the tabstops");
	}

	/* --- and so does the caret walking out of the snippet inside one buffer ---
	 *
	 * The reported bug: in an annotation comment the whole comment is one
	 * buffer, so stepping out of the equation never changes the owner and the
	 * marks stayed painted over the rendered result. */
	{
		const buffer = new StringBuffer("see $x/", 7);
		const settings = settingsFor(`export default [{trigger: "/", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`);
		ls.expandSnippet(buffer, 6, 7, automatic(settings)[0].process({
			effectiveLine: "see $x/", range: { from: 6, to: 7 }, sel: "", effectiveLineAfter: () => "", api: {},
		}).replacement);
		assert.strictEqual(buffer.text, "see $x\\frac{}{}");
		assert.strictEqual(ls.hasTabstops(), true);

		// Still in the numerator, same buffer: nothing to finish.
		ls.clearTabstopsIfElsewhere(buffer);
		assert.strictEqual(ls.hasTabstops(), true, "sitting in the tabstop it landed in");

		// Typing into the empty placeholder has to keep it, not end the snippet.
		buffer.applyChange(12, 12, "y");
		ls.clearTabstopsIfElsewhere(buffer);
		assert.strictEqual(ls.hasTabstops(), true, "typing into a placeholder stays inside it");

		// Clicking back into the text before the equation is leaving the snippet,
		// even though the buffer is the same one.
		buffer.setSelection(2);
		ls.clearTabstopsIfElsewhere(buffer);
		assert.strictEqual(ls.hasTabstops(), false, "the caret left every tabstop");
	}

	/* --- clicking back into a placeholder resumes from there --- */
	{
		const buffer = new StringBuffer("/", 1);
		const settings = settingsFor(`export default [{trigger: "/", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`);
		ls.expandSnippet(buffer, 0, 1, automatic(settings)[0].process({
			effectiveLine: "/", range: { from: 0, to: 1 }, sel: "", effectiveLineAfter: () => "", api: {},
		}).replacement);
		assert.strictEqual(ls.setSelectionToNextTabstop(buffer, false), true, "Tab to the denominator");
		assert.deepStrictEqual([buffer.from, buffer.to], [8, 8]);

		buffer.setSelection(6); // back into the numerator with the mouse
		ls.clearTabstopsIfElsewhere(buffer);
		assert.strictEqual(ls.hasTabstops(), true, "an earlier placeholder is still this snippet");
		assert.strictEqual(ls.setSelectionToNextTabstop(buffer, false), true);
		assert.deepStrictEqual([buffer.from, buffer.to], [8, 8], "Tab picks up from there again");
		ls.clearTabstops();
	}

	/* --- placeholders are selected, and typing into one keeps the later ones valid --- */
	{
		const settings = settingsFor(
			`export default [{trigger: "dint", replacement: "\\\\int_{\${0:0}}^{\${1:\\\\infty}} $2", options: "mA"}]`);
		const view = mathView("din");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "t" }, settings);
		// the trailing space is trimmed in inline math (removeSnippetWhitespace)
		assert.strictEqual(text(view), "\\int_{0}^{\\infty}");
		assert.deepStrictEqual(cursor(view), [6, 7], "the \"0\" placeholder should be selected");

		// Replace the placeholder with something longer; the next tabstop must follow.
		view.dispatch(view.state.tr.insertText("2\\pi", 6, 7));
		assert.strictEqual(text(view), "\\int_{2\\pi}^{\\infty}");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		const [from, to] = cursor(view);
		assert.strictEqual(text(view).slice(from, to), "\\infty", "second placeholder should have moved with the edit");
		ls.clearTabstops();
	}

	/* --- word boundary --- */
	{
		const settings = settingsFor(`export default [{trigger: "dm", replacement: "X", options: "mAw"}]`);
		const glued = mathView("xd");
		assert.strictEqual(
			ls.runSnippets(winFor(glued), { snippets: automatic(settings), key: "m" }, settings), false,
			"\"xdm\" is not on a word boundary");
		const free = mathView("x d");
		assert.strictEqual(ls.runSnippets(winFor(free), { snippets: automatic(settings), key: "m" }, settings), true);
		assert.strictEqual(text(free), "x X");
	}

	/* --- visual snippets wrap the selection --- */
	{
		const settings = settingsFor(
			`export default [{trigger: "U", replacement: "\\\\underbrace{ \${VISUAL} }_{ $0 }", options: "mA"}]`);
		const view = mathView("a+b", 0);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, 3)));
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "U" }, settings);
		assert.strictEqual(text(view), "\\underbrace{ a+b }_{  }");
		ls.clearTabstops();
	}

	/* --- regex snippets replace only what they matched --- */
	{
		const settings = settingsFor(
			`export default [{trigger: /([A-Za-z])(\\d)/, replacement: "[[0]]_{[[1]]}", options: "mA"}]`);
		const view = mathView("1 + x");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "2" }, settings);
		assert.strictEqual(text(view), "1 + x_{2}");
	}

	/* --- mode gating: a text-mode snippet must not fire inside an equation --- */
	{
		const settings = settingsFor(`export default [{trigger: "@a", replacement: "NOPE", options: "tA"}]`);
		const view = mathView("@");
		assert.strictEqual(ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings), false);
		assert.strictEqual(text(view), "@");
	}

	/* --- ...and \text{} inside math counts as text --- */
	{
		const settings = settingsFor(`export default [
			{trigger: "@a", replacement: "\\\\alpha", options: "mA"},
			{trigger: "@a", replacement: "TEXT", options: "TA"},
		]`);
		const view = mathView("\\text{@");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings);
		assert.strictEqual(text(view), "\\text{TEXT");
	}

	/* --- display math is a separate mode --- */
	{
		const settings = settingsFor(`export default [
			{trigger: "xx", replacement: "BLOCK", options: "MA"},
			{trigger: "xx", replacement: "INLINE", options: "nA"},
		]`);
		const inline = mathView("x");
		ls.runSnippets(winFor(inline), { snippets: automatic(settings), key: "x" }, settings);
		assert.strictEqual(text(inline), "INLINE");

		const block = mathView("x", 1, "math_display");
		ls.runSnippets(winFor(block, "math_display"), { snippets: automatic(settings), key: "x" }, settings);
		assert.strictEqual(text(block), "BLOCK");
	}

	/* --- auto-fraction --- */
	{
		const settings = settingsFor("export default []");
		const view = mathView("1 + (a+b)");
		assert.strictEqual(ls.runAutoFraction(winFor(view), settings), true);
		assert.strictEqual(text(view), "1 + \\frac{a+b}{}");
		ls.clearTabstops();
	}

	/* --- a text block: offsets and positions differ around an inline equation --- */
	{
		const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [
			schema.text("ab"),
			schema.nodes.math_inline.create(null, schema.text("x^2")),
			schema.text("cd"),
		]));
		// cursor at the very end of the paragraph
		const end = doc.content.size - 1;
		const view = viewOf(doc, end);
		const buffer = ls.PMBuffer.forTextBlock(view);
		assert.strictEqual(buffer.text, "ab￼cd", "an inline equation counts as one character");
		assert.strictEqual(buffer.to, 5);

		// text offset -> position -> text offset round-trips on both sides of the atom
		for (const offset of [0, 1, 2, 3, 4, 5]) {
			assert.strictEqual(buffer.textOffset(buffer.pmPos(offset)), offset, `offset ${offset} round-trip`);
		}
		// the atom is 5 positions wide (open + 3 chars + close), one character wide
		assert.strictEqual(buffer.pmPos(3) - buffer.pmPos(2), 5);

		// a replacement after the atom lands where it should
		buffer.applyChange(3, 5, "CD");
		assert.strictEqual(view.state.doc.firstChild.textContent, "abx^2CD");
	}

	/* --- marks are carried into a text-mode replacement --- */
	{
		const bold = schema.marks.strong.create();
		const doc = schema.nodes.doc.create(null,
			schema.nodes.paragraph.create(null, [schema.text("hi", [bold])]));
		const view = viewOf(doc, 3);
		const buffer = ls.PMBuffer.forTextBlock(view);
		buffer.applyChange(2, 2, "!");
		assert.deepStrictEqual(view.state.doc.firstChild.child(0).marks.map((m) => m.type.name), ["strong"]);
		assert.strictEqual(view.state.doc.firstChild.childCount, 1, "the inserted text should join the bold run");
	}

	/* --- \n in a paragraph becomes a hard break, not a stray character --- */
	{
		const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("a")));
		const view = viewOf(doc, 2);
		ls.PMBuffer.forTextBlock(view).applyChange(1, 1, "x\ny");
		const p = view.state.doc.firstChild;
		assert.deepStrictEqual(
			[...Array(p.childCount)].map((_, i) => p.child(i).type.name),
			["text", "hardBreak", "text"],
		);
	}

	/* --- annotations: math mode comes from the `$` delimiters --- */
	{
		const inside = new StringBuffer("note $x + @", 11);
		assert.strictEqual(ls.Context.fromBuffer(inside).mode.inlineMath, true, "inside $…$ is inline math");
		const outside = new StringBuffer("just a note", 11);
		assert.strictEqual(ls.Context.fromBuffer(outside).mode.text, true, "prose is text mode");
		const block = new StringBuffer("$$ x + @", 8);
		assert.strictEqual(ls.Context.fromBuffer(block).mode.blockMath, true, "inside $$…$$ is block math");

		// scopes are scanned from the start of the equation, not of the comment
		const inText = new StringBuffer("prose $a \\text{@");
		const ctx = ls.Context.fromBuffer(inText);
		assert.deepStrictEqual(ctx.getEnvNames().map((x) => x.name), ["text"]);
		assert.strictEqual(ctx.mode.textEnv, true);
	}

	/* --- and a snippet expands there, tabstops and all --- */
	{
		const buffer = new StringBuffer("see $\\frac{a}{b} din", 20);
		const settings = settingsFor(
			`export default [{trigger: "dint", replacement: "\\\\int_{\${0:0}}^{\${1:\\\\infty}}", options: "mA"}]`);
		const snippet = settings.snippets.filter((s) => s.options.automatic)[0];
		const ctx = ls.Context.fromBuffer(buffer);
		assert.strictEqual(snippet.options.snippetShouldRunInMode(ctx.mode), true);

		const result = snippet.process({
			effectiveLine: buffer.text.slice(0, buffer.to) + "t",
			range: { from: buffer.from, to: buffer.to },
			sel: "", effectiveLineAfter: () => "", api: {},
		});
		ls.expandSnippet(buffer, result.triggerPos, buffer.to, result.replacement);
		assert.strictEqual(buffer.text, "see $\\frac{a}{b} \\int_{0}^{\\infty}");
		assert.strictEqual(buffer.text.slice(buffer.from, buffer.to), "0", "the 0 placeholder is selected");
		assert.strictEqual(ls.setSelectionToNextTabstop(buffer, false), true);
		assert.strictEqual(buffer.text.slice(buffer.from, buffer.to), "\\infty");
		ls.clearTabstops();
	}

	/* --- leaving an equation means stepping past its closing $ --- */
	{
		const buffer = new StringBuffer("a $x^2$ b", 6);
		assert.strictEqual(buffer.exitMath(), true);
		assert.strictEqual(buffer.from, 7, "cursor lands after the closing dollar");
	}

	/* --- notes, text mode: the path `m`/`dm` take --- */
	{
		// a paragraph containing just "m", caret after it
		const view = viewOf(docOf(para(schema.text("m"))), 2);
		const win = noteWin(view);

		const buffer = ls.currentBuffer(win);
		assert.ok(buffer, "a focused paragraph is an editable buffer");
		assert.strictEqual(buffer.kind, "text");
		assert.strictEqual(buffer.text, "m");

		const settings = settingsFor(`export default [{trigger: "m", replacement: "$$0$", options: "t"}]`);
		const manual = settings.snippets.filter((s) => !s.options.automatic);
		assert.strictEqual(manual.length, 1, "a snippet without A is Tab-triggered");
		assert.strictEqual(ls.runSnippets(win, { snippets: manual }, settings), true, "m + Tab expands");

		// the "m" is gone and an inline equation stands in its place
		const paragraph = view.state.doc.firstChild;
		assert.strictEqual(paragraph.textContent, "", "the trigger is consumed");
		assert.strictEqual(paragraph.childCount, 1);
		assert.strictEqual(paragraph.child(0).type.name, "math_inline", "inline, not display");
		assert.strictEqual(view.state.selection.node?.type.name, "math_inline", "the equation is selected, which opens it");
		ls.clearTabstops();
	}

	/* --- notes, text mode: dm gives display math --- */
	{
		const view = viewOf(docOf(para(schema.text("dm"))), 3);
		const win = noteWin(view);
		// String.raw: the snippet source must contain a literal \n, not a newline
		const settings = settingsFor(String.raw`export default [{trigger: "dm", replacement: "$$\n$0\n$$", options: "t"}]`);
		ls.runSnippets(win, { snippets: settings.snippets.filter((s) => !s.options.automatic) }, settings);
		assert.strictEqual(view.state.doc.firstChild.type.name, "math_display");
		ls.clearTabstops();
	}

	/* --- auto-enlarge brackets --- */
	{
		const settings = settingsFor("export default []");
		const enlarge = (source, cursor = source.length) => {
			const view = mathView(source, cursor);
			ls.autoEnlargeBrackets(winFor(view), settings);
			return text(view);
		};

		assert.strictEqual(enlarge("(\\sum_{i} a_i)"), "\\left( \\sum_{i} a_i \\right)");
		assert.strictEqual(enlarge("(a + b)"), "(a + b)", "no trigger inside, so left alone");
		assert.strictEqual(
			enlarge("\\left( \\sum_{i} a_i \\right)"),
			"\\left( \\sum_{i} a_i \\right)",
			"already enlarged, so not enlarged again",
		);
		assert.strictEqual(enlarge("[\\int f]"), "\\left[ \\int f \\right]");
		assert.strictEqual(enlarge("x + (\\frac{a}{b})"), "x + \\left( \\frac{a}{b} \\right)");
		// nested
		assert.strictEqual(enlarge("((\\int f))"), "\\left( \\left( \\int f \\right) \\right)");
	}

	/* --- enlarging brackets must not eat the snippet's own tabstops --- */
	{
		// "$" + "{" so the template literal does not try to interpolate ${1:x}
		const settings = settingsFor(
			String.raw`export default [{trigger: "int", replacement: "\\int $0 \\, d` + "${1:x}" + String.raw` $2", options: "mA"}]`);

		const auto = settings.snippets.filter((s) => s.options.automatic);

		// "(in|)" — a closed pair, so \int inside it triggers auto-enlarge
		const view = mathView("(in)", 3);
		ls.runSnippets(winFor(view), { snippets: auto, key: "t" }, settings);
		assert.strictEqual(text(view), "\\left( \\int  \\, dx \\right)");

		// the cursor is still where the snippet put it, and Tab still works
		assert.strictEqual(text(view).slice(0, view.state.selection.from).endsWith("\\int "), true);
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		const [from, to] = cursor(view);
		assert.strictEqual(text(view).slice(from, to), "x", "the dx placeholder survived the enlargement");
		ls.clearTabstops();
	}

	/* --- typing a trigger inside `$…$`, the way an annotation comment works --- */
	{
		const settings = settingsFor(
			String.raw`export default [{trigger: "int", replacement: "\\int $0 \\, d` + "${1:x}" + String.raw` $2", options: "mA"}]`);
		const auto = settings.snippets.filter((s) => s.options.automatic);
		const win = { document: { activeElement: null, getElementById: () => ({}) } };

		let buffer = new StringBuffer("$f(x) = $", 8);
		for (const key of ["i", "n", "t"]) {
			const before = buffer.text;
			const at = buffer.to;
			if (!ls.runSnippets(win, { snippets: auto, key }, settings, buffer)) {
				buffer = new StringBuffer(before.slice(0, at) + key + before.slice(at), at + 1);
			}
		}
		// One expansion, replacing exactly the "in" that was typed — no leftovers.
		assert.strictEqual(buffer.text, "$f(x) = \\int  \\, dx$");
		assert.strictEqual(buffer.text.slice(0, buffer.to), "$f(x) = \\int ", "cursor at the first tabstop");
		ls.clearTabstops();
	}

	/* --- a snippet expanded inside a tabstop keeps the outer one's tabstops --- */
	{
		const tabstop = (index, at) => ({ index: [index], from: at, to: at });
		const buffer = new StringBuffer("", 0);

		// \frac{$0}{$1}$2
		ls.expandSnippet(buffer, 0, 0, {
			insert: "\\frac{}{}",
			tabstops: [tabstop(0, 6), tabstop(1, 8), tabstop(2, 9)],
		});
		assert.strictEqual(buffer.text, "\\frac{}{}");
		assert.deepStrictEqual([buffer.from, buffer.to], [6, 6], "cursor in the numerator");

		// now expand something with its own tabstops, right there in the numerator
		ls.expandSnippet(buffer, 6, 6, { insert: "xy", tabstops: [tabstop(0, 0), tabstop(1, 2)] });
		assert.strictEqual(buffer.text, "\\frac{xy}{}");

		const tab = () => (ls.setSelectionToNextTabstop(buffer, false) ? buffer.to : null);
		assert.strictEqual(tab(), 8, "the inner snippet's own second tabstop");
		assert.strictEqual(tab(), 10, "then back out to the denominator, not lost");
		assert.strictEqual(tab(), 11, "and the outer snippet's last tabstop");
		assert.strictEqual(tab(), null, "nothing left");
		ls.clearTabstops();
	}

	console.log("editor-layer tests passed");
}

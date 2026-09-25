/* The annotation-comment backend.
 *
 * Zotero's reader edits annotation comments in a plain contenteditable holding
 * plain text — no ProseMirror, and only <i>/<b>/<sub>/<sup> survive a round
 * trip, so an equation there is `$…$` literal text, exactly as in markdown.
 * See notes/zotero-note-editor.md.
 *
 * Edits go through `document.execCommand("insertText")` rather than writing to
 * the DOM: that keeps the browser's undo stack intact and fires the `input`
 * event the reader's React component listens for to persist the comment.
 */
import { Buffer, BufferKind, Range } from "./buffer";
import { MathBounds, mathBoundsAt } from "src/utils/math_bounds";
import { domPointAt, segmentsOf, selectionOffsets, setCaret } from "src/render/segments";

/**
 * The comment field, in both the sidebar and the in-page popup — those are two
 * different React components with different wrappers, but the same editor
 * inside. The neighbouring `text` field holds the passage quoted from the
 * document and is deliberately left alone.
 */
export const COMMENT_FIELD = ".comment .content";

/** Offsets describe the comment as Zotero stores it, rendered equations included. */
export class TextBuffer implements Buffer {
	readonly element: HTMLElement;
	readonly text: string;
	readonly from: number;
	readonly to: number;
	readonly mathBounds: MathBounds | null;

	private constructor(element: HTMLElement, text: string, from: number, to: number) {
		this.element = element;
		this.text = text;
		this.from = from;
		this.to = to;
		this.mathBounds = mathBoundsAt(text, to);
	}

	get owner(): object {
		return this.element;
	}

	get kind(): BufferKind {
		if (!this.mathBounds) return "text";
		return this.mathBounds.display ? "math_display" : "math_inline";
	}

	get inMath() {
		return this.mathBounds !== null;
	}

	get selectedText() {
		return this.text.slice(this.from, this.to);
	}

	/** Here `$…$` *is* math, so a replacement containing dollars needs no special handling. */
	get dollarMath() {
		return true;
	}

	static forElement(element: HTMLElement): TextBuffer | null {
		const selection = selectionOffsets(element);
		if (!selection) return null;
		return new TextBuffer(element, segmentsOf(element).text, selection.from, selection.to);
	}

	private select(from: number, to: number) {
		setCaret(this.element, from, to);
	}

	applyChange(
		from: number,
		to: number,
		insert: string,
		tabstops: readonly Range[] = [],
		selection?: Range,
	): Range[] {
		this.select(from, to);
		this.insert(from, to, insert);

		const at = (offsetInInsert: number) => from + offsetInInsert;
		const placed = tabstops.map((ts) => ({ from: at(ts.from), to: at(ts.to) }));

		const caret = selection ?? { from: insert.length, to: insert.length };
		this.select(at(caret.from), at(caret.to));

		return placed;
	}

	/**
	 * execCommand rather than a DOM write: undo keeps working, and the reader's
	 * own `input` handler is what saves the comment. That handler also strips
	 * anything it does not recognise, so the rendering layer takes the equations
	 * back out of the DOM before it runs.
	 *
	 * execCommand can decline, and does so silently, which would lose the
	 * expansion with no sign of why — so check, and edit the DOM directly if it
	 * did nothing, announcing the change ourselves.
	 */
	private insert(from: number, to: number, insert: string) {
		const doc = this.element.ownerDocument;
		const before = this.text;

		try {
			doc.execCommand("insertText", false, insert);
		} catch {
			/* fall through to the manual edit */
		}

		// Only when the browser did nothing at all. It is allowed to differ from
		// what we asked for — inserting consecutive spaces into HTML normalises
		// them — and re-running the edit on text it has already changed applies it
		// twice, against offsets that no longer mean anything.
		if (segmentsOf(this.element).text !== before) return;

		const { segments } = segmentsOf(this.element);
		const start = domPointAt(this.element, segments, from);
		const end = domPointAt(this.element, segments, to);
		const range = doc.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		range.deleteContents();
		if (insert) range.insertNode(doc.createTextNode(insert));
		this.element.normalize();

		const view = doc.defaultView as any;
		this.element.dispatchEvent(
			new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: insert }),
		);
	}

	replaceRange(from: number, to: number, insert: string) {
		this.applyChange(from, to, insert);
	}

	editRange(from: number, to: number, insert: string) {
		const caret = selectionOffsets(this.element);
		this.select(from, to);
		this.insert(from, to, insert);
		if (!caret) return;
		const delta = insert.length - (to - from);
		const shift = (offset: number) =>
			offset <= from ? offset : offset >= to ? offset + delta : from + insert.length;
		this.select(shift(caret.from), shift(caret.to));
	}

	selectRange(range: Range) {
		this.select(range.from, range.to);
	}

	/** Ranges here are already text offsets. */
	positionAt(offset: number) {
		return offset;
	}

	setSelection(from: number, to: number = from) {
		this.select(from, to);
	}

	/** Step out of the equation, past its closing `$`. */
	exitMath(): boolean {
		if (!this.mathBounds) return false;
		this.select(this.mathBounds.outer_end, this.mathBounds.outer_end);
		return true;
	}

	watch(remap: (map: (range: Range) => Range) => void) {
		watchElement(this.element, remap);
	}

	get document(): Document {
		return this.element.ownerDocument;
	}

	clientRects(range: Range): DOMRect[] {
		try {
			const { segments } = segmentsOf(this.element);
			const start = domPointAt(this.element, segments, range.from);
			const end = domPointAt(this.element, segments, range.to);
			const domRange = this.element.ownerDocument.createRange();
			domRange.setStart(start.node, start.offset);
			domRange.setEnd(end.node, end.offset);
			return Array.from(domRange.getClientRects());
		} catch {
			return [];
		}
	}
}

/* Tabstops here are plain text offsets, so they are kept valid by diffing the
 * text on every input: one changed span between a common prefix and suffix,
 * which is what a keystroke produces. */
const watched = new WeakMap<HTMLElement, string>();

function watchElement(element: HTMLElement, remap: (map: (range: Range) => Range) => void) {
	if (watched.has(element)) {
		watched.set(element, segmentsOf(element).text);
		return;
	}
	watched.set(element, segmentsOf(element).text);

	element.addEventListener("input", () => {
		const before = watched.get(element) ?? "";
		const after = segmentsOf(element).text;
		watched.set(element, after);
		if (before === after) return;

		let prefix = 0;
		while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < before.length - prefix &&
			suffix < after.length - prefix &&
			before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
		) suffix++;

		const oldEnd = before.length - suffix;
		const newEnd = after.length - suffix;
		const delta = after.length - before.length;

		// A tabstop's start holds still and its end follows the text, so typing
		// into a placeholder grows it — including an empty one, where both ends
		// sit exactly where the text is being inserted and only the bias tells
		// them apart. Same rule as CodeMirror's `mapPos`.
		const move = (offset: number, bias: -1 | 1) => {
			if (offset < prefix) return offset;
			if (offset > oldEnd) return offset + delta;
			return bias < 0 ? prefix : newEnd;
		};
		remap((range) => ({ from: move(range.from, -1), to: move(range.to, 1) }));
	});
}

/* Where the caret was in each comment field.
 *
 * Zotero's reader takes Tab for its own focus navigation, from a listener on
 * the window in the capture phase — registered before this bundle is injected,
 * so it always runs first and has already moved focus by the time we see the
 * key. It does not stop propagation, though, and the event still names the
 * comment field as its target, so the keystroke is recoverable: put the focus
 * and the caret back, and carry on. */
const lastSelection = new WeakMap<HTMLElement, { from: number; to: number }>();

export function trackCommentSelection(win: any): () => void {
	const doc: Document = win.document;
	const remember = () => {
		const active = doc.activeElement as HTMLElement | null;
		if (!active?.matches?.(COMMENT_FIELD)) return;
		try {
			const selection = selectionOffsets(active);
			if (selection) lastSelection.set(active, selection);
		} catch {
			/* nothing worth remembering */
		}
	};
	doc.addEventListener("selectionchange", remember);
	doc.addEventListener("keyup", remember, true);
	return () => {
		doc.removeEventListener("selectionchange", remember);
		doc.removeEventListener("keyup", remember, true);
	};
}

function commentFieldOf(node: unknown): HTMLElement | null {
	const element = (node as HTMLElement)?.closest?.(COMMENT_FIELD) as HTMLElement | null;
	return element?.isContentEditable ? element : null;
}

/** The annotation comment being edited, or null. */
export function currentTextBuffer(win: any): TextBuffer | null {
	const active = win.document?.activeElement as HTMLElement | null;
	if (!active?.isContentEditable || !active.matches(COMMENT_FIELD)) return null;
	return TextBuffer.forElement(active);
}

/**
 * Put the focus and caret back into the comment a keystroke came from, and
 * return the undo for it.
 *
 * Reversible on purpose: if nothing ends up handling the key, Zotero's own
 * Tab navigation has to be left to stand.
 */
export function recoverCommentFocus(win: any, target: unknown): (() => void) | null {
	const doc: Document = win.document;
	const active = doc?.activeElement as HTMLElement | null;
	if (active?.isContentEditable && active.matches(COMMENT_FIELD)) return null; // nothing was taken

	const field = (target as HTMLElement)?.closest?.(COMMENT_FIELD) as HTMLElement | null;
	if (!field?.isContentEditable || !field.isConnected) return null;

	const remembered = lastSelection.get(field);
	if (!remembered) return null;

	try {
		field.focus({ preventScroll: true });
		setCaret(field, remembered.from, remembered.to);
	} catch {
		return null;
	}

	return () => {
		try {
			(active as HTMLElement | null)?.focus?.({ preventScroll: true });
		} catch {
			/* whatever had focus is gone; leaving it here is the lesser evil */
		}
	};
}

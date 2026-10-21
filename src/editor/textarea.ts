/* The text-annotation backend: the "Add Text" boxes drawn on the PDF page.
 *
 * Each is a <textarea> in the PDF view's own iframe, nested inside the reader
 * window this bundle runs in, and its value is the annotation's comment. That
 * makes it the simplest editor here — flat text, offsets that are offsets — and
 * `$…$` is an equation in it exactly as in a comment.
 *
 * Edits go through `execCommand("insertText")`, which in a textarea keeps the
 * undo stack and fires the `input` event the PDF view listens for to save the
 * comment and resize the box.
 */
import { Buffer, BufferKind, Range } from "./buffer";
import { MathBounds, mathBoundsAt } from "src/utils/math_bounds";
import { TEXT_ANNOTATION, textareaRects } from "src/render/textarea_mirror";
import { watchText } from "./watch_text";

export class TextareaBuffer implements Buffer {
	readonly element: HTMLTextAreaElement;
	readonly text: string;
	readonly from: number;
	readonly to: number;
	readonly mathBounds: MathBounds | null;

	constructor(element: HTMLTextAreaElement) {
		this.element = element;
		this.text = element.value;
		this.from = element.selectionStart;
		this.to = element.selectionEnd;
		this.mathBounds = mathBoundsAt(this.text, this.to);
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

	get dollarMath() {
		return true;
	}

	private select(from: number, to: number) {
		this.element.setSelectionRange(from, to);
	}

	applyChange(
		from: number,
		to: number,
		insert: string,
		tabstops: readonly Range[] = [],
		selection?: Range,
	): Range[] {
		this.insert(from, to, insert);

		const at = (offsetInInsert: number) => from + offsetInInsert;
		const placed = tabstops.map((ts) => ({ from: at(ts.from), to: at(ts.to) }));

		const caret = selection ?? { from: insert.length, to: insert.length };
		this.select(at(caret.from), at(caret.to));

		return placed;
	}

	/**
	 * execCommand can decline silently, which would lose the expansion with no
	 * sign of why — so check, and fall back to `setRangeText`, announcing the
	 * change ourselves since that does not.
	 */
	private insert(from: number, to: number, insert: string) {
		if (from === to && !insert) return;
		const element = this.element;
		const before = element.value;
		this.select(from, to);

		try {
			element.ownerDocument.execCommand("insertText", false, insert);
		} catch {
			/* fall through to the manual edit */
		}
		if (element.value !== before) return;

		element.setRangeText(insert, from, to, "end");
		const view = element.ownerDocument.defaultView as any;
		element.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: insert }));
	}

	replaceRange(from: number, to: number, insert: string) {
		this.applyChange(from, to, insert);
	}

	editRange(from: number, to: number, insert: string) {
		const caret = { from: this.element.selectionStart, to: this.element.selectionEnd };
		this.insert(from, to, insert);
		const delta = insert.length - (to - from);
		const shift = (offset: number) =>
			offset <= from ? offset : offset >= to ? offset + delta : from + insert.length;
		this.select(shift(caret.from), shift(caret.to));
	}

	selectRange(range: Range) {
		this.select(range.from, range.to);
	}

	positionAt(offset: number) {
		return offset;
	}

	setSelection(from: number, to: number = from) {
		this.select(from, to);
	}

	exitMath(): boolean {
		if (!this.mathBounds) return false;
		this.select(this.mathBounds.outer_end, this.mathBounds.outer_end);
		return true;
	}

	watch(remap: (map: (range: Range) => Range) => void) {
		watchText(this.element, () => this.element.value, remap);
	}

	get document(): Document {
		return this.element.ownerDocument;
	}

	clientRects(range: Range): DOMRect[] {
		try {
			return textareaRects(this.element, range.from, range.to);
		} catch {
			return [];
		}
	}
}

/**
 * The text annotation being edited, or null.
 *
 * Focus inside the PDF view shows up out here as the iframe holding it, so the
 * search goes one frame down. Same origin, so the document is reachable.
 */
export function focusedTextAnnotation(win: any): HTMLTextAreaElement | null {
	const frame = win.document?.activeElement as HTMLIFrameElement | null;
	if (frame?.nodeName !== "IFRAME") return null;
	let inner: Element | null | undefined;
	try {
		inner = frame.contentDocument?.activeElement;
	} catch {
		return null; // not ours to look into
	}
	if (!inner?.matches?.(TEXT_ANNOTATION)) return null;
	const textarea = inner as HTMLTextAreaElement;
	return textarea.disabled || textarea.readOnly ? null : textarea;
}

export function currentTextareaBuffer(win: any): TextareaBuffer | null {
	const textarea = focusedTextAnnotation(win);
	return textarea ? new TextareaBuffer(textarea) : null;
}

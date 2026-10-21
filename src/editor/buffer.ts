/* The one thing the snippet engine needs from an editor: a flat string, a
 * cursor in it, and a way to replace a range and land the cursor somewhere.
 *
 * Three editors provide it. Zotero notes are ProseMirror, where an equation is
 * a node edited in a nested view (editor/pm.ts). Annotation comments in the
 * reader are a plain contenteditable holding plain text, where an equation is
 * `$…$` the way it is in markdown (editor/contenteditable.ts); text
 * annotations on the page are textareas, with `$…$` likewise (editor/textarea.ts).
 */
import { MathBounds } from "src/utils/math_bounds";

export type BufferKind = "math_inline" | "math_display" | "text" | "code";

/** A tabstop, in whatever coordinates its buffer's backend uses. */
export type Range = { from: number; to: number };

export interface Buffer {
	/** identity of the thing being edited, so stale tabstops can be spotted */
	readonly owner: object;
	readonly kind: BufferKind;
	/** the editable text, flat */
	readonly text: string;
	/** selection, as offsets into `text` */
	readonly from: number;
	readonly to: number;
	/** the equation the cursor is in, in text offsets, or null */
	readonly mathBounds: MathBounds | null;
	readonly inMath: boolean;
	readonly selectedText: string;
	/**
	 * True when `$…$` in the text is what an equation *is* here. Notes store
	 * equations as nodes, so a text-mode replacement wrapped in dollars has to be
	 * turned into one; annotations are markdown-ish, so it is already correct.
	 */
	readonly dollarMath: boolean;

	/**
	 * Replace `[from, to)` with `insert`, and report where the given tabstops —
	 * offsets into `insert` — ended up. `selection` is also an offset into
	 * `insert`, defaulting to its end.
	 */
	applyChange(
		from: number,
		to: number,
		insert: string,
		tabstops?: readonly Range[],
		selection?: Range,
	): Range[];

	/** Replace `[from, to)`, cursor after the insertion. */
	replaceRange(from: number, to: number, insert: string): void;

	/**
	 * Replace `[from, to)` without moving the cursor — for edits made *around*
	 * what the user is doing, such as enlarging brackets after an expansion. The
	 * editor maps the selection, and tabstops with it.
	 */
	editRange(from: number, to: number, insert: string): void;

	/** Select a range previously returned by `applyChange`. */
	selectRange(range: Range): void;

	/** A text offset in this buffer's own coordinates, to compare against a `Range`. */
	positionAt(offset: number): number;

	/** Move the cursor, in text offsets. */
	setSelection(from: number, to?: number): void;

	/** Put the cursor just after the equation the cursor is in. */
	exitMath(): boolean;

	/**
	 * Keep tabstop ranges valid across edits from anywhere — us, the user, or the
	 * editor itself. `remap` is called with a mapper for each such edit.
	 */
	watch(remap: (map: (range: Range) => Range) => void): void;

	/** The document this buffer is being edited in. */
	readonly document: Document;

	/** Where a range sits on screen, for drawing over it. */
	clientRects(range: Range): DOMRect[];
}

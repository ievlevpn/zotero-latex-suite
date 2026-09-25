/* Expanding a snippet and walking its tabstops.
 *
 * Latex Suite queues change specs into a CodeMirror state field and flushes them
 * in one dispatch; here a snippet is always one contiguous replacement inside
 * one buffer, so it is one edit and the queue disappears.
 *
 * Tabstop positions are kept in whatever coordinates the buffer's backend uses
 * and remapped through every later edit to it, so typing into a placeholder
 * grows its range the way CodeMirror's mark decorations did.
 */
import { Buffer, Range } from "src/editor/buffer";
import { ResultInsert } from "./luasnip_api/node";
import { tabstopSpecsToTabstopGroups } from "./tabstop";
import { hideTabstopMarks, showTabstopMarks } from "./tabstop_marks";

type ActiveSnippet = {
	owner: object;
	groups: Range[][];
	index: number;
	/** kept for `clientRects`, which re-reads the DOM on each call */
	buffer: Buffer;
	/** null when there is nothing to draw on; the marks are decoration only */
	doc: Document | null;
};

/** Never let a cosmetic mark be the reason an expansion fails. */
function documentOf(buffer: Buffer): Document | null {
	try {
		return buffer.document ?? null;
	} catch {
		return null;
	}
}

/* Snippets in flight, outermost first. Expanding inside a tabstop of the
 * snippet you are already filling in pushes onto this; anywhere else starts
 * over. Running out of tabstops pops back to the one underneath, so a snippet
 * expanded inside a placeholder does not cost you the rest of the outer one. */
const stack: ActiveSnippet[] = [];
let active: ActiveSnippet | null = null;

function enter(snippet: ActiveSnippet) {
	stack.push(snippet);
	active = snippet;
}

/** Is `range` inside a tabstop the current snippet has not passed yet? */
function withinPendingTabstop(owner: object, from: number, to: number): boolean {
	if (!active || active.owner !== owner) return false;
	return active.groups
		.slice(active.index)
		.some((group) => group.some((range) => from >= range.from && to <= range.to));
}

export function clearTabstops() {
	stack.length = 0;
	dropActive();
}

/** Drop just the innermost snippet, uncovering the one it was expanded inside. */
function dropActive() {
	const doc = active?.doc;
	stack.pop();
	active = stack[stack.length - 1] ?? null;
	if (doc) {
		try {
			hideTabstopMarks(doc);
			// The snippet underneath still has marks to keep in place.
			if (!active) doc.removeEventListener("scroll", paintMarks, true);
		} catch {
			/* the window may already be gone */
		}
	}
	paintMarks();
}

/** Mark the tabstops still to come — the one in hand is shown by the selection. */
function paintMarks() {
	const current = active;
	if (!current?.doc) return;
	try {
		const pending = current.groups.slice(current.index + 1).flat();
		showTabstopMarks(current.doc, pending.flatMap((range) => current.buffer.clientRects(range)));
	} catch {
		/* decoration only */
	}
}

export function hasTabstops() {
	return active !== null;
}

/**
 * The caret moved. Tabbing through a snippet only means anything while the
 * caret is still inside one of its tabstops, so moving out of them — closing an
 * equation, clicking into the text around it, focusing something else entirely
 * — finishes that snippet and takes its marks down with it.
 *
 * Leaving the buffer is not enough on its own to notice this. In the note
 * editor an equation is its own nested view, so stepping out of one changes the
 * buffer; in an annotation comment the whole comment is one buffer and an
 * equation is just `$…$` inside it, so the caret can walk out of a snippet
 * without the buffer ever changing. Hence the position check, which covers both.
 */
export function clearTabstopsIfElsewhere(buffer: Buffer | null | undefined) {
	if (!active) return;
	if (!buffer || buffer.owner !== active.owner) {
		clearTabstops();
		return;
	}

	const from = buffer.positionAt(buffer.from);
	const to = buffer.positionAt(buffer.to);
	const contains = (group: Range[]) => group.some((range) => from >= range.from && to <= range.to);

	// Innermost first, the way Tab runs off the end of one: stepping out of a
	// snippet expanded inside a placeholder hands the tabstops back to the outer
	// one rather than costing you both.
	while (active) {
		// The tabstop in hand first: adjacent ones can collapse onto the same
		// spot, and a caret sitting in both has not moved anywhere.
		if (active.groups[active.index] && contains(active.groups[active.index])) return;

		// Clicked back into a placeholder this snippet had already passed: carry
		// on from there, the way Tab would have.
		const index = active.groups.findIndex(contains);
		if (index >= 0) {
			active.index = index;
			paintMarks();
			return;
		}

		dropActive();
	}
}

/** Replace `[from, to)` in `buffer` with a snippet result, then select tabstop 0. */
export function expandSnippet(buffer: Buffer, from: number, to: number, result: ResultInsert): boolean {
	const nested = withinPendingTabstop(buffer.owner, buffer.positionAt(from), buffer.positionAt(to));
	const groups = tabstopSpecsToTabstopGroups(result.tabstops);
	const flat = groups.flat();

	const selection = groups.length ? groups[0][0] : undefined;
	const placed = buffer.applyChange(from, to, result.insert, flat, selection);

	if (!groups.length) {
		// Nothing to step through here; hand the tabstops back to the outer snippet.
		if (nested) dropActive();
		else clearTabstops();
		return true;
	}

	// Re-bucket the placed positions the way they were grouped.
	let cursor = 0;
	const placedGroups = groups.map((group) => group.map(() => placed[cursor++]));

	const owner = buffer.owner;
	buffer.watch((map) => {
		if (active && active.owner === owner) {
			active.groups = active.groups.map((group) => group.map(map));
			paintMarks();
		}
	});

	// Expanding inside a placeholder of the snippet in hand nests; anything else
	// means that snippet is finished with.
	if (!nested) clearTabstops();

	const doc = documentOf(buffer);
	enter({ owner, groups: placedGroups, index: 0, buffer, doc });
	// Fixed-position marks would sit in the wrong place after a scroll.
	doc?.addEventListener("scroll", paintMarks, true);
	paintMarks();
	return true;
}

/** Tab / Shift-Tab between tabstops. Returns false when there is nowhere to go. */
export function setSelectionToNextTabstop(buffer: Buffer, shiftKey: boolean): boolean {
	if (!active) return false;
	if (active.owner !== buffer.owner) {
		// A different buffer (or the same equation reopened as a fresh nested
		// view): the recorded positions no longer refer to anything.
		clearTabstops();
		return false;
	}

	const direction = shiftKey ? -1 : 1;
	let next = active.index + direction;

	const current = active.groups[active.index]?.[0];

	while (next >= 0 && next < active.groups.length) {
		const target = active.groups[next][0];
		// Adjacent tabstops can collapse onto the same spot; stepping onto one we
		// are already sitting at would make Tab look broken.
		if (current && target.from === current.from && target.to === current.to) {
			next += direction;
			continue;
		}

		buffer.selectRange(target);
		active.index = next;
		// The last tabstop of the innermost snippet finishes it, but only it.
		if (next === active.groups.length - 1 && direction === 1) {
			if (stack.length > 1) dropActive();
			else clearTabstops();
		} else {
			paintMarks();
		}
		return true;
	}

	// Out of tabstops here: fall back to the snippet this one was expanded inside.
	if (direction === 1 && stack.length > 1) {
		dropActive();
		return setSelectionToNextTabstop(buffer, shiftKey);
	}
	if (direction === 1) clearTabstops();
	return false;
}

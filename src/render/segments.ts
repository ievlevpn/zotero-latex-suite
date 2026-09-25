/* One offset model for an annotation comment, shared by the renderer and the
 * snippet engine.
 *
 * A comment is flat text, but its DOM is not: it may hold `<b>`/`<i>` runs,
 * `<br>` line breaks, `<div>` lines (what Enter makes in Gecko), and — once
 * rendered — spans of MathML standing in for `$…$`. A rendered equation counts as its *source* length, so the offsets here
 * always describe the comment as Zotero stores it, rendered or not.
 */
export const SOURCE_ATTR = "data-latex-suite-source";

export type Segment = {
	kind: "text" | "br" | "block" | "math";
	start: number;
	length: number;
	node: Node;
};

/** Elements that start a line of their own, the way `innerText` reads them. */
const BLOCKS = new Set(["DIV", "P"]);

export function segmentsOf(root: Node): { segments: Segment[]; text: string } {
	const segments: Segment[] = [];
	let text = "";

	const walk = (parent: Node) => {
		for (const child of Array.from(parent.childNodes)) {
			if (child.nodeType === 3) {
				// Verbatim, U+00A0 included. Gecko puts non-breaking spaces where an
				// ordinary one would collapse, and the renderer rebuilds text nodes
				// from this string — normalising here would write plain spaces back
				// over them, and innerText, which is how Zotero reads a comment,
				// would then drop them.
				const value = (child as Text).data;
				segments.push({ kind: "text", start: text.length, length: value.length, node: child });
				text += value;
				continue;
			}
			if (child.nodeType !== 1) continue;

			const element = child as Element;
			if (element.nodeName === "BR") {
				segments.push({ kind: "br", start: text.length, length: 1, node: element });
				text += "\n";
			} else if (element.hasAttribute(SOURCE_ATTR)) {
				const source = element.getAttribute(SOURCE_ATTR) ?? "";
				segments.push({ kind: "math", start: text.length, length: source.length, node: element });
				text += source;
			} else {
				// The line break is implied rather than a node, so it is anchored to
				// the block. Not before the first line, nor after one that already
				// ended in a <br>.
				if (BLOCKS.has(element.nodeName) && text && !text.endsWith("\n")) {
					segments.push({ kind: "block", start: text.length, length: 1, node: element });
					text += "\n";
				}
				walk(element);
			}
		}
	};
	walk(root);

	return { segments, text };
}

/** Text offset -> a DOM point. Rendered equations are atomic: before, or after. */
export function domPointAt(root: Element, segments: Segment[], target: number): { node: Node; offset: number } {
	// Clamp rather than throw: an offset from a stale measurement should put the
	// caret somewhere sane, not take down whatever was mid-keystroke.
	const last = segments[segments.length - 1];
	const offset = Math.max(0, Math.min(target, last ? last.start + last.length : 0));

	for (const segment of segments) {
		if (offset > segment.start + segment.length) continue;
		if (segment.kind === "text") return { node: segment.node, offset: offset - segment.start };

		// Past the implied break is the start of the block's own line.
		if (segment.kind === "block") {
			if (offset > segment.start) return { node: segment.node, offset: 0 };
			const parent = segment.node.parentNode!;
			return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, segment.node) };
		}

		// A <br> or a rendered equation is one atom: the caret goes before it or
		// after it, never inside. Snap to whichever side is nearer, so an offset
		// just inside the opening delimiter lands before the equation rather than
		// being carried past it — the two sides have to behave alike.
		const parent = segment.node.parentNode!;
		const index = Array.prototype.indexOf.call(parent.childNodes, segment.node);
		const nearerToEnd = offset - segment.start > segment.length / 2;
		return { node: parent, offset: nearerToEnd ? index + 1 : index };
	}
	return { node: root, offset: root.childNodes.length };
}

/** A DOM point -> a text offset, by measuring everything before it. */
export function offsetOfPoint(root: Element, container: Node, offset: number): number {
	const measure = root.ownerDocument.createRange();
	measure.selectNodeContents(root);
	measure.setEnd(container, offset);
	return segmentsOf(measure.cloneContents()).text.length;
}

/** The selection within `root`, in text offsets, or null if it is elsewhere. */
export function selectionOffsets(root: Element): { from: number; to: number } | null {
	const selection = root.ownerDocument.defaultView?.getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
	return {
		from: offsetOfPoint(root, range.startContainer, range.startOffset),
		to: offsetOfPoint(root, range.endContainer, range.endOffset),
	};
}

export function setCaret(root: Element, from: number, to: number = from) {
	const doc = root.ownerDocument;
	const selection = doc.defaultView?.getSelection();
	if (!selection) return;
	const { segments } = segmentsOf(root);
	const start = domPointAt(root, segments, from);
	const end = domPointAt(root, segments, to);
	const range = doc.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	selection.removeAllRanges();
	selection.addRange(range);
}

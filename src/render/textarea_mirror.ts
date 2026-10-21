/* A div laid exactly over a text annotation — the "Add Text" kind, drawn on
 * the page itself.
 *
 * The reader draws one as a <textarea> inside the PDF view's iframe, absolutely
 * placed in the page div by an inline style that it rewrites whenever the
 * annotation moves, resizes, rotates or changes colour (src/pdf/page.js in
 * zotero/reader). A textarea holds nothing but text, so an equation cannot be
 * rendered in it, and the range APIs cannot see into it either. A div wearing
 * the same inline style sits in the same box, wraps the same way, and can do
 * both: show rendered math over the text, or measure where a range of it lies.
 *
 * The style is copied rather than computed: it is written in terms of the
 * page's `--scale-factor`, so the copy follows zoom without being told.
 */
export const TEXT_ANNOTATION = "textarea.textAnnotation";

/* What the reader's stylesheet gives the textarea, and the UA stylesheet gives
 * any textarea, that a div would not have. Inline, so a mirror needs nothing
 * injected to line up. Zotero's own style string never sets these. */
const BASE = [
	"position: absolute",
	"box-sizing: border-box",
	"margin: 0",
	"padding: 0",
	"border: none",
	"white-space: pre-wrap",
	"overflow-wrap: break-word",
	"word-break: break-word",
	"text-align: start",
	// A textarea's `font` resets these rather than inheriting them from the page.
	"font-weight: normal",
	"font-style: normal",
	"line-height: normal",
	"letter-spacing: normal",
	"pointer-events: none",
].join(";");

/** The style a mirror of `textarea` should have; compare it to see if one is stale. */
export function mirrorStyle(textarea: HTMLTextAreaElement): string {
	return `${BASE};${textarea.getAttribute("style") ?? ""}`;
}

export function placeMirror(mirror: HTMLElement, textarea: HTMLTextAreaElement) {
	const style = mirrorStyle(textarea);
	if (mirror.getAttribute("style") !== style) mirror.setAttribute("style", style);
	if (mirror.dir !== textarea.dir) mirror.dir = textarea.dir;
}

/**
 * Where `[from, to)` of the textarea's text sits on screen.
 *
 * Measured on a hidden mirror placed next to the textarea, so it shares the
 * containing block, and removed again straight away. Approximate where the
 * annotation is rotated: client rects are axis-aligned.
 */
export function textareaRects(textarea: HTMLTextAreaElement, from: number, to: number): DOMRect[] {
	const parent = textarea.parentElement;
	const value = textarea.value;
	if (!parent || !value) return [];

	const doc = textarea.ownerDocument;
	const mirror = doc.createElement("div");
	placeMirror(mirror, textarea);
	mirror.style.visibility = "hidden";
	const text = doc.createTextNode(value);
	mirror.append(text);
	parent.append(mirror);
	try {
		const range = doc.createRange();
		const clamp = (offset: number) => Math.max(0, Math.min(offset, value.length));
		range.setStart(text, clamp(from));
		range.setEnd(text, clamp(Math.max(from, to)));
		return Array.from(range.getClientRects());
	} finally {
		mirror.remove();
	}
}

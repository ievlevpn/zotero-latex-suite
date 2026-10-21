/* Live rendering of `$…$` in text annotations — the boxes "Add Text" puts on
 * the page.
 *
 * A comment field can hold rendered math in place of its source; a textarea
 * cannot. So the source stays in the textarea, untouched, and a mirror laid
 * exactly over it (render/textarea_mirror.ts) shows the rendered version while
 * the textarea's own text is made transparent. Nothing is ever written into
 * the textarea, so there is nothing that could be saved by mistake, and the
 * reader's hit-testing, dragging, resizing and focusing all work on the
 * textarea as before — the mirror takes no pointer events.
 *
 * While a text annotation is being edited it shows plain source, every
 * equation in it: a textarea cannot mix the two. It renders again when it
 * loses focus.
 *
 * The box is sized by the reader from the source text, so rendered math, which
 * is usually narrower and sometimes taller, will not fill it exactly. The
 * mirror lets taller math overflow rather than clip it.
 */
import { renderMath } from "src/render/math";
import { placeMirror, TEXT_ANNOTATION } from "src/render/textarea_mirror";
import { renderableEquations } from "src/utils/math_bounds";

type Katex = { render(tex: string, element: Element, options: object): void };

const LAYER_CLASS = "latex-suite-text-layer";
const HIDDEN_CLASS = "latex-suite-text-hidden";
const STYLE_ID = "latex-suite-text-annotations";

/* The layer is a sibling of the reader's own `.customAnnotationLayer`, not a
 * child: the reader removes anything in there it does not recognise. With
 * `display: contents` it adds no box, so a mirror is positioned against the
 * page div exactly as the textarea is.
 *
 * `:not(:focus)` is a safety net: a textarea being typed into must never be
 * invisible, whatever this script did or did not get round to. */
const STYLE = `
.${LAYER_CLASS} { display: contents; }
${TEXT_ANNOTATION}.${HIDDEN_CLASS}:not(:focus) { color: transparent !important; }
`;

/** What the reader writes when an annotation changes; `class` is left out, since we write it. */
const WATCHED_ATTRIBUTES = ["style", "data-comment", "disabled", "dir"];

/** Renders the text annotations in one PDF view document; returns the teardown. */
export function installTextAnnotationRendering(doc: Document, katex: Katex): () => void {
	const win = doc.defaultView as any;
	const mirrors = new WeakMap<HTMLTextAreaElement, HTMLElement>();
	/** The source each mirror is showing, so it is only rebuilt when that changes. */
	const shown = new WeakMap<HTMLElement, string>();

	// Only once something renders: this is attached to every view, EPUBs included.
	let style: HTMLStyleElement | null = null;
	const ensureStyle = () => {
		if (style?.isConnected) return;
		style = doc.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		(doc.head ?? doc.documentElement).appendChild(style);
	};

	const isOurs = (node: Node | null) => !!(node as Element)?.closest?.(`.${LAYER_CLASS}`);

	function layerFor(textarea: HTMLTextAreaElement): HTMLElement | null {
		// textarea -> .customAnnotationLayer -> the page div
		const page = textarea.parentElement?.parentElement;
		if (!page) return null;
		let layer = page.querySelector(`:scope > .${LAYER_CLASS}`) as HTMLElement | null;
		if (!layer) {
			layer = doc.createElement("div");
			layer.className = LAYER_CLASS;
			page.append(layer);
		}
		return layer;
	}

	function unrender(textarea: HTMLTextAreaElement) {
		mirrors.get(textarea)?.remove();
		mirrors.delete(textarea);
		if (textarea.classList.contains(HIDDEN_CLASS)) textarea.classList.remove(HIDDEN_CLASS);
	}

	/** Bring one textarea's mirror up to date; returns the mirror, if it should have one. */
	function sync(textarea: HTMLTextAreaElement, focused = textarea === doc.activeElement): HTMLElement | null {
		const value = textarea.value;
		const layer = !focused && textarea.isConnected && renderableEquations(value).length ? layerFor(textarea) : null;
		if (!layer) {
			unrender(textarea);
			return null;
		}

		ensureStyle();
		let mirror = mirrors.get(textarea);
		if (!mirror) {
			mirror = doc.createElement("div");
			// The textarea already says all of this to a screen reader.
			mirror.setAttribute("aria-hidden", "true");
			mirrors.set(textarea, mirror);
		}
		placeMirror(mirror, textarea);
		if (shown.get(mirror) !== value) {
			mirror.textContent = value;
			renderMath(mirror, katex);
			shown.set(mirror, value);
		}
		if (mirror.parentNode !== layer) layer.append(mirror);
		if (!textarea.classList.contains(HIDDEN_CLASS)) textarea.classList.add(HIDDEN_CLASS);
		return mirror;
	}

	/** Every textarea, plus any mirror whose textarea has gone. */
	function sweep() {
		const live = new Set<Element>();
		for (const textarea of Array.from(doc.querySelectorAll(TEXT_ANNOTATION)) as HTMLTextAreaElement[]) {
			const mirror = sync(textarea);
			if (mirror) live.add(mirror);
		}
		for (const mirror of Array.from(doc.querySelectorAll(`.${LAYER_CLASS} > *`))) {
			if (!live.has(mirror)) mirror.remove();
		}
	}

	function safely(fn: () => void) {
		try {
			fn();
		} catch (e) {
			console.error("latex-suite:", e);
		}
	}

	/** A text annotation came or went, or something took our layer away. */
	const touches = (node: Node, selector: string) => {
		if (node.nodeType !== 1) return false;
		const element = node as Element;
		return element.matches(selector) || !!element.querySelector(selector);
	};

	/* The PDF view mutates constantly — text layers, highlights, the cursor —
	 * so most records are dismissed by a cheap look. What is left is handled at
	 * once rather than on a timer: observer callbacks run before the next paint,
	 * so a mirror keeps up with a box being dragged or resized. */
	const observer = new win.MutationObserver((records: MutationRecord[]) => {
		let all = false;
		const changed = new Set<HTMLTextAreaElement>();
		for (const record of records) {
			if (record.type === "attributes") {
				const target = record.target as Element;
				if (target.matches?.(TEXT_ANNOTATION)) changed.add(target as HTMLTextAreaElement);
				continue;
			}
			if (all || isOurs(record.target)) continue;
			if (Array.from(record.addedNodes).some((node) => touches(node, TEXT_ANNOTATION))) all = true;
			else if (Array.from(record.removedNodes).some((node) => touches(node, `${TEXT_ANNOTATION}, .${LAYER_CLASS}`))) all = true;
		}
		safely(() => {
			if (all) sweep();
			else for (const textarea of changed) sync(textarea);
		});
	});
	observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });

	/* Editing shows the source, and leaving shows the math again. Synchronous,
	 * so the swap happens before the browser paints either way. */
	const onFocusIn = (event: Event) => {
		const target = event.target as Element;
		if (target?.matches?.(TEXT_ANNOTATION)) safely(() => sync(target as HTMLTextAreaElement, true));
	};
	const onFocusOut = (event: Event) => {
		const target = event.target as Element;
		if (target?.matches?.(TEXT_ANNOTATION)) safely(() => sync(target as HTMLTextAreaElement, false));
	};
	doc.addEventListener("focusin", onFocusIn, true);
	doc.addEventListener("focusout", onFocusOut, true);

	safely(sweep);

	return () => {
		observer.disconnect();
		doc.removeEventListener("focusin", onFocusIn, true);
		doc.removeEventListener("focusout", onFocusOut, true);
		for (const layer of Array.from(doc.querySelectorAll(`.${LAYER_CLASS}`))) layer.remove();
		for (const textarea of Array.from(doc.querySelectorAll(`.${HIDDEN_CLASS}`))) textarea.classList.remove(HIDDEN_CLASS);
		style?.remove();
	};
}

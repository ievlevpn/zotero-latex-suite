/* Live rendering of `$…$` in the reader's annotation comments.
 *
 * The constraint that shapes all of this: on every input the reader runs its
 * own `clean()` over the live comment element and then reads the comment back
 * out of it. Anything of ours still in the DOM at that moment would be saved
 * into the annotation. So the rendering comes out synchronously on `input` in
 * the capture phase — React attaches its handler at the root container, so ours
 * runs first — and goes straight back in on the way out, in the bubble phase of
 * the same event. Both happen in one task, before the browser paints, so
 * nothing flickers; and rendered equations are cached by source, so putting
 * them back costs a clone rather than a trip through KaTeX.
 *
 * While a comment is focused, the equation the caret is inside stays as source,
 * so it can be edited; the rest of the comment renders around it. A rendered
 * equation is `contenteditable=false`, so the caret cannot be placed inside one
 * — clicking it has to put the source back and drop the caret in, or an
 * equation would become uneditable the moment it rendered.
 */
import { clearRenderState, isRendered, syncRender, unrenderMath } from "src/render/math";
import { segmentsOf, selectionOffsets, setCaret, SOURCE_ATTR } from "src/render/segments";
import { COMMENT_FIELD } from "src/editor/contenteditable";
import { installTextAnnotationRendering } from "./text_annotations";
import { trackViewDocuments } from "./views";

/** Long enough for a burst of React updates to settle, short enough not to be felt. */
const SETTLE_MS = 100;

/** Returns a teardown function, or null when there is nothing to render with yet. */
export function installAnnotationRendering(win: any): (() => void) | null {
	const doc: Document = win.document;
	const katex = win.katex;
	// Chrome injects KaTeX only when rendering is switched on, and may do so
	// after this bundle loads; returning null leaves the door open to retry.
	if (!katex) return null;

	const fields = () => Array.from(doc.querySelectorAll(COMMENT_FIELD)) as HTMLElement[];
	const fieldOf = (node: unknown) => (node as HTMLElement)?.closest?.(COMMENT_FIELD) as HTMLElement | null;
	const isFocused = (field: HTMLElement) => field === doc.activeElement || field.contains(doc.activeElement);

	function renderField(field: HTMLElement) {
		const selection = isFocused(field) ? selectionOffsets(field) : null;
		const caret = selection ? selection.to : null;
		// Only when the DOM actually moved: the caret is fine otherwise, and
		// resetting it on every keystroke is exactly what makes typing feel laggy.
		if (syncRender(field, katex, caret) && selection) setCaret(field, selection.from, selection.to);
	}

	/* A document with a few hundred annotations has a few hundred comment fields,
	 * and the observer fires for anything the reader does. Only the fields a
	 * mutation actually touched are looked at, unless something asks for a sweep. */
	const dirty = new Set<HTMLElement>();
	let sweep = false;
	let timer = 0;
	let deadline = Infinity;

	const schedule = (delay: number, all = false) => {
		if (all) sweep = true;
		if (!sweep && dirty.size === 0) return;

		// Caret movement fires steadily while selecting; re-arming on each one
		// would push the render out indefinitely, so an earlier deadline wins.
		const at = Date.now() + delay;
		if (timer && at >= deadline) return;

		win.clearTimeout(timer);
		deadline = at;
		timer = win.setTimeout(() => {
			timer = 0;
			deadline = Infinity;
			const targets = sweep ? fields() : Array.from(dirty);
			sweep = false;
			dirty.clear();
			for (const field of targets) {
				if (field.isConnected) renderField(field);
			}
		}, delay);
	};

	/**
	 * Take the rendering out, keeping the caret where it was.
	 *
	 * Measuring the caret can fail in odd DOM states, and that must never be the
	 * reason the rendering survives — Zotero reads the comment back out of this
	 * element, and MathML left in it would be saved into the annotation.
	 */
	function stripRendering(field: HTMLElement) {
		let selection: { from: number; to: number } | null = null;
		try {
			selection = selectionOffsets(field);
		} catch (e) {
			console.error("latex-suite:", e);
		}

		const removed = unrenderMath(field);
		// Only when something came out: the recorded state is still accurate
		// otherwise, and clearing it would force a needless rebuild on every key.
		if (removed) clearRenderState(field);

		if (removed && selection) {
			try {
				setCaret(field, selection.from, selection.to);
			} catch (e) {
				console.error("latex-suite:", e);
			}
		}
	}

	/* Deletions only.
	 *
	 * A rendered equation is an atom the caret cannot enter, and the browser's
	 * own deletion commands — delete a word, delete to the start of the line —
	 * misbehave when one is in the way, so the source has to be back before they
	 * run. They tolerate it because they recompute from the caret afterwards.
	 *
	 * Nothing else may be touched here. Stripping replaces the selection, and a
	 * command already in flight does not survive that: doing this for every
	 * input type is what stopped Cmd/Ctrl-B and -I working in a comment holding
	 * an equation. Everything else is stripped on `input`, before Zotero reads
	 * the comment back, which is soon enough. */
	const onBeforeInput = (event: Event) => {
		if (!(event as InputEvent).inputType?.startsWith("delete")) return;
		const field = fieldOf(event.target);
		if (field && isRendered(field)) stripRendering(field);
	};

	/* Capture phase, so this runs before React's onInput — which is attached at
	 * the root container and would otherwise read our MathML back as the comment. */
	const onInputCapture = (event: Event) => {
		const field = fieldOf(event.target);
		if (!field) return;
		stripRendering(field);

		// A safety net: if the bubble half never runs — something stopping
		// propagation, or throwing — the comment would sit as source indefinitely.
		dirty.add(field);
		schedule(SETTLE_MS);
	};

	/* Bubble phase of the same event: React has read the comment by now, so the
	 * equations can go back. Same task, so there is no paint in between and the
	 * comment never visibly drops to source. */
	const onInputBubble = (event: Event) => {
		const field = fieldOf(event.target);
		if (!field) return;
		// Rewriting the DOM mid-composition would abort the IME; wait it out.
		if ((event as InputEvent).isComposing) return;
		try {
			renderField(field);
		} catch (e) {
			console.error("latex-suite:", e);
		}
	};

	const onCompositionEnd = () => schedule(0, true);

	/* Click a rendered equation to edit it. Without this an equation becomes
	 * read-only as soon as it renders: it is an atom, so the caret cannot enter
	 * it, and no snippet can ever see math mode there again. */
	const onMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) return; // a right-click wants the context menu
		const span = (event.target as HTMLElement)?.closest?.(`[${SOURCE_ATTR}]`) as HTMLElement | null;
		if (!span) return;
		const field = fieldOf(span);
		if (!field || !field.isContentEditable) return;

		const { segments } = segmentsOf(field);
		const segment = segments.find((s) => s.node === span);
		const source = span.getAttribute(SOURCE_ATTR) ?? "";
		const delimiter = source.startsWith("$$") ? 2 : 1;

		event.preventDefault();
		field.focus();
		unrenderMath(field);
		clearRenderState(field);
		// Just inside the closing delimiter, which is where you want to be when
		// you click an equation to change it.
		setCaret(field, (segment?.start ?? 0) + source.length - delimiter);
		dirty.add(field);
		schedule(SETTLE_MS);
	};

	const onFocusChange = () => schedule(0, true);
	// The caret leaving an equation is what lets it render again.
	const onSelectionChange = () => {
		const field = fieldOf(doc.activeElement);
		if (!field) return;
		dirty.add(field);
		schedule(SETTLE_MS);
	};

	doc.addEventListener("beforeinput", onBeforeInput, true);
	doc.addEventListener("input", onInputCapture, true);
	doc.addEventListener("input", onInputBubble, false);
	doc.addEventListener("compositionend", onCompositionEnd, true);
	doc.addEventListener("mousedown", onMouseDown, true);
	doc.addEventListener("focusin", onFocusChange, true);
	doc.addEventListener("focusout", onFocusChange, true);
	doc.addEventListener("selectionchange", onSelectionChange);

	// React rewrites these fields whenever an annotation changes, wiping what we
	// rendered; watching the document is simpler than tracking its lifecycles.
	const observer = new win.MutationObserver((records: MutationRecord[]) => {
		for (const record of records) {
			const field = fieldOf(record.target) ?? fieldOf(record.target.parentNode);
			if (field) dirty.add(field);
			for (const node of Array.from(record.addedNodes)) {
				if (node.nodeType !== 1) continue;
				const element = node as Element;
				const own = fieldOf(element);
				if (own) dirty.add(own);
				for (const nested of Array.from(element.querySelectorAll(COMMENT_FIELD))) {
					dirty.add(nested as HTMLElement);
				}
			}
		}
		schedule(SETTLE_MS);
	});
	observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
	schedule(0, true);

	// Text annotations live on the page, in the PDF view's own document.
	const stopTextAnnotations = trackViewDocuments(win, (view) => installTextAnnotationRendering(view, katex));

	return () => {
		stopTextAnnotations();
		observer.disconnect();
		win.clearTimeout(timer);
		timer = 0;
		deadline = Infinity;
		dirty.clear();
		doc.removeEventListener("beforeinput", onBeforeInput, true);
		doc.removeEventListener("input", onInputCapture, true);
		doc.removeEventListener("input", onInputBubble, false);
		doc.removeEventListener("compositionend", onCompositionEnd, true);
		doc.removeEventListener("mousedown", onMouseDown, true);
		doc.removeEventListener("focusin", onFocusChange, true);
		doc.removeEventListener("focusout", onFocusChange, true);
		doc.removeEventListener("selectionchange", onSelectionChange);
		for (const field of fields()) {
			unrenderMath(field);
			clearRenderState(field);
		}
	};
}

/* The annotation popup, out of the way while a text annotation is typed into.
 *
 * The reader places the popup once, below the box as it was when selected, and
 * moves it again only on scroll. A text box grows as you type, so it grows
 * straight underneath the popup, and what you are writing disappears behind
 * it. For a text annotation the popup holds only tags and a menu, neither of
 * which is wanted mid-sentence, so it is hidden while a box has focus and back
 * the moment the box loses it.
 *
 * `visibility`, not `display`: the popup keeps its size, so React's positioning
 * of it is not disturbed for when it shows again.
 */
import { TEXT_ANNOTATION } from "src/render/textarea_mirror";
import { trackViewDocuments } from "./views";

const ATTR = "data-latex-suite-text-editing";
const STYLE_ID = "latex-suite-text-popup";
const STYLE = `:root[${ATTR}] .annotation-popup { visibility: hidden; }`;

export function installTextPopupHiding(win: any): () => void {
	const doc: Document = win.document;
	const root = doc.documentElement;

	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE;
	(doc.head ?? root).appendChild(style);

	const onFocusIn = (event: Event) => {
		if ((event.target as Element)?.matches?.(TEXT_ANNOTATION)) root.setAttribute(ATTR, "");
	};
	const onFocusOut = (event: Event) => {
		if ((event.target as Element)?.matches?.(TEXT_ANNOTATION)) root.removeAttribute(ATTR);
	};

	const stopViews = trackViewDocuments(win, (view) => {
		view.addEventListener("focusin", onFocusIn, true);
		view.addEventListener("focusout", onFocusOut, true);
		// Attached while a box was already being edited.
		if (view.activeElement?.matches?.(TEXT_ANNOTATION)) root.setAttribute(ATTR, "");
		return () => {
			view.removeEventListener("focusin", onFocusIn, true);
			view.removeEventListener("focusout", onFocusOut, true);
			// A view going away mid-edit must not leave the popup hidden for good.
			if (view.activeElement?.matches?.(TEXT_ANNOTATION)) root.removeAttribute(ATTR);
		};
	});

	return () => {
		stopViews();
		root.removeAttribute(ATTR);
		style.remove();
	};
}

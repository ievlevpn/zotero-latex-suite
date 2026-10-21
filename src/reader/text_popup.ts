/* The annotation popup, out of the way while a text annotation is typed into.
 *
 * The reader places the popup once, below the box as it was when selected, and
 * moves it again only on scroll. A text box grows as you type, so it grows
 * straight underneath the popup, and what you are writing disappears behind
 * it. For a text annotation the popup holds only tags and a menu, neither of
 * which is wanted mid-sentence, so it is hidden while a box has focus.
 *
 * Whether a box has focus is read off the views every time, never remembered
 * from focus events: a textarea removed while focused — the page re-rendered on
 * zoom, the annotation deleted — fires no `focusout`, and a remembered "editing"
 * would then hide every popup from then on. It is checked on focus changes and,
 * as a backstop, whenever a popup appears.
 *
 * `visibility`, not `display`: the popup keeps its size, so React's positioning
 * of it is not disturbed for when it shows again.
 */
import { TEXT_ANNOTATION } from "src/render/textarea_mirror";
import { trackViewDocuments } from "./views";

const ATTR = "data-latex-suite-text-editing";
const STYLE_ID = "latex-suite-text-popup";
const POPUP = ".annotation-popup";
const STYLE = `:root[${ATTR}] ${POPUP} { visibility: hidden; }`;

export function installTextPopupHiding(win: any): () => void {
	const doc: Document = win.document;
	const root = doc.documentElement;
	const views = new Set<Document>();

	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE;
	(doc.head ?? root).appendChild(style);

	const editing = () =>
		Array.from(views).some((view) => {
			const active = view.activeElement;
			return !!active?.isConnected && active.matches(TEXT_ANNOTATION);
		});

	const refresh = () => {
		const hide = editing();
		if (hide !== root.hasAttribute(ATTR)) root.toggleAttribute(ATTR, hide);
	};

	// Mid-`focusout` the old element may still count as active; look once it has settled.
	let timer = 0;
	const refreshSoon = () => {
		refresh();
		win.clearTimeout(timer);
		timer = win.setTimeout(refresh, 0);
	};

	const stopViews = trackViewDocuments(win, (view) => {
		views.add(view);
		view.addEventListener("focusin", refreshSoon, true);
		view.addEventListener("focusout", refreshSoon, true);
		refresh();
		return () => {
			views.delete(view);
			view.removeEventListener("focusin", refreshSoon, true);
			view.removeEventListener("focusout", refreshSoon, true);
			refresh();
		};
	});

	// Before the popup is painted: observer callbacks run ahead of the next frame.
	const isPopup = (node: Node) =>
		node.nodeType === 1 && ((node as Element).matches(POPUP) || !!(node as Element).querySelector(POPUP));
	const observer = new win.MutationObserver((records: MutationRecord[]) => {
		if (records.some((record) => Array.from(record.addedNodes).some(isPopup))) refresh();
	});
	observer.observe(doc.body, { childList: true, subtree: true });

	return () => {
		observer.disconnect();
		win.clearTimeout(timer);
		stopViews();
		root.removeAttribute(ATTR);
		style.remove();
	};
}

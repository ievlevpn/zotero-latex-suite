/* A "bigger window" button on the annotation popup, and moving and resizing it.
 *
 * The in-page popup is 240px wide, which is fine for a sentence and cramped for
 * an equation. This adds a button to its header that blows it up in place —
 * not fullscreen, just big enough to read formulas — and back. Once enlarged it
 * covers the page, so its header drags it out of the way and a grip in its
 * corner sizes it to the formula at hand.
 *
 * Everything here works around the popup being React's: its classes are
 * rewritten on every render (the pointer side is part of `className`), so the
 * state is a data attribute React never sets; and its position is an inline
 * `transform` worked out once from its *small* size, so the enlarged popup
 * ignores it and centres itself over the document instead. The pointer arrow
 * would then point at nothing, so it goes too. Position and size ride in custom
 * properties for the same reason: React owns `style.transform` and would wipe a
 * position written there, but it never touches a property it didn't set.
 *
 * Size is held as the height of the comment field rather than of the popup, so
 * that Zotero's own layout inside the popup is left exactly as it is: the field
 * is the only part that should absorb the extra room anyway.
 */
const ATTR = "data-latex-suite-big";
const BUSY = "data-latex-suite-busy";
const DX = "--latex-suite-dx";
const DY = "--latex-suite-dy";
const W = "--latex-suite-w";
const H = "--latex-suite-h";
const BUTTON_CLASS = "latex-suite-enlarge";
const GRIP_CLASS = "latex-suite-resize";
const STYLE_ID = "latex-suite-popup-enlarge";
const HEADER_END = ".annotation-popup .preview header .end";
const DRAG_HANDLE = `.annotation-popup[${ATTR}] .preview header`;
// Never move the popup so far out that there is nothing left to grab.
const KEEP_VISIBLE = 80;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 120;
// Only used where there is no layout to measure (jsdom); the CSS defaults match.
const FALLBACK_WIDTH = 720;
const FALLBACK_HEIGHT = 320;

const STYLE = `
.annotation-popup[${ATTR}] {
	width: var(${W}, min(720px, calc(100% - 40px)));
	max-width: calc(100% - 40px);
	top: 50%;
	left: 50%;
	transform: translate(calc(-50% + var(${DX}, 0px)), calc(-50% + var(${DY}, 0px))) !important;
}
.annotation-popup[${ATTR}]::before, .annotation-popup[${ATTR}]::after { display: none; }
.annotation-popup[${ATTR}] .comment { font-size: 17px; }
.annotation-popup[${ATTR}] .comment .content {
	min-height: var(${H}, 40vh);
	max-height: var(${H}, 75vh);
	overflow: auto;
}
.annotation-popup[${ATTR}] .preview header { cursor: move; }
.annotation-popup[${BUSY}], .annotation-popup[${BUSY}] * { user-select: none; }
.${BUTTON_CLASS} {
	display: flex; align-items: center; justify-content: center;
	width: 20px; height: 20px; padding: 0; margin-inline-start: 2px;
	border: none; border-radius: 4px; background: none;
	color: var(--fill-secondary); cursor: default;
}
.${BUTTON_CLASS}:hover { background: var(--fill-quinary); }
.${GRIP_CLASS} { display: none; }
.annotation-popup[${ATTR}] > .${GRIP_CLASS} {
	display: block;
	position: absolute; inset-block-end: 0; inset-inline-end: 0;
	width: 16px; height: 16px; z-index: 1;
	cursor: nwse-resize;
	background: linear-gradient(
		-45deg, transparent 2px, var(--fill-quaternary) 2px 3px,
		transparent 3px 5px, var(--fill-quaternary) 5px 6px, transparent 6px);
}
`;

// Two arrows pointing out / pointing in, as window managers draw them.
const ENLARGE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1h4v4M11 1 7 5M5 11H1V7M1 11l4-4"/></svg>`;
const RESTORE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5H7V1M7 5l4-4M1 7h4v4M5 7l-4 4"/></svg>`;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function update(button: HTMLElement, big: boolean) {
	const label = big ? "Restore popup size" : "Enlarge popup";
	button.innerHTML = big ? RESTORE : ENLARGE;
	button.title = label;
	button.setAttribute("aria-label", label);
	button.setAttribute("aria-pressed", String(big));
}

function prop(el: HTMLElement, name: string): number {
	return parseFloat(el.style.getPropertyValue(name)) || 0;
}

/** Centred and default-sized again: the small popup places itself, and a reopened big one starts fresh. */
function reset(popup: HTMLElement) {
	[DX, DY, W, H].forEach((name) => popup.style.removeProperty(name));
}

function addButton(doc: Document, end: Element) {
	if (end.querySelector(`.${BUTTON_CLASS}`)) return;
	const popup = end.closest(".annotation-popup") as HTMLElement | null;
	if (!popup) return;

	const button = doc.createElement("button");
	button.className = BUTTON_CLASS;
	button.tabIndex = -1;
	update(button, popup.hasAttribute(ATTR));
	// Keep the caret in the comment: a button that takes focus would end the edit.
	button.addEventListener("mousedown", (event) => event.preventDefault());
	button.addEventListener("click", (event) => {
		event.stopPropagation();
		const big = !popup.hasAttribute(ATTR);
		popup.toggleAttribute(ATTR, big);
		if (!big) reset(popup);
		update(button, big);
	});
	// Last, so it sits in the corner, past Zotero's own "…" menu.
	end.appendChild(button);
}

function addGrip(doc: Document, popup: Element) {
	if (popup.querySelector(`:scope > .${GRIP_CLASS}`)) return;
	const grip = doc.createElement("div");
	grip.className = GRIP_CLASS;
	grip.addEventListener("mousedown", (event) => event.preventDefault());
	popup.appendChild(grip);
}

/** Returns a teardown that removes everything added and puts every popup back. */
export function installPopupEnlarge(win: any): () => void {
	const doc: Document = win.document;

	if (!doc.getElementById(STYLE_ID)) {
		const style = doc.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		(doc.head ?? doc.documentElement).appendChild(style);
	}

	const scan = () => {
		doc.querySelectorAll(HEADER_END).forEach((end) => addButton(doc, end));
		doc.querySelectorAll(".annotation-popup").forEach((popup) => addGrip(doc, popup));
	};
	scan();

	/* Moving and resizing. One listener on the document, rather than one per
	 * header: the header is thrown away and rebuilt on every render, a handler
	 * bound to it would not be. */
	type Gesture = {
		popup: HTMLElement;
		resize: boolean;
		x: number; y: number;
		dx: number; dy: number;
		w: number; h: number;
	};
	let gesture: Gesture | null = null;

	const onMove = (event: MouseEvent) => {
		if (!gesture) return;
		const { popup } = gesture;
		if (!popup.isConnected || !popup.hasAttribute(ATTR)) return stop();
		event.preventDefault();
		const mx = event.clientX - gesture.x;
		const my = event.clientY - gesture.y;

		if (gesture.resize) {
			// The popup grows about its centre, so half of each gain is handed
			// back as an offset — that keeps its top-left corner still and the
			// grip under the pointer.
			const w = clamp(gesture.w + mx, MIN_WIDTH, Math.max(MIN_WIDTH, win.innerWidth - 40));
			const h = clamp(gesture.h + my, MIN_HEIGHT, Math.max(MIN_HEIGHT, win.innerHeight - 160));
			popup.style.setProperty(W, `${Math.round(w)}px`);
			popup.style.setProperty(H, `${Math.round(h)}px`);
			popup.style.setProperty(DX, `${Math.round(gesture.dx + (w - gesture.w) / 2)}px`);
			popup.style.setProperty(DY, `${Math.round(gesture.dy + (h - gesture.h) / 2)}px`);
			return;
		}

		let dx = gesture.dx + mx;
		let dy = gesture.dy + my;
		// Clamp against the window, from the box the popup would land in. jsdom
		// and any other layout-less host measure zero, and then nothing is clamped.
		const { width, height } = popup.getBoundingClientRect();
		if (width && height) {
			const left = (win.innerWidth - width) / 2 + dx;
			const top = (win.innerHeight - height) / 2 + dy;
			dx += clamp(left, KEEP_VISIBLE - width, win.innerWidth - KEEP_VISIBLE) - left;
			dy += clamp(top, 0, win.innerHeight - KEEP_VISIBLE) - top;
		}
		popup.style.setProperty(DX, `${Math.round(dx)}px`);
		popup.style.setProperty(DY, `${Math.round(dy)}px`);
	};

	function stop() {
		if (!gesture) return;
		gesture.popup.removeAttribute(BUSY);
		gesture = null;
		doc.removeEventListener("mousemove", onMove, true);
		doc.removeEventListener("mouseup", stop, true);
	}

	const onDown = (event: MouseEvent) => {
		if (event.button !== 0 || gesture) return;
		const target = event.target as Element | null;
		if (!target?.closest) return;

		const grip = target.closest(`.annotation-popup[${ATTR}] > .${GRIP_CLASS}`);
		// The header's own controls stay controls, and so does the comment field.
		const onControl = target.closest("button, input, textarea, a, [contenteditable]");
		const handle = grip ?? (onControl ? null : target.closest(DRAG_HANDLE));
		const popup = handle?.closest(".annotation-popup") as HTMLElement | null;
		if (!popup) return;

		event.preventDefault();
		const content = popup.querySelector(".comment .content");
		gesture = {
			popup,
			resize: Boolean(grip),
			x: event.clientX,
			y: event.clientY,
			dx: prop(popup, DX),
			dy: prop(popup, DY),
			w: popup.getBoundingClientRect().width || FALLBACK_WIDTH,
			h: content?.getBoundingClientRect().height || FALLBACK_HEIGHT,
		};
		popup.setAttribute(BUSY, "");
		doc.addEventListener("mousemove", onMove, true);
		doc.addEventListener("mouseup", stop, true);
	};
	doc.addEventListener("mousedown", onDown, true);

	// The popup is created, and its header recreated, whenever an annotation is
	// opened. Almost every mutation in the reader is something else, so only
	// additions are looked at, and only while a popup exists at all.
	const observer = new win.MutationObserver((mutations: MutationRecord[]) => {
		if (!mutations.some((m) => m.addedNodes.length)) return;
		if (doc.querySelector(".annotation-popup")) scan();
	});
	observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });

	return () => {
		stop();
		doc.removeEventListener("mousedown", onDown, true);
		observer.disconnect();
		doc.querySelectorAll(`.${BUTTON_CLASS}, .${GRIP_CLASS}`).forEach((el) => el.remove());
		doc.querySelectorAll(`[${ATTR}]`).forEach((p) => {
			p.removeAttribute(ATTR);
			reset(p as HTMLElement);
		});
		doc.getElementById(STYLE_ID)?.remove();
	};
}

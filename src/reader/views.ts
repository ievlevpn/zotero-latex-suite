/* The documents nested in a reader window.
 *
 * The reader shows the PDF itself in an iframe of its own — two, in split view
 * — and that is where text annotations live. Events there do not reach the
 * reader's document, so anything wanting them has to be attached to each
 * view's document, and again whenever an iframe loads a new one.
 *
 * The views are same-origin with the reader, so their documents are reachable
 * directly; an iframe that is not is skipped.
 */

type Attach = (doc: Document) => () => void;

/** Calls `attach` on every view document, current and future; returns the teardown. */
export function trackViewDocuments(win: any, attach: Attach): () => void {
	const doc: Document = win.document;
	const attached = new Map<HTMLIFrameElement, { doc: Document; stop: () => void }>();

	const detach = (frame: HTMLIFrameElement) => {
		const entry = attached.get(frame);
		if (!entry) return;
		attached.delete(frame);
		try {
			entry.stop();
		} catch (e) {
			console.error("latex-suite:", e);
		}
	};

	const look = (frame: HTMLIFrameElement) => {
		let inner: Document | null = null;
		try {
			inner = frame.contentDocument;
		} catch {
			/* cross-origin: nothing of ours in there */
		}
		const current = attached.get(frame);
		if (current && current.doc === inner) return;
		detach(frame);
		// Not loaded yet: its `load` event brings it back here.
		if (!inner?.body || inner.readyState === "loading") return;
		try {
			attached.set(frame, { doc: inner, stop: attach(inner) });
		} catch (e) {
			console.error("latex-suite:", e);
		}
	};

	/* `load` does not bubble, but it does pass through the capture phase of the
	 * document the iframe sits in — so this sees every view, however deep in the
	 * reader's tree it was created. */
	const onLoad = (event: Event) => {
		const target = event.target as HTMLElement;
		if (target?.nodeName !== "IFRAME") return;
		// A view that has gone away takes its documents with it.
		for (const frame of Array.from(attached.keys())) {
			if (!frame.isConnected) detach(frame);
		}
		look(target as HTMLIFrameElement);
	};

	doc.addEventListener("load", onLoad, true);
	for (const frame of Array.from(doc.querySelectorAll("iframe"))) look(frame);

	return () => {
		doc.removeEventListener("load", onLoad, true);
		for (const frame of Array.from(attached.keys())) detach(frame);
	};
}

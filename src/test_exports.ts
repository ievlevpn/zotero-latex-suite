// Surface for test.js: the engine, plus the editor layer, which can be driven
// headlessly with prosemirror-model/-state (no DOM needed).
export { DEFAULT_SETTINGS, DEFAULT_SNIPPETS, processSettings } from "./settings/settings";
export { parseSnippets, parseSnippetVariables, parseKeyName, keyNameFromEvent } from "./snippets/parse";
export { scanScopes, Context } from "./utils/context";
export { scanEquations, mathBoundsAt, renderableEquations } from "./utils/math_bounds";
export { tabstopSpecsToTabstopGroups } from "./snippets/tabstop";
export { asMathReplacement } from "./editor/insert_math";
export { Options } from "./snippets/options";
export { IncludedEnvironmentResult } from "./snippets/snippets";
export { PMBuffer, rememberSelectionClass } from "./editor/pm";
export { expandSnippet, setSelectionToNextTabstop, clearTabstops, clearTabstopsIfElsewhere, hasTabstops } from "./snippets/snippet_management";
export { runSnippets, expand } from "./features/run_snippets";
export { currentBuffer } from "./editor/index";
export { autoEnlargeBrackets } from "./features/auto_enlarge_brackets";
export { runAutoFraction } from "./features/autofraction";
export { renderMath, unrenderMath, syncRender, isRendered } from "./render/math";
export { segmentsOf, domPointAt, offsetOfPoint, selectionOffsets, setCaret } from "./render/segments";
export { installPopupEnlarge } from "./reader/popup_enlarge";
export { TextareaBuffer } from "./editor/textarea";
export { installTextAnnotationRendering } from "./reader/text_annotations";
export { trackViewDocuments } from "./reader/views";
export { parseInline } from "./render/inline";

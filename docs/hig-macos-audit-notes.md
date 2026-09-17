# macOS HIG audit notes for skd

## Scope and evidence

This is a research reference and **proposed audit checklist**, not a completed visual or accessibility audit. It covers the macOS desktop app (React in Tauri/WKWebView), not the operating systems of remote SSH hosts. The original research did not verify running-app behavior, computed styles, contrast ratios, or accessibility trees. Subsequent implementation checks below include opaque-token contrast calculations and DOM tests, but not native visual or accessibility acceptance.

Apple’s live HIG is version-dependent and now includes Liquid Glass guidance. Evaluate that guidance against skd’s supported macOS releases and actual native integration; do not treat the newest native appearance as a requirement to simulate it in CSS on every release.

Labels used below:

- **HIG guidance**: a paraphrase of retrieved Apple primary-source text, with a source reference.
- **Apple numeric reference**: an explicitly documented recommendation with its original units and scope, not an invented pixel specification.
- **skd audit choice**: a proposed application-specific interpretation or test. It is not a claim that Apple mandates this implementation.

All checklist items are **skd audit choices informed by the cited guidance**. An unchecked box means “not evaluated,” not “known defect.”

## Primary-source register

| ID | Apple source | Retrieval and relevance |
| --- | --- | --- |
| C | [Color](https://developer.apple.com/design/human-interface-guidelines/color) | Retrieved relevant sections: semantic system colors, appearance/contrast variants, color-independent information, and Liquid Glass color. |
| T | [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | Retrieved relevant sections: legibility, hierarchy, system/custom fonts, and Dynamic Type platform scope. |
| A | [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Retrieved an excerpt covering vision, contrast, VoiceOver, and the beginning of mobility/control sizing. Later sections were not available in this extraction. |
| S | [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | Retrieved: navigation purpose, disclosure, customization, hide/show, hierarchy, icon colors, and macOS considerations. |
| M | [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Retrieved relevant sections: Liquid Glass versus standard materials, semantic use, legibility, and macOS vibrancy/blending. |
| B | [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | Retrieved relevant sections: purpose, press states, prominence, roles, and macOS push buttons. |
| F | [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields) | Retrieved: labels, secure entry, sizing, spacing, focus order, validation, and truncation. |
| TB | [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) | **Retrieval failed:** Apple page extraction returned “An unknown error occurred.” No toolbar-specific rules are asserted from this page. Recheck directly before making toolbar-specific HIG compliance claims. |

The official [Controls](https://developer.apple.com/design/human-interface-guidelines/controls) page was also retrieved, but concerns controls exposed in places such as Control Center, the Lock Screen, and the Action button. It is **not** the generic macOS widget guide. Buttons and Text fields above supply the control guidance used here. No third-party summaries or archived HIG versions are used as normative sources.

## Guidance by foundation

### Color

**HIG guidance [C, A]**

- Use color consistently, especially for interactivity and status; do not make the same color communicate conflicting meanings.
- Prefer semantic system colors and use them for their intended purposes. A separator color is not a substitute for a text color.
- Test light, dark, and increased-contrast contexts. Custom palettes need suitable variants rather than an assumption that a single palette works everywhere.
- Convey essential information through text, shapes, or other cues as well as color.
- Consider lighting, display profiles, adjacent artwork, and translucent backgrounds when evaluating legibility.
- Do not hard-code documented system color values: actual values can change across releases and environmental conditions.

**skd audit choices**

Use semantic application tokens for surfaces, text hierarchy, separators, focus, selection, and status. Keep terminal ANSI/theme colors distinct from workspace chrome tokens. Record whether each token is an app-defined value or genuinely backed by a native semantic-color API.

A fixed sRGB/hex sample is only an **app palette value or captured sample**, not a native dynamic system color. Naming a CSS variable `system-*`, using a system font, or matching one screenshot does not provide macOS appearance, accent, selection, vibrancy, or increased-contrast adaptation. If native colors are bridged, verify updates when appearance and preferences change; if they are not, document the limitation and test the custom variants explicitly.

### Typography

**HIG guidance [T, A]**

- Prioritize legibility under realistic viewing conditions. Size, weight, contrast, and typeface all matter.
- Prefer readable weights; Apple generally advises against Ultralight, Thin, and Light for interface text.
- Establish hierarchy through size, weight, and color, and minimize unnecessary typeface variety.
- Consider system fonts and built-in text styles, while preserving hierarchy when text sizes change.
- Provide ways to enlarge text. The Typography page describes Dynamic Type as a feature of iOS, iPadOS, tvOS, visionOS, and watchOS; it does not list macOS in that platform definition.

**skd audit choices**

Use a system-oriented sans-serif stack for workspace UI and a configurable monospace face for terminal content. Verify the actual resolved fonts and fallback glyphs in WKWebView. Do not claim that `system-ui` gives web content native text styles, Dynamic Type, or automatic accessibility scaling. Test UI enlargement separately from terminal font enlargement, including long hostnames, paths, validation messages, and mixed-script terminal output.

### Controls

**HIG guidance [B, F]**

- Buttons must clearly communicate actions; familiar symbols or short action labels help. Custom buttons need a press state and enough surrounding space to distinguish and activate them.
- Use prominence, not mismatched sizes within a related set, to distinguish a preferred action. Avoid competing prominent buttons.
- Distinguish normal, primary, cancel, and destructive roles. Apple advises against assigning the primary role to a destructive action.
- Use text fields for small, specific inputs; provide labels where disappearing placeholders would lose context. Hide sensitive input using secure fields.
- Keep field spacing and alignment coherent, support logical tab order, and validate at appropriate moments.

**skd audit choices**

Test normal, hover, pressed, keyboard-focus, selected, disabled, loading, and error states where applicable. Prefer semantic HTML controls and verify actual accessibility output; a native-looking Radix component is not automatically an AppKit control. Use persistent field labels, explanatory validation, and password inputs in connection/settings forms. Treat choice of checkbox, switch, select, or segmented control as a contextual design decision; generic control-style mandates were not established by the retrieved sources.

### Sidebars

**HIG guidance [S]**

- A sidebar supports leading-side navigation among app areas or top-level collections.
- Use disclosure controls to manage large hierarchies; generally keep navigation sidebars to no more than two levels, considering a content list for deeper hierarchies.
- Use succinct group labels and meaningful, familiar symbols; allow customization when useful.
- Consider a familiar hide/show mechanism, including a button or View menu command on macOS. Avoid hiding the sidebar by default when it would undermine discovery.
- macOS sidebar row, text, and glyph sizes depend on the overall sidebar size and can reflect user preferences. Avoid placing critical information or actions only at the bottom.

**skd audit choices**

Distinguish host/workspace navigation from a filesystem outline. The two-level navigation recommendation is not a prohibition on browsing deeper directory trees. Verify host group expansion, clear selection and focus, resizing, hidden-sidebar recovery, and access to primary actions when the bottom of the window is obscured. Custom web sidebars need explicit testing or implementation of preference adaptation; native behavior is not inherited merely by resemblance.

### Materials

**HIG guidance [M, C]**

- Materials establish separation and hierarchy between foreground controls and background content.
- Current guidance treats Liquid Glass as a controls/navigation layer, not a decoration to apply throughout content. Use it sparingly.
- Choose standard materials by semantic use, not by a sampled apparent color. System settings can change their appearance and behavior.
- Preserve foreground legibility. macOS has purpose-specific standard materials, vibrant colors, and behind-window versus within-window blending.
- Material appearance can respond to reduced transparency and increased contrast settings.

**skd audit choices**

Keep terminal and dense file content readable on stable surfaces. If translucent navigation chrome is adopted, test it over varied content, in active/inactive windows, and with accessibility preferences. CSS opacity or `backdrop-filter` is **not** equivalent to AppKit vibrancy or native Liquid Glass. An opaque, tested fallback is preferable to an unverified imitation. Native-material availability and Tauri integration remain implementation questions, not findings of this research.

### Accessibility

**HIG guidance [A, C, T]**

- Interfaces should be intuitive, perceivable, and adaptable; audit their accessibility rather than relying on appearance alone.
- Use Accessibility Inspector to understand exposed information and find problems.
- Support larger text, sufficient contrast, and alternatives to color-only communication.
- Describe interface and content for VoiceOver, and provide controls people can comfortably activate.

**skd audit choices**

Run keyboard-only and VoiceOver workflows in the actual desktop app. Inspect accessible names, roles, values, expanded/selected states, focus visibility/order, modal focus return, and announcement behavior. Test Increase Contrast, Reduce Transparency, Reduce Motion, light/dark appearance, and enlarged text; verify which preferences WKWebView actually exposes. A browser media-query implementation must not be assumed to cover every macOS setting. For terminals, test xterm accessibility behavior without turning fast output into an unusable announcement stream.

## Numeric references versus product decisions

**These are not universal CSS pixel rules.** Apple points, CSS pixels, and device pixels belong to different coordinate/rendering contexts. Do not mechanically copy native point measurements into CSS `pt`, multiply them by display scale, or call an untested CSS value HIG-compliant.

| Subject | What the retrieved Apple source says | How to use it in skd |
| --- | --- | --- |
| Text size | [T, A] list macOS recommended default **13 pt** and minimum **10 pt**. | Native-platform reference, not a requirement to render all UI at one size or a justification to shrink all secondary text to the minimum. CSS font sizes and line heights remain product choices requiring legibility tests. |
| Text enlargement | [A] says ideally offer enlargement of at least **200 percent** (with a watchOS-specific exception). | Use as an accessibility test reference; decide and document how skd exposes enlargement. Do not claim macOS Dynamic Type support from CSS alone. |
| Control size | [A] lists macOS default **28 × 28 pt**, minimum **20 × 20 pt**. [B] separately gives a general **44 × 44 pt** hit-region rule (and a visionOS exception). | Preserve the differing contexts instead of declaring one universal desktop pixel minimum. Check the current platform/component guidance and test target size, spacing, and input method. Visible glyph size is not the same as clickable target size. |
| Contrast | [A] cites contrast calculators and WCAG Level AA guidance, including **4.5:1** and **3:1** depending on text size/weight. | Measure actual foreground/background pairs and document the applicable criterion. The HIG table is a summary, not a complete web conformance procedure. Do not infer that arbitrary small bold CSS text qualifies for relaxed contrast. |
| Navigation hierarchy | [S] generally recommends no more than **two levels** in a sidebar. | A navigation recommendation, not a filesystem depth limit. |

**No numeric skd design tokens are approved by this document.** Toolbar heights, sidebar widths, row density, dialog sizes, corner radii, spacing scales, shadow values, animation durations, icon sizes, and CSS font sizes must be recorded separately as **app-specific choices**, with component/state, rationale, and measured test results. The retrieved sources do not establish a universal macOS corner radius, toolbar height, spacing grid, or row height. Do not invent one or substitute an iOS touch target for all desktop controls.

## Per-area checklist

### Toolbar — informed by [B, C, T, A, M]; toolbar-specific source unavailable

- [ ] Make frequent actions discoverable; group related actions and avoid multiple competing primary treatments.
- [ ] Verify action labels/tooltips, accessible names, and pressed/disabled/focus states for icon-only buttons.
- [ ] At narrow widths, retain access to essential actions without overlapping window controls or a draggable title region.
- [ ] Distinguish custom web chrome from any native toolbar/material behavior; recheck [TB] before claiming toolbar-specific HIG compliance.

### Sidebar — [S, C, T, A]

- [ ] Separate navigation grouping, selected item, keyboard focus, hover, and connection status visually and semantically.
- [ ] Verify disclosure controls, concise labels, long-name access, keyboard navigation, and screen-reader state announcements.
- [ ] Offer discoverable hide/show and resize behavior; preserve access to important actions regardless of bottom-edge visibility.
- [ ] Test row/text/glyph legibility and accent/appearance preferences; document unsupported native preference adaptation.

### Terminal — [C, T, A, M]

- [ ] Keep content typography independently configurable; test cursor, selection, search matches, ANSI colors, and inactive panes in each supported theme.
- [ ] Distinguish active terminal focus from tab selection and connection status without relying on color alone.
- [ ] Verify keyboard shortcuts do not swallow shell input, Space/Enter, or IME composition; test entering and leaving terminal focus.
- [ ] Test VoiceOver/xterm accessibility, text enlargement, split-pane resizing, and rapid output without excessive announcements or decorative motion.

### File browser — [C, T, A, S, B]

- [ ] Clearly distinguish local/remote location, path, loading, empty, permission-denied, and disconnected states.
- [ ] Verify selection, focus, sorting, disclosure, and multiselection semantics with keyboard and VoiceOver; do not confuse navigation depth guidance with filesystem depth.
- [ ] Keep names and metadata legible; expose full truncated names/paths accessibly and allow useful resizing or layout adaptation.
- [ ] Make upload/download direction and destination explicit; provide alternatives to drag-and-drop and context-menu-only actions.
- [ ] Make delete/overwrite consequences clear, avoid destructive default actions, and surface actionable transfer failures.

### Dialogs — [B, F, T, A]

- [ ] Provide a clear purpose, labeled fields, logical focus order, validation associated with inputs, and secure credential entry.
- [ ] Test initial focus, modal containment, safe Return/Escape behavior, and return of focus to the invoking control; avoid accidental destructive submission.
- [ ] Test connection, host-key trust, transfer, and close-confirmation content with long messages and enlarged text.
- [ ] Keep titles and actions reachable in small windows; test Tauri viewport containment rather than relying on browser-only behavior.

### Settings — [F, B, C, T, A]

- [ ] Group related preferences with clear labels and descriptions; use control types that make each value/state understandable.
- [ ] Make immediate versus deferred application clear and distinguish terminal-only preferences from workspace-wide preferences.
- [ ] Test appearance, terminal font, and accessibility-related choices with preview/recovery paths so an unreadable choice can be undone.
- [ ] Verify keyboard traversal, secure handling of sensitive fields, validation, scrolling, and enlarged-text layout.

### Welcome — [B, T, C, A]

- [ ] Establish a clear starting action, such as opening a local shell or creating a connection, without competing visual emphasis.
- [ ] Keep secondary help and recent connections discoverable and keyboard/screen-reader accessible.
- [ ] Test empty history, long saved names, small windows, enlarged text, and light/dark appearance.

### Status — [C, T, A]

- [ ] Communicate connection/session/transfer states with text or distinct symbols as well as color.
- [ ] Keep compact status text readable; do not make the smallest documented size the default for essential information.
- [ ] Distinguish informational labels from clickable actions and expose meaningful names/values.
- [ ] Preserve access to critical state when panels resize, and avoid repeatedly announcing every metric update.

### Feedback — [A, C, B, F]

- [ ] Give clear progress, completion, cancellation, and failure feedback for asynchronous work without claiming success before completion.
- [ ] Make errors actionable and persistent or recoverable enough to read/copy; avoid essential details existing only in a briefly visible toast.
- [ ] Verify appropriate accessible announcements without stealing terminal focus; do not use color, sound, or animation alone.
- [ ] Test reduced-motion behavior, repeated failures, simultaneous transfers, and retry/cancel flows; do not expose credentials in feedback.

## Audit evidence to collect next

For each area, record macOS/app version, appearance and accessibility settings, window size, screenshot or interaction steps, actual computed values where relevant, and pass/fail evidence. Include focused and unfocused windows, narrow layouts, long content, keyboard-only use, and VoiceOver in `bun run tauri dev`; browser-only rendering cannot establish native menu, material, or accessibility integration.

## Second-pass implementation checkpoint

See [the visual baseline](ui-visual-baseline.md#hig-second-pass--targeted-remediation) for frozen color values and manual acceptance steps. This checkpoint does not mark the proposed checklist above as fully audited.

- Corrected dark destructive text contrast and Nordic success contrast. Tests now require success/warning/destructive on background/card/popover/selected/hover surfaces and semantic filled-control foreground pairs to meet 4.5:1 in all three dark palettes. This is a skd audit criterion informed by the numeric reference above, measured from opaque CSS tokens rather than rendered pixels.
- Added a named, focusable path-edit button while retaining breadcrumbs. Path input ignores composition Enter/Escape, submits once on Enter, cancels on Escape and returns keyboard focus; blur submission does not reclaim focus. Three DOM regression tests cover these behaviors. Native button activation, IME and VoiceOver remain manual checks.
- Retained 13px file-list text / 12px chrome and first-pass sidebar selection/disclosure styling; no further layout or surface-color changes.
- Final frontend checks: **735 tests passed / 7 skipped**, production build passed, ESLint **0 errors / 180 warnings**. Tests are not visual acceptance.
- Still pending: native minimum-window and narrow-pane review, actual focus-ring/composited contrast, VoiceOver, inline rename focus, log-control naming, Compose focus treatment and remaining motion coverage. Fixed palettes still do not provide system-accent adaptation or native vibrancy.

Keep findings distinct from proposals: a recommendation above is not proof of a current defect. Remaining research gaps include successful retrieval of Toolbars, unexamined portions of long HIG pages, dedicated guidance for tables/dialogs/settings/feedback, and version-specific native API availability. The per-area recommendations for those surfaces are applications of the retrieved foundations, not quotations from unreviewed component pages.

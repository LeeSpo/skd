import React, { useRef, useEffect, useCallback, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars, dropCursor } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { loadEditorConfig, EDITOR_CONFIG_CHANGED_EVENT, type EditorConfig } from "@/lib/editor-config";

type LanguageLoader = () => Promise<Extension | null>;

/** Map file extension to a lazy CodeMirror language loader. */
function getLanguageLoader(filename: string): LanguageLoader | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return async () => (await import("@codemirror/lang-javascript")).javascript();
    case "ts":
    case "mts":
    case "cts":
      return async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "jsx":
      return async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "tsx":
      return async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true });
    case "json":
    case "jsonc":
      return async () => (await import("@codemirror/lang-json")).json();
    case "py":
    case "pyw":
      return async () => (await import("@codemirror/lang-python")).python();
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return async () => (await import("@codemirror/lang-html")).html();
    case "css":
    case "scss":
    case "less":
      return async () => (await import("@codemirror/lang-css")).css();
    case "md":
    case "mdx":
    case "markdown":
      return async () => (await import("@codemirror/lang-markdown")).markdown();
    case "xml":
    case "svg":
    case "xsl":
    case "xslt":
      return async () => (await import("@codemirror/lang-xml")).xml();
    case "yml":
    case "yaml":
      return async () => (await import("@codemirror/lang-yaml")).yaml();
    case "rs":
      return async () => (await import("@codemirror/lang-rust")).rust();
    case "c":
    case "h":
    case "cpp":
    case "cxx":
    case "cc":
    case "hpp":
    case "hxx":
      return async () => (await import("@codemirror/lang-cpp")).cpp();
    case "java":
    case "kt":
    case "kts":
      return async () => (await import("@codemirror/lang-java")).java();
    case "sql":
      return async () => (await import("@codemirror/lang-sql")).sql();
    case "php":
      return async () => (await import("@codemirror/lang-php")).php();
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "conf":
    case "ini":
    case "toml":
    case "cfg":
    case "env":
    case "log":
    case "txt":
    default:
      return null;
  }
}

interface CodeEditorProps {
  /** Initial document content */
  value: string;
  /** Called whenever the document changes */
  onChange?: (value: string) => void;
  /** Filename used for language detection */
  filename?: string;
  /** Read-only mode */
  readOnly?: boolean;
  /** Use dark theme (defaults to true). Ignored when the user has chosen a theme via editor settings. */
  dark?: boolean;
  /** Additional CSS class for the wrapper */
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  filename = "",
  readOnly = false,
  dark = true,
  className = "",
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const [editorConfig, setEditorConfig] = useState<EditorConfig>(() => loadEditorConfig());
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null);

  // Reload config whenever it changes in settings
  useEffect(() => {
    const handler = () => setEditorConfig(loadEditorConfig());
    window.addEventListener(EDITOR_CONFIG_CHANGED_EVENT, handler);
    return () => window.removeEventListener(EDITOR_CONFIG_CHANGED_EVENT, handler);
  }, []);

  // Keep callback ref fresh without recreating the editor
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    const loader = getLanguageLoader(filename);
    setLanguageExtension(null);
    if (!loader) return;

    void loader().then((extension) => {
      if (!cancelled) {
        setLanguageExtension(extension);
      }
    }).catch(() => {
      if (!cancelled) {
        setLanguageExtension(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filename]);

  const buildExtensions = useCallback((): Extension[] => {
    const exts: Extension[] = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      // Dispatch listener for onChange
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      // Tab size from config
      EditorState.tabSize.of(editorConfig.tabSize),
    ];

    // Conditional extensions based on user config
    if (editorConfig.lineNumbers) {
      exts.push(lineNumbers());
      exts.push(highlightActiveLineGutter());
    }
    if (editorConfig.highlightActiveLine) {
      exts.push(highlightActiveLine());
    }
    if (editorConfig.foldGutter) {
      exts.push(foldGutter());
    }
    if (editorConfig.bracketMatching || editorConfig.matchBrackets) {
      exts.push(bracketMatching());
    }
    if (editorConfig.wordWrap) {
      exts.push(EditorView.lineWrapping);
    }

    // Theme: user-configured theme takes precedence over the `dark` prop
    const themeId = editorConfig.theme;
    if (themeId === "oneDark") {
      exts.push(oneDark);
    } else if (themeId === "light") {
      // No extra extension needed — CodeMirror's base chrome is light
    } else if (dark) {
      exts.push(oneDark);
    }

    if (readOnly) {
      exts.push(EditorState.readOnly.of(true));
    }

    if (languageExtension) {
      exts.push(languageExtension);
    }

    return exts;
  }, [readOnly, dark, editorConfig, languageExtension]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: buildExtensions(),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only recreate when language/readOnly/dark changes, not on every value change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildExtensions]);

  // Sync external value changes (e.g. loading a new file) without recreating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`overflow-auto border rounded-md ${className}`}
      style={{
        height: "100%",
        fontSize: `${editorConfig.fontSize}px`,
        fontFamily: editorConfig.fontFamily,
      }}
    />
  );
}

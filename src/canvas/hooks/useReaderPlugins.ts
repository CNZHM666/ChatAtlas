import { useEffect, useMemo, useState } from "react";
import rehypeSanitize from "rehype-sanitize";
import type { ComponentProps } from "react";
import type ReactMarkdown from "react-markdown";
import { queueReaderRender } from "../reader-render-queue";
import { readerSanitizeSchema } from "../reader-sanitize";

type Plugins = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
let katex: Promise<typeof import("rehype-katex")> | undefined;
let highlight: Promise<typeof import("rehype-highlight")> | undefined;

/** Plain Markdown can appear immediately; load heavy formatting only when needed. */
export function useReaderPlugins(math: boolean, code: boolean): Plugins {
  const [mathPlugin, setMathPlugin] = useState<typeof import("rehype-katex").default>();
  const [codePlugin, setCodePlugin] = useState<typeof import("rehype-highlight").default>();
  useEffect(() => {
    let live = true;
    const cancel: Array<() => void> = [];
    if (math && !mathPlugin) void (katex ??= import("rehype-katex")).then((module) => { if (live) cancel.push(queueReaderRender(() => setMathPlugin(() => module.default))); }).catch(() => { katex = undefined; });
    if (code && !codePlugin) void (highlight ??= import("rehype-highlight")).then((module) => { if (live) cancel.push(queueReaderRender(() => setCodePlugin(() => module.default))); }).catch(() => { highlight = undefined; });
    return () => { live = false; cancel.forEach((stop) => stop()); };
  }, [math, code, mathPlugin, codePlugin]);
  return useMemo(() => [[rehypeSanitize, readerSanitizeSchema], ...(math && mathPlugin ? [mathPlugin] : []), ...(code && codePlugin ? [[codePlugin, { detect: false, ignoreMissing: true }] as Plugins[number]] : [])], [math, mathPlugin, code, codePlugin]);
}

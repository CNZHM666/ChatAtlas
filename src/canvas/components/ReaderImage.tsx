import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDatabase } from "../../storage/db";
import { viewableImageUrl } from "../../shared/conversation-images";

export function ReaderImage({ src = "", alt, zh }: { src?: string; alt?: string; zh: boolean }) {
  const [resolved, setResolved] = useState<{ source: string; url?: string; failed?: boolean }>();
  const [retry, setRetry] = useState(0), [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), close = useRef<HTMLButtonElement>(null);
  const label = alt || (zh ? "对话图片" : "Conversation image");
  useEffect(() => {
    let active = true;
    if (viewableImageUrl(src)) setResolved({ source: src, url: src });
    else if (/^atlas-image:sha256-[a-z\d]+$/iu.test(src)) {
      void getDatabase().then(db => db.get("imageAssets", src.slice(12))).then(asset => {
        if (active) setResolved({ source: src, ...(asset && viewableImageUrl(asset.dataUrl) ? { url: asset.dataUrl } : { failed: true }) });
      }).catch(() => { if (active) setResolved({ source: src, failed: true }); });
    } else setResolved({ source: src, failed: true });
    return () => { active = false; };
  }, [src, retry]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const opener = trigger.current;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
      if (event.key === "Tab") { event.preventDefault(); close.current?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); (opener ?? previous)?.focus(); };
  }, [expanded]);
  const image = resolved?.source === src ? resolved : undefined;
  if (!image?.url || image.failed) return <span className="reader-image-fallback" role="status"><span>{image?.failed ? zh ? "图片资源未保存或暂时无法加载" : "Image unavailable or not saved" : zh ? "正在加载图片…" : "Loading image…"}</span>{alt ? <small>{alt}</small> : null}{image?.failed ? <button type="button" onClick={() => { setResolved(undefined); setRetry(value => value + 1); }}>{zh ? "重试" : "Retry"}</button> : null}</span>;
  return <span className="reader-image">
    <button type="button" ref={trigger} className="reader-image-open" aria-label={zh ? `放大图片：${label}` : `Enlarge image: ${label}`} onClick={() => setExpanded(true)}>
      <img src={image.url} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setResolved({ source: src, failed: true })} />
    </button>
    {expanded ? createPortal(<div className="reader-image-lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
      <button type="button" ref={close} onClick={() => setExpanded(false)}>{zh ? "关闭图片" : "Close image"}</button>
      <img src={image.url} alt={alt ?? ""} referrerPolicy="no-referrer" />
    </div>, document.body) : null}
  </span>;
}

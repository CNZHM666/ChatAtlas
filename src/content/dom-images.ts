import { imageMarkdown } from "../shared/conversation-images";

export function domImageMarkdown(image: HTMLImageElement): string {
  if (image.closest('[hidden],[aria-hidden="true"],[data-testid*="avatar"],.avatar')) return "";
  const source = image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src") || "";
  if (!source || /^(?:javascript|file):/iu.test(source)) return "";
  let resolved = source;
  try { if (!/^(?:data|blob):/iu.test(source)) resolved = new URL(source, location.href).href; } catch { return ""; }
  return imageMarkdown(resolved, image.alt || undefined);
}

/** Snapshot references before text flattening; image-only uploads must retain a message. */
export function retainDomImages(copy: HTMLElement, original: HTMLElement): void {
  const originals = [...original.querySelectorAll<HTMLImageElement>("img")];
  const images = [...copy.querySelectorAll<HTMLImageElement>("img")];
  images.forEach((image, index) => {
    const markdown = domImageMarkdown(originals[index] ?? image);
    const button = image.closest('button,[role="button"]');
    if (button) { const span = document.createElement("span"); span.textContent = `\n${markdown}\n`; image.replaceWith(span); button.replaceWith(...button.childNodes); }
    else image.replaceWith(document.createTextNode(`\n${markdown}\n`));
  });
}

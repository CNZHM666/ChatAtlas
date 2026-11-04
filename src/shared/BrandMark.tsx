import { brandLogos } from "./brand-assets";
import "./brand.css";

/** Decorative beside the product name, which supplies the accessible label. */
export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`atlas-brand-mark ${className}`} aria-hidden="true">
    <img className="atlas-logo-light" src={brandLogos.light} alt="" width="32" height="32" draggable={false} />
    <img className="atlas-logo-dark" src={brandLogos.dark} alt="" width="32" height="32" draggable={false} />
  </span>;
}

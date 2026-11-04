import lightLogo from "../assets/brand/icon-128.png";
import darkLogo from "../assets/brand/icon-dark-128.png";
import lightFavicon from "../assets/brand/icon-32.png";
import darkFavicon from "../assets/brand/icon-dark-32.png";

export const brandLogos = { light: lightLogo, dark: darkLogo };

/** Match the app's explicit theme, including appearance messages from the host. */
export function installBrandFavicon(): void {
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/png";
    document.head.append(icon);
  }
  const update = () => { icon.href = document.documentElement.dataset.theme === "dark" ? darkFavicon : lightFavicon; };
  update();
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

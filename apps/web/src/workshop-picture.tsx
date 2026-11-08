import images from "./generated/workshop-images.json";

function sources(variant: typeof images.variants.square, format: "avif" | "webp") {
  return variant[format].map((image) => `${image.src} ${image.width}w`).join(", ");
}

const fullWidthSizes = "100vw";
const desktopSizes = "50vw";

export function WorkshopPicture() {
  return (
    <picture className="sign-in-picture" aria-hidden="true">
      <source media="(min-width: 64rem) and (min-aspect-ratio: 2/1)" type="image/avif" srcSet={sources(images.variants.square, "avif")} sizes={desktopSizes} />
      <source media="(min-width: 64rem) and (min-aspect-ratio: 2/1)" type="image/webp" srcSet={sources(images.variants.square, "webp")} sizes={desktopSizes} />
      <source media="(min-width: 64rem)" type="image/avif" srcSet={sources(images.variants.portrait, "avif")} sizes={desktopSizes} />
      <source media="(min-width: 64rem)" type="image/webp" srcSet={sources(images.variants.portrait, "webp")} sizes={desktopSizes} />
      <source media="(min-width: 40rem)" type="image/avif" srcSet={sources(images.variants.panorama, "avif")} sizes={fullWidthSizes} />
      <source media="(min-width: 40rem)" type="image/webp" srcSet={sources(images.variants.panorama, "webp")} sizes={fullWidthSizes} />
      <source type="image/avif" srcSet={sources(images.variants.square, "avif")} sizes={fullWidthSizes} />
      <img src="/images/workshop/workshop-square-768.webp" srcSet={sources(images.variants.square, "webp")} sizes={fullWidthSizes} alt="" width={768} height={768} fetchPriority="high" decoding="async" />
    </picture>
  );
}

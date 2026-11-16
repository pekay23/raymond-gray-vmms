interface WorkshopImageEntry {
  src: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

interface WorkshopVariant {
  aspectRatio: number;
  webp: WorkshopImageEntry[];
  avif: WorkshopImageEntry[];
}

interface WorkshopImagesManifest {
  schemaVersion: number;
  signature: string;
  settings: {
    widths: number[];
    includeSourceWidth: boolean;
    webp: { quality: number; effort: number };
    avif: { quality: number; effort: number };
    sharp: string;
  };
  inputs: Array<{
    name: string;
    file: string;
    sha256: string;
    width: number;
    height: number;
  }>;
  variants: {
    square: WorkshopVariant;
    panorama: WorkshopVariant;
    portrait: WorkshopVariant;
  };
}

interface BrandImageEntry {
  src: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

interface BrandVariant {
  fallback: string;
  width: number;
  height: number;
  webp: BrandImageEntry[];
}

interface BrandImagesManifest {
  schemaVersion: number;
  signature: string;
  settings: {
    widths: number[];
    format: string;
    lossless: boolean;
    effort: number;
    sharp: string;
  };
  inputs: Array<{
    name: string;
    file: string;
    sha256: string;
    width: number;
    height: number;
    bytes: number;
  }>;
  variants: {
    standard: BrandVariant;
    white: BrandVariant;
  };
}

declare module "./generated/workshop-images.json" {
  const value: WorkshopImagesManifest;
  export default value;
}

declare module "./generated/brand-images.json" {
  const value: BrandImagesManifest;
  export default value;
}
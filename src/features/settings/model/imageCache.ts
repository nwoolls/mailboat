/** The image cache sizes Settings offers, in MB. */
export const IMAGE_CACHE_SIZES: { value: string; label: string }[] = [
  { value: "250", label: "250 MB" },
  { value: "500", label: "500 MB" },
  { value: "1000", label: "1 GB" },
  { value: "2000", label: "2 GB" },
];

/** "12 images · 3.4 MB", or "Empty". */
export function describeImageCache(size: { kilobytes: number; images: number }): string {
  if (size.images === 0) return "Empty";
  const mb = size.kilobytes / 1024;
  const amount =
    mb >= 1000
      ? `${(mb / 1000).toFixed(1)} GB`
      : mb >= 10
        ? `${Math.round(mb)} MB`
        : `${mb.toFixed(1)} MB`;
  const images = `${size.images.toLocaleString("en-US")} ${size.images === 1 ? "image" : "images"}`;
  return `${images} · ${amount}`;
}

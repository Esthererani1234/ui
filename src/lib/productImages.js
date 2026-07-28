const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const PUBLIC_RENDER_PATH = "/storage/v1/render/image/public/";

export function productImageUrl(url, width = 720, quality = 80) {
  if (!url || typeof url !== "string") return "";

  try {
    const parsed = new URL(url);
    if (
      !parsed.hostname.endsWith(".supabase.co") ||
      !parsed.pathname.includes(PUBLIC_OBJECT_PATH)
    )
      return url;

    parsed.pathname = parsed.pathname.replace(
      PUBLIC_OBJECT_PATH,
      PUBLIC_RENDER_PATH,
    );
    parsed.searchParams.set("width", String(width));
    parsed.searchParams.set("quality", String(quality));
    parsed.searchParams.set("resize", "contain");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function productImageSrcSet(url, widths = [320, 480, 720]) {
  if (!url) return undefined;
  return widths
    .map((width) => `${productImageUrl(url, width)} ${width}w`)
    .join(", ");
}

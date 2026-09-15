export function productImageUrl(url) {
  return typeof url === "string" ? url : "";
}

export function productImageSrcSet() {
  // Supabase's image-rendering endpoint can fail while the original public
  // object remains available. Prefer the reliable original over a broken
  // responsive transform; browsers will still size it using width/height/CSS.
  return undefined;
}

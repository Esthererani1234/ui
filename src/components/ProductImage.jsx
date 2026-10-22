import { useState } from "react";

// Track the failed source, so navigating to another gallery image can recover.
export default function ProductImage({ src, alt = "", ...props }) {
  const [failedSource, setFailedSource] = useState(null);
  if (!src || failedSource === src) {
    return <span className="product-image-fallback" role="img" aria-label={alt ? `${alt}: image unavailable` : "Image unavailable"}>Image unavailable</span>;
  }
  return <img {...props} src={src} alt={alt} onError={() => setFailedSource(src)} />;
}

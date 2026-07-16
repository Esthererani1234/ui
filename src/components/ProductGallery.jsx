import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { metalSymbol } from "../lib/pricing";

export default function ProductGallery({ product, images }) {
  const gallery = [...new Set((images || []).filter(Boolean))];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const touchStart = useRef(null);
  const didSwipe = useRef(false);
  const galleryKey = gallery.join("|");
  const activeImage = gallery[currentIndex];

  useEffect(() => {
    setCurrentIndex(0);
    setZoom(1);
  }, [galleryKey]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft")
        setCurrentIndex((index) =>
          gallery.length ? (index - 1 + gallery.length) % gallery.length : 0,
        );
      if (event.key === "ArrowRight")
        setCurrentIndex((index) =>
          gallery.length ? (index + 1) % gallery.length : 0,
        );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxOpen, gallery.length]);

  const move = (direction) => {
    if (gallery.length < 2) return;
    setCurrentIndex(
      (index) => (index + direction + gallery.length) % gallery.length,
    );
    setZoom(1);
  };

  const closeLightbox = () => {
    didSwipe.current = false;
    touchStart.current = null;
    setZoom(1);
    setLightboxOpen(false);
  };

  const startSwipe = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    didSwipe.current = false;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const finishSwipe = (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch || !touchStart.current) return;
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    didSwipe.current = true;
    move(deltaX < 0 ? 1 : -1);
  };

  const openLightbox = () => {
    if (didSwipe.current) {
      didSwipe.current = false;
      return;
    }
    if (activeImage) {
      setZoom(1);
      setLightboxOpen(true);
    }
  };

  return (
    <>
      <div className="product-gallery">
        <div
          className="detail-image product-media-stage"
          onTouchStart={startSwipe}
          onTouchEnd={finishSwipe}
        >
          {activeImage ? (
            <button
              type="button"
              className="product-main-image"
              onClick={openLightbox}
              aria-label={`Magnify ${product.name}`}
            >
              <img src={activeImage} alt={product.name} />
            </button>
          ) : (
            <div
              className={`bullion-art hero-product ${product.metal} ${product.category}`}
            >
              <span>{metalSymbol(product.metal)}</span>
              <b>{product.name}</b>
              <small>{product.metal_weight_oz} TROY OZ</small>
            </div>
          )}
          {gallery.length > 1 && (
            <>
              <button
                type="button"
                className="gallery-arrow previous"
                onClick={() => move(-1)}
                aria-label="Previous product picture"
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className="gallery-arrow next"
                onClick={() => move(1)}
                aria-label="Next product picture"
              >
                <ChevronRight />
              </button>
              <span className="gallery-count">
                {currentIndex + 1} / {gallery.length}
              </span>
            </>
          )}
          {activeImage && (
            <button
              type="button"
              className="gallery-magnify"
              onClick={openLightbox}
              aria-label="Open fullscreen image viewer"
            >
              <ZoomIn /> <span>Magnify</span>
            </button>
          )}
        </div>
        {gallery.length > 1 && (
          <>
            <div className="product-gallery-thumbnails" aria-label="Product pictures">
              {gallery.map((url, index) => (
                <button
                  type="button"
                  key={url}
                  className={index === currentIndex ? "active" : ""}
                  onClick={() => {
                    setCurrentIndex(index);
                    setZoom(1);
                  }}
                  aria-label={`View product picture ${index + 1}`}
                  aria-pressed={index === currentIndex}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
            <small className="gallery-swipe-hint">Swipe to view more pictures</small>
          </>
        )}
      </div>

      {lightboxOpen && activeImage && (
        <div
          className="product-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${product.name} image viewer`}
          onClick={closeLightbox}
        >
          <header onClick={(event) => event.stopPropagation()}>
            <span>
              <b>{product.name}</b>
              <small>
                Picture {currentIndex + 1} of {gallery.length}
              </small>
            </span>
            <button
              type="button"
              onClick={closeLightbox}
              aria-label="Close image viewer"
            >
              <X />
            </button>
          </header>
          <div
            className="product-lightbox-stage"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={startSwipe}
            onTouchEnd={finishSwipe}
          >
            {gallery.length > 1 && (
              <button
                type="button"
                className="lightbox-arrow previous"
                onClick={() => move(-1)}
                aria-label="Previous product picture"
              >
                <ChevronLeft />
              </button>
            )}
            <img
              src={activeImage}
              alt={`${product.name}, picture ${currentIndex + 1}`}
              style={{ transform: `scale(${zoom})` }}
            />
            {gallery.length > 1 && (
              <button
                type="button"
                className="lightbox-arrow next"
                onClick={() => move(1)}
                aria-label="Next product picture"
              >
                <ChevronRight />
              </button>
            )}
          </div>
          <footer onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
              disabled={zoom <= 1}
              aria-label="Zoom out"
            >
              <ZoomOut />
            </button>
            <b>{Math.round(zoom * 100)}%</b>
            <button
              type="button"
              onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
              disabled={zoom >= 3}
              aria-label="Zoom in"
            >
              <ZoomIn />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
              aria-label="Reset zoom"
            >
              <RotateCcw /> Reset
            </button>
          </footer>
        </div>
      )}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Minus, Plus, ShieldCheck, ShoppingCart, Truck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { metalSymbol, money, productPrice } from "../lib/pricing";
import { useCart } from "../state/CartContext";
import MarketTicker from "../components/MarketTicker";

export default function ProductPage() {
  const { slug } = useParams();
  const { add, items, lastAdded } = useCart();
  const [product, setProduct] = useState(null);
  const [spot, setSpot] = useState(null);
  const [quantity, setQuantity] = useState("1");
  const [selectedImage, setSelectedImage] = useState("");
  const receivePrices = useCallback((next) => setSpot(next), []);

  useEffect(() => {
    setProduct(null);
    setSelectedImage("");
    setQuantity("1");
    supabase
      .from("products")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single()
      .then(({ data }) => {
        setProduct(data || false);
        if (data) {
          const gallery = [
            ...new Set(
              [data.image_url, ...(data.image_urls || [])].filter(Boolean),
            ),
          ];
          setSelectedImage(gallery[0] || "");
        }
      });
  }, [slug]);

  if (product === false)
    return (
      <div className="empty-state standalone">
        <h1>Product not found</h1>
        <Link className="button button-dark" to="/shop">
          Back to shop
        </Link>
      </div>
    );
  if (!product)
    return <div className="page-loader">Loading bullion details…</div>;
  const price = productPrice(product, spot);
  const gallery = [
    ...new Set(
      [product.image_url, ...(product.image_urls || [])].filter(Boolean),
    ),
  ];
  const activeImage = selectedImage || gallery[0];
  const inventoryCount = Math.max(0, Number(product.inventory_count) || 0);
  const cartQuantity =
    items.find((item) => item.product.id === product.id)?.quantity || 0;
  const remainingInventory = Math.max(0, inventoryCount - cartQuantity);
  const isAtLimit = inventoryCount > 0 && remainingInventory < 1;
  const wasJustAdded = lastAdded?.productId === product.id;
  const parsedQuantity = Number(quantity);
  const quantityIsWholeNumber = Number.isInteger(parsedQuantity);
  const quantityIsValid =
    quantity !== "" &&
    quantityIsWholeNumber &&
    parsedQuantity >= 1 &&
    parsedQuantity <= remainingInventory;
  const quantityError =
    inventoryCount > 0 &&
    remainingInventory > 0 &&
    quantity !== "" &&
    quantityIsWholeNumber &&
    parsedQuantity > remainingInventory
      ? cartQuantity > 0
        ? `${cartQuantity} already in your cart. Only ${inventoryCount} available total.`
        : `Only ${inventoryCount} available.`
      : quantity !== "" && (!quantityIsWholeNumber || parsedQuantity < 1)
        ? "Enter a quantity of at least 1."
        : "";

  const changeQuantity = (value) => {
    if (value === "" || /^\d+$/.test(value)) setQuantity(value);
  };

  return (
    <>
      <div className="page-only-ticker">
        <MarketTicker onPrices={receivePrices} />
      </div>
      <section className="section product-detail-section">
        <div className="container">
          <div className="breadcrumbs">
            <Link to="/shop">Shop</Link>
            <span>/</span>
            <Link to={`/shop?metal=${product.metal}`}>{product.metal}</Link>
            <span>/</span>
            <b>{product.name}</b>
          </div>
          <div className="product-detail-grid">
            <div className="product-gallery">
              <div className="detail-image">
                {activeImage ? (
                  <img src={activeImage} alt={product.name} />
                ) : (
                  <div
                    className={`bullion-art hero-product ${product.metal} ${product.category}`}
                  >
                    <span>{metalSymbol(product.metal)}</span>
                    <b>{product.name}</b>
                    <small>{product.metal_weight_oz} TROY OZ</small>
                  </div>
                )}
              </div>
              {gallery.length > 1 && (
                <div
                  className="product-gallery-thumbnails"
                  aria-label="Product pictures"
                >
                  {gallery.map((url, index) => (
                    <button
                      type="button"
                      key={url}
                      className={url === activeImage ? "active" : ""}
                      onClick={() => setSelectedImage(url)}
                      aria-label={`View product picture ${index + 1}`}
                      aria-pressed={url === activeImage}
                    >
                      <img src={url} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="detail-copy">
              <span className="product-kicker">
                {product.metal} • {product.category} • SKU {product.sku}
              </span>
              <h1>{product.name}</h1>
              <p className="detail-lead">{product.description}</p>
              <div className="live-price-box">
                <span>Current live price</span>
                <strong>
                  {price == null ? "Request quote" : money(price)}
                </strong>
                <small>
                  Price refreshes with the {product.metal} market. Final total
                  is recalculated at checkout.
                </small>
              </div>
              <div className="inventory-line">
                <b
                  className={
                    product.inventory_count > 0 ? "stock in" : "stock out"
                  }
                >
                  {product.inventory_count > 0
                    ? "In stock"
                    : "Out of stock"}
                </b>
              </div>
              <div className="buy-row">
                <div className="quantity">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={parsedQuantity <= 1}
                    onClick={() =>
                      setQuantity(String(Math.max(1, parsedQuantity - 1)))
                    }
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    aria-label={`${product.name} quantity`}
                    aria-invalid={Boolean(quantityError)}
                    aria-describedby={quantityError ? "quantity-error" : undefined}
                    value={quantity}
                    onChange={(event) => changeQuantity(event.target.value)}
                    onBlur={() => {
                      if (quantity === "") setQuantity("1");
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={parsedQuantity >= remainingInventory}
                    onClick={() =>
                      setQuantity(
                        String(Math.min(remainingInventory, parsedQuantity + 1)),
                      )
                    }
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <button
                  className={`button button-gold grow${wasJustAdded ? " added" : ""}`}
                  disabled={
                    !product.inventory_count ||
                    price == null ||
                    !quantityIsValid ||
                    isAtLimit
                  }
                  onClick={() => add(product, parsedQuantity)}
                >
                  {wasJustAdded ? (
                    <><Check size={18} /> Added to cart</>
                  ) : isAtLimit ? (
                    <><Check size={18} /> Maximum in cart</>
                  ) : (
                    <><ShoppingCart size={18} /> Add to cart</>
                  )}
                </button>
              </div>
              {isAtLimit && inventoryCount > 0 && !wasJustAdded && (
                <p className="quantity-note">All available units are already in your cart.</p>
              )}
              {quantityError && (
                <p className="quantity-error" id="quantity-error" role="alert">
                  {quantityError}
                </p>
              )}
              <div className="detail-assurances">
                <span>
                  <ShieldCheck /> Authenticity guaranteed
                </span>
                <span>
                  <Truck /> Insured, signature-required shipping
                </span>
              </div>
            </div>
          </div>
          <div className="product-specs">
            <h2>Product specifications</h2>
            <dl>
              <div>
                <dt>Metal</dt>
                <dd>{product.metal}</dd>
              </div>
              <div>
                <dt>Pure metal weight</dt>
                <dd>{product.metal_weight_oz} troy oz</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{product.category}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}

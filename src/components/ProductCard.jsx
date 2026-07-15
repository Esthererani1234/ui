import { Link } from "react-router-dom";
import { Check, ShoppingCart } from "lucide-react";
import { metalSymbol, money, productPrice } from "../lib/pricing";
import { useCart } from "../state/CartContext";

export default function ProductCard({ product, spot }) {
  const { add, items, lastAdded } = useCart();
  const price = productPrice(product, spot);
  const mainImage = product.image_url || product.image_urls?.[0];
  const cartQuantity =
    items.find((item) => item.product.id === product.id)?.quantity || 0;
  const inventoryCount = Math.max(0, Number(product.inventory_count) || 0);
  const isAtLimit = inventoryCount > 0 && cartQuantity >= inventoryCount;
  const wasJustAdded = lastAdded?.productId === product.id;
  return (
    <article className="product-card">
      {product.badge && <span className="product-badge">{product.badge}</span>}
      <Link className="product-image" to={`/product/${product.slug}`}>
        {mainImage ? (
          <img src={mainImage} alt={product.name} />
        ) : (
          <div className={`bullion-art ${product.metal} ${product.category}`}>
            <span>{metalSymbol(product.metal)}</span>
            <small>{product.metal_weight_oz} TROY OZ</small>
          </div>
        )}
      </Link>
      <div className="product-card-body">
        <span className="product-kicker">
          {product.metal} • {product.category}
        </span>
        <Link to={`/product/${product.slug}`}>
          <h3>{product.name}</h3>
        </Link>
        <p>{product.short_description}</p>
        <div className="product-price-row">
          <div>
            <small>{price == null ? "Contact for price" : "Live price"}</small>
            <strong>{price == null ? "Request quote" : money(price)}</strong>
          </div>
          <span
            className={product.inventory_count > 0 ? "stock in" : "stock out"}
          >
            {product.inventory_count > 0 ? "In stock" : "Out of stock"}
          </span>
        </div>
        <button
          className={`add-button${wasJustAdded ? " added" : ""}`}
          disabled={!product.inventory_count || price == null || isAtLimit}
          onClick={() => add(product)}
        >
          {wasJustAdded ? (
            <><Check size={17} /> Added to cart</>
          ) : isAtLimit ? (
            <><Check size={17} /> Maximum in cart</>
          ) : (
            <><ShoppingCart size={17} /> Add to cart</>
          )}
        </button>
      </div>
    </article>
  );
}

import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { money, productPrice } from "../lib/pricing";
import { useCart } from "../state/CartContext";

export default function ProductCard({ product, spot }) {
  const { add } = useCart();
  const price = productPrice(product, spot);
  return (
    <article className="product-card">
      {product.badge && <span className="product-badge">{product.badge}</span>}
      <Link className="product-image" to={`/product/${product.slug}`}>
        {product.image_url ? <img src={product.image_url} alt={product.name} /> : <div className={`bullion-art ${product.metal} ${product.category}`}><span>{product.metal === "gold" ? "Au" : product.metal === "silver" ? "Ag" : product.metal === "platinum" ? "Pt" : "Pd"}</span><small>{product.metal_weight_oz} TROY OZ</small></div>}
      </Link>
      <div className="product-card-body">
        <span className="product-kicker">{product.metal} • {product.category}</span>
        <Link to={`/product/${product.slug}`}><h3>{product.name}</h3></Link>
        <p>{product.short_description}</p>
        <div className="product-price-row">
          <div><small>{price == null ? "Contact for price" : "Live price"}</small><strong>{price == null ? "Request quote" : money(price)}</strong></div>
          <span className={product.inventory_count > 0 ? "stock in" : "stock out"}>{product.inventory_count > 0 ? `${product.inventory_count} available` : "Out of stock"}</span>
        </div>
        <button className="add-button" disabled={!product.inventory_count || price == null} onClick={() => add(product)}><ShoppingCart size={17} /> Add to cart</button>
      </div>
    </article>
  );
}

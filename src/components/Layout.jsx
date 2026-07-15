import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Menu, Search, ShieldCheck, ShoppingCart, User, X } from "lucide-react";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";
import SupportAssistant from "./SupportAssistant";

function Logo() {
  return (
    <Link className="brand" to="/" aria-label="GoldOnTheSpot home">
      <span className="brand-mark">G</span>
      <span className="brand-copy"><b>GoldOnTheSpot</b><small>PRECIOUS METALS • RIGHT NOW</small></span>
    </Link>
  );
}

export default function Layout() {
  const { count, lastAdded, clearLastAdded } = useCart();
  const { user, isAdmin } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setMenuOpen(false); window.scrollTo({ top: 0, behavior: "auto" }); }, [location.pathname]);
  useEffect(() => {
    if (!lastAdded) return undefined;
    const timer = window.setTimeout(clearLastAdded, 2800);
    return () => window.clearTimeout(timer);
  }, [lastAdded]);
  useEffect(() => {
    const titles = { "/": "GoldOnTheSpot | Precious Metals, Right Now", "/shop": "Shop Live-Priced Bullion | GoldOnTheSpot", "/cart": "Shopping Cart | GoldOnTheSpot", "/checkout": "Secure Checkout | GoldOnTheSpot", "/login": "Customer Sign In | GoldOnTheSpot", "/account": "Your Account | GoldOnTheSpot", "/support": "Customer Support | GoldOnTheSpot", "/shipping": "Shipping & Insurance | GoldOnTheSpot", "/terms": "Terms of Purchase | GoldOnTheSpot", "/privacy": "Privacy Policy | GoldOnTheSpot", "/about": "About GoldOnTheSpot" };
    document.title = location.pathname.startsWith("/product/") ? "Bullion Product | GoldOnTheSpot" : titles[location.pathname] || "GoldOnTheSpot";
  }, [location.pathname]);

  const submitSearch = (event) => {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/shop?q=${encodeURIComponent(query)}` : "/shop");
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="utility-bar">
        <div className="container utility-inner">
          <span><ShieldCheck size={14} /> Secure bullion ordering</span>
          <span>Questions? <a href="mailto:support@goldonthespot.com">support@goldonthespot.com</a></span>
        </div>
      </div>
      <header className="site-header">
        <div className="container header-main">
          <Logo />
          <form className="header-search" onSubmit={submitSearch} role="search">
            <Search size={18} />
            <input name="q" aria-label="Search products" placeholder="Search coins, bars, mints, weights…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button type="submit">Search</button>
          </form>
          <div className="header-actions">
            <Link className="header-action" to={user ? "/account" : "/login"}><User size={22} /><span>{user ? "Account" : "Sign in"}</span></Link>
            <Link className={`header-action cart-link${lastAdded ? " cart-bump" : ""}`} to="/cart"><ShoppingCart size={22} /><span>Cart</span>{count > 0 && <b>{count}</b>}</Link>
            <button type="button" className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle menu" aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button>
          </div>
        </div>
        <nav className={menuOpen ? "main-nav open" : "main-nav"}>
          <div className="container nav-inner">
            <NavLink to="/shop?metal=gold">Gold</NavLink>
            <NavLink to="/shop?metal=silver">Silver</NavLink>
            <NavLink to="/shop?metal=platinum">Platinum</NavLink>
            <NavLink to="/shop?metal=palladium">Palladium</NavLink>
            <NavLink to="/shop?category=coin">Coins</NavLink>
            <NavLink to="/shop?category=bar">Bars</NavLink>
            <NavLink to="/shop?featured=true">Best Sellers</NavLink>
            <NavLink to="/about">Why GoldOnTheSpot</NavLink>
            <NavLink to="/support">Support</NavLink>
            {isAdmin && <NavLink className="admin-link" to="/admin">Admin</NavLink>}
          </div>
        </nav>
      </header>
      {lastAdded && (
        <div className="cart-toast" key={lastAdded.id} role="status" aria-live="polite">
          <CheckCircle2 />
          <span>
            <b>Added to cart</b>
            <small>
              {lastAdded.quantity > 1 ? `${lastAdded.quantity} × ` : ""}
              {lastAdded.productName}
            </small>
          </span>
          <Link to="/cart" onClick={clearLastAdded}>View cart</Link>
        </div>
      )}
      <main id="main-content"><Outlet /></main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-brand"><Logo /><p>Investment-grade precious metals with live market pricing and careful fulfillment.</p></div>
          <div><h4>Shop</h4><Link to="/shop?metal=gold">Gold</Link><Link to="/shop?metal=silver">Silver</Link><Link to="/shop?metal=platinum">Platinum</Link><Link to="/shop">All bullion</Link></div>
          <div><h4>Customer care</h4><Link to="/support">Help center</Link><Link to="/shipping">Shipping & insurance</Link><Link to="/account?tab=orders">Order status</Link><a href="mailto:support@goldonthespot.com">Email support</a></div>
          <div><h4>Company</h4><Link to="/about">About us</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link></div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 GoldOnTheSpot. All rights reserved.</span>
          <span>Precious metals involve risk. Prices may rise or fall.</span>
        </div>
      </footer>
      {location.pathname !== "/admin" && <SupportAssistant />}
    </div>
  );
}

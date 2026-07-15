import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Menu, Search, ShieldCheck, ShoppingCart, User, X } from "lucide-react";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";

function Logo() {
  return (
    <Link className="brand" to="/" aria-label="GoldOnTheSpot home">
      <span className="brand-mark">G</span>
      <span className="brand-copy"><b>GoldOnTheSpot</b><small>PRECIOUS METALS • RIGHT NOW</small></span>
    </Link>
  );
}

export default function Layout() {
  const { count } = useCart();
  const { user, isAdmin } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), []);

  return (
    <div className="app-shell">
      <div className="utility-bar">
        <div className="container utility-inner">
          <span><ShieldCheck size={14} /> Secure bullion ordering</span>
          <span>Questions? <a href="mailto:support@goldonthespot.com">support@goldonthespot.com</a></span>
        </div>
      </div>
      <header className="site-header">
        <div className="container header-main">
          <Logo />
          <form className="header-search" action="/shop">
            <Search size={18} />
            <input name="q" aria-label="Search products" placeholder="Search coins, bars, mints, weights…" />
            <button type="submit">Search</button>
          </form>
          <div className="header-actions">
            <Link className="header-action" to={user ? "/account" : "/login"}><User size={22} /><span>{user ? "Account" : "Sign in"}</span></Link>
            <Link className="header-action cart-link" to="/cart"><ShoppingCart size={22} /><span>Cart</span>{count > 0 && <b>{count}</b>}</Link>
            <button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle menu">{menuOpen ? <X /> : <Menu />}</button>
          </div>
        </div>
        <nav className={menuOpen ? "main-nav open" : "main-nav"}>
          <div className="container nav-inner">
            <NavLink to="/shop?metal=gold">Gold</NavLink>
            <NavLink to="/shop?metal=silver">Silver</NavLink>
            <NavLink to="/shop?metal=platinum">Platinum</NavLink>
            <NavLink to="/shop?category=coin">Coins</NavLink>
            <NavLink to="/shop?category=bar">Bars</NavLink>
            <NavLink to="/shop?featured=true">Best Sellers</NavLink>
            <NavLink to="/about">Why GoldOnTheSpot</NavLink>
            {isAdmin && <NavLink className="admin-link" to="/admin">Admin</NavLink>}
          </div>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-brand"><Logo /><p>Investment-grade precious metals with live spot pricing, transparent premiums, and careful fulfillment.</p></div>
          <div><h4>Shop</h4><Link to="/shop?metal=gold">Gold</Link><Link to="/shop?metal=silver">Silver</Link><Link to="/shop?metal=platinum">Platinum</Link><Link to="/shop">All bullion</Link></div>
          <div><h4>Customer care</h4><Link to="/shipping">Shipping & insurance</Link><Link to="/account">Order status</Link><a href="mailto:support@goldonthespot.com">Contact support</a></div>
          <div><h4>Company</h4><Link to="/about">About us</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link></div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 GoldOnTheSpot. All rights reserved.</span>
          <span>Precious metals involve risk. Prices may rise or fall.</span>
        </div>
      </footer>
    </div>
  );
}

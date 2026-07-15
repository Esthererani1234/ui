import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./state/AuthContext";

const HomePage = lazy(() => import("./pages/HomePage"));
const ShopPage = lazy(() => import("./pages/ShopPage"));
const ProductPage = lazy(() => import("./pages/ProductPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const InfoPage = lazy(() => import("./pages/InfoPage"));

function Guard({ admin = false, children }) {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <div className="page-loader">Loading secure account…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !isAdmin) return <Navigate to="/account" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader">Loading GoldOnTheSpot…</div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="shop" element={<ShopPage />} />
          <Route path="product/:slug" element={<ProductPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<Guard><CheckoutPage /></Guard>} />
          <Route path="login" element={<AuthPage />} />
          <Route path="account" element={<Guard><AccountPage /></Guard>} />
          <Route path="admin" element={<Guard admin><AdminPage /></Guard>} />
          <Route path="about" element={<InfoPage type="about" />} />
          <Route path="shipping" element={<InfoPage type="shipping" />} />
          <Route path="terms" element={<InfoPage type="terms" />} />
          <Route path="privacy" element={<InfoPage type="privacy" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

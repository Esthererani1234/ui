import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import AnalyticsTracker from "./components/AnalyticsTracker";
import HomePage from "./pages/HomePage";
import { useAuth } from "./state/AuthContext";
import {readOnlyPreview} from './lib/supabase';

const ShopPage = lazy(() => import("./pages/ShopPage"));
const ProductPage = lazy(() => import("./pages/ProductPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const CustomerMfaPage = lazy(() => import("./pages/CustomerMfaPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const InfoPage = lazy(() => import("./pages/InfoPage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

function PreviewGate({children}){
 return readOnlyPreview ? <section className="section container narrow"><h1>Storefront preview</h1><p>This preview lets you browse products. Accounts, payments and support submissions are available on the live website.</p><a className="button button-gold" href="https://goldonthespot.com">Go to Gold On The Spot</a></section> : children;
}

function Guard({ admin = false, requireMfa = true, children }) {
  const {
    user,
    isAdmin,
    loading,
    requiresCustomerMfa,
    customerSmsVerified,
  } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loader">Loading secure account…</div>;
  if (!user) return <Navigate to={`/login?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  if (admin && !isAdmin) return <Navigate to="/account" replace />;
  if (
    requireMfa &&
    !isAdmin &&
    requiresCustomerMfa &&
    !customerSmsVerified
  )
    return (
      <Navigate
        to={`/verify-phone?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
      />
    );
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader">Loading GoldOnTheSpot…</div>}>
      {!readOnlyPreview && <AnalyticsTracker />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="shop" element={<ShopPage />} />
          <Route path="product/:slug" element={<ProductPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<PreviewGate><Guard><CheckoutPage /></Guard></PreviewGate>} />
          <Route path="login" element={<PreviewGate><AuthPage /></PreviewGate>} />
          <Route path="verify-phone" element={<PreviewGate><Guard requireMfa={false}><CustomerMfaPage /></Guard></PreviewGate>} />
          <Route path="account" element={<PreviewGate><Guard><AccountPage /></Guard></PreviewGate>} />
          <Route path="admin" element={<PreviewGate><Guard admin><AdminPage /></Guard></PreviewGate>} />
          <Route path="about" element={<InfoPage type="about" />} />
          <Route path="shipping" element={<InfoPage type="shipping" />} />
          <Route path="terms" element={<InfoPage type="terms" />} />
          <Route path="privacy" element={<InfoPage type="privacy" />} />
          <Route path="support" element={<PreviewGate><SupportPage /></PreviewGate>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

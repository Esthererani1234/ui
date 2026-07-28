import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./state/AuthContext";
import { CartProvider } from "./state/CartContext";
import { fetchMarketPrices } from "./lib/marketPrices";
import { fetchActiveProducts } from "./lib/catalogCache";
import "./styles.css";

// Start public storefront data requests before React mounts. Components reuse
// these shared in-flight requests instead of beginning serial waits later.
fetchMarketPrices().catch(() => {});
fetchActiveProducts().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

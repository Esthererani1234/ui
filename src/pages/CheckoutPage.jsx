import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  CreditCard,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { readCachedMarket } from "../lib/marketPrices";
import { metalSymbol, money, productPrice } from "../lib/pricing";
import { useCart } from "../state/CartContext";
import { useAuth } from "../state/AuthContext";
import { productImageUrl } from "../lib/productImages";
import {
  clearCheckoutRecovery,
  saveCheckoutRecovery,
} from "../lib/checkoutRecovery";

const defaults = {
  shipping_flat: 35,
  free_shipping_threshold: 5000,
  card_surcharge_percent: 4,
  accepting_orders: true,
};

const stripeClients = new Map();

const stripeClient = (key) => {
  if (!key) return null;
  if (!stripeClients.has(key)) stripeClients.set(key, loadStripe(key));
  return stripeClients.get(key);
};

const secondsUntil = (date) =>
  Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));

const clock = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

const CardFields = forwardRef(function CardFields({ amount, email }, ref) {
  const stripe = useStripe();
  const elements = useElements();

  useEffect(() => {
    if (!elements || amount <= 0) return;
    try {
      elements.update({ amount });
    } catch {
      // Stripe keeps the current form mounted while the next update retries.
    }
  }, [elements, amount]);

  useImperativeHandle(
    ref,
    () => ({
      async createToken(shipping) {
        if (!stripe || !elements)
          throw new Error("The secure card form is still loading.");

        const { error: submitError } = await elements.submit();
        if (submitError)
          throw new Error(submitError.message || "Check your card details.");

        const { error, confirmationToken } =
          await stripe.createConfirmationToken({
            elements,
            params: { shipping },
          });
        if (error || !confirmationToken) {
          throw new Error(error?.message || "Check your card details.");
        }
        return confirmationToken.id;
      },
      async handleNextAction(clientSecret) {
        if (!stripe)
          throw new Error("The secure card form is still loading.");
        const { error, paymentIntent } = await stripe.handleNextAction({
          clientSecret,
        });
        if (error) {
          throw new Error(
            error.message || "Card verification was not completed.",
          );
        }
        return paymentIntent;
      },
    }),
    [stripe, elements],
  );

  return (
    <PaymentElement
      options={{
        layout: { type: "tabs", defaultCollapsed: false },
        defaultValues: { billingDetails: { email } },
      }}
    />
  );
});

export default function CheckoutPage() {
  const { items, clear, reconcileProducts } = useCart();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeOrderId = Number(searchParams.get("resume_order"));
  const cardRef = useRef(null);
  const quoteRequestRef = useRef(false);
  const quoteRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(defaults);
  const [paymentConfig, setPaymentConfig] = useState({
    enabled: false,
    wire: true,
    card: false,
    embedded_card: false,
    crypto: false,
    stripe_publishable_key: null,
  });
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [priceNotice, setPriceNotice] = useState("");
  const [orderInfo, setOrderInfo] = useState(null);
  const [cartReady, setCartReady] = useState(false);
  const [form, setForm] = useState({
    firstName: profile?.first_name || "",
    lastName: profile?.last_name || "",
    phone: profile?.phone || "",
    address1: profile?.address_line_1 || "",
    address2: profile?.address_line_2 || "",
    city: profile?.city || "",
    state: profile?.state || "",
    postalCode: profile?.postal_code || "",
    paymentMethod: "card",
    notes: "",
    saveAddress: true,
    agree: false,
  });

  useEffect(() => {
    quoteRef.current = quote;
  }, [quote]);

  const itemIds = useMemo(
    () =>
      items
        .map((item) => item.product.id)
        .sort((a, b) => a - b)
        .join(","),
    [items],
  );

  const cartPayload = useMemo(
    () =>
      items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
      })),
    [items],
  );

  const cartSignature = useMemo(
    () =>
      cartPayload
        .map((item) => `${item.product_id}:${item.quantity}`)
        .join("|"),
    [cartPayload],
  );

  useEffect(() => {
    Promise.all([
      fetch("/api/payments/config").then((response) =>
        response.ok ? response.json() : null,
      ),
      supabase
        .from("app_settings")
        .select("key, value")
        .in("key", [
          "shipping_flat",
          "free_shipping_threshold",
          "card_surcharge_percent",
          "accepting_orders",
        ]),
    ])
      .then(([config, settingResult]) => {
        if (config?.methods) {
          const next = {
            enabled: Boolean(config.enabled),
            ...config.methods,
            stripe_publishable_key: config.stripe_publishable_key || null,
          };
          setPaymentConfig(next);
          setForm((currentForm) => {
            if (next.embedded_card) {
              return { ...currentForm, paymentMethod: "card" };
            }
            if (next.wire) return { ...currentForm, paymentMethod: "wire" };
            return currentForm;
          });
        }

        const nextSettings = { ...defaults };
        for (const row of settingResult.data || []) {
          nextSettings[row.key] =
            row.key === "accepting_orders"
              ? Boolean(row.value)
              : Number(row.value);
        }
        setSettings(nextSettings);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!itemIds) {
      setCartReady(true);
      return;
    }

    setCartReady(false);
    const ids = itemIds.split(",").map(Number);
    supabase
      .from("products")
      .select("*")
      .in("id", ids)
      .then(({ data, error: catalogError }) => {
        if (catalogError) {
          setError(
            "Current inventory could not be refreshed. Checkout will still verify it securely.",
          );
        } else {
          reconcileProducts(data || []);
        }
        setCartReady(true);
      });
  }, [itemIds, reconcileProducts]);

  const authenticatedPost = useCallback(async (url, body) => {
    const { data } = await supabase.auth.getSession();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session?.access_token || ""}`,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const nextError = new Error(
        result.error || "The request could not be completed.",
      );
      nextError.code = result.code;
      nextError.status = response.status;
      throw nextError;
    }
    return result;
  }, []);

  const getFreshQuote = useCallback(
    async ({ automatic = false, orderId = null } = {}) => {
      if (quoteRequestRef.current) return null;
      quoteRequestRef.current = true;
      if (automatic) setQuoteRefreshing(true);
      else setQuoteLoading(true);
      setError("");

      try {
        const previousTotal = Number(quoteRef.current?.card_total || 0);
        const next = await authenticatedPost(
          "/api/checkout/quote",
          orderId ? { order_id: orderId } : { cart: cartPayload },
        );

        quoteRef.current = next;
        setQuote(next);
        setSecondsLeft(secondsUntil(next.expires_at));

        if (automatic) {
          setForm((currentForm) => ({ ...currentForm, agree: false }));
          const changed =
            previousTotal > 0 &&
            Math.abs(Number(next.card_total) - previousTotal) >= 0.01;
          setPriceNotice(
            changed
              ? `The market moved. Your card total was refreshed to ${money(
                  next.card_total,
                )} and is locked for another 10 minutes. Review and accept the new price.`
              : "Your price lock was refreshed for another 10 minutes. Review and accept it before paying.",
          );
        }
        return next;
      } catch (quoteError) {
        setError(
          quoteError.message ||
            "A fresh market quote is temporarily unavailable.",
        );
        return null;
      } finally {
        quoteRequestRef.current = false;
        setQuoteLoading(false);
        setQuoteRefreshing(false);
      }
    },
    [authenticatedPost, cartPayload],
  );

  useEffect(() => {
    if (
      !Number.isSafeInteger(resumeOrderId) ||
      resumeOrderId < 1 ||
      quoteRef.current ||
      quoteRequestRef.current
    ) {
      return;
    }

    getFreshQuote({ orderId: resumeOrderId }).then((next) => {
      if (!next) return;
      setOrderInfo({
        order_id: next.order_id,
        order_number: next.order_number,
        price_locked_until: next.expires_at,
      });
      const address = next.shipping_address || {};
      setForm((currentForm) => ({
        ...currentForm,
        firstName: next.first_name || currentForm.firstName,
        lastName: next.last_name || currentForm.lastName,
        phone: next.phone || currentForm.phone,
        address1: address.address_line_1 || currentForm.address1,
        address2: address.address_line_2 || currentForm.address2,
        city: address.city || currentForm.city,
        state: address.state || currentForm.state,
        postalCode: address.postal_code || currentForm.postalCode,
        paymentMethod: "card",
        agree: false,
      }));
    });
  }, [resumeOrderId, getFreshQuote]);

  useEffect(() => {
    if (Number.isSafeInteger(resumeOrderId) && resumeOrderId > 0) return;
    if (
      !user ||
      !cartReady ||
      !cartSignature ||
      quoteRef.current ||
      quoteRequestRef.current
    ) {
      return;
    }
    getFreshQuote();
  }, [user, cartReady, cartSignature, resumeOrderId, getFreshQuote]);

  useEffect(() => {
    if (!quote?.expires_at) return undefined;
    const tick = () => setSecondsLeft(secondsUntil(quote.expires_at));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [quote?.expires_at]);

  useEffect(() => {
    if (
      !quote ||
      secondsLeft > 0 ||
      quoteRefreshing ||
      quoteLoading ||
      busy
    ) {
      return;
    }
    getFreshQuote({
      automatic: true,
      orderId: orderInfo?.order_id || null,
    });
  }, [
    secondsLeft,
    quote,
    quoteRefreshing,
    quoteLoading,
    busy,
    orderInfo?.order_id,
    getFreshQuote,
  ]);

  const fallbackEstimate = useMemo(() => {
    const spot = readCachedMarket()?.metals || null;
    const subtotal = items.reduce(
      (sum, item) =>
        sum + (productPrice(item.product, spot) || 0) * item.quantity,
      0,
    );
    const shipping =
      subtotal >= settings.free_shipping_threshold
        ? 0
        : settings.shipping_flat;
    const cardSurcharge =
      (subtotal * settings.card_surcharge_percent) / 100;
    return {
      subtotal,
      shipping,
      card_surcharge: cardSurcharge,
      wire_total: subtotal + shipping,
      card_total: subtotal + shipping + cardSurcharge,
    };
  }, [items, settings]);

  const pricing = quote || fallbackEstimate;
  const wireTotal = Number.isFinite(Number(pricing.wire_total))
    ? Number(pricing.wire_total)
    : Number(pricing.subtotal || 0) + Number(pricing.shipping || 0);
  const displayedTotal =
    form.paymentMethod === "card"
      ? Number(pricing.card_total || 0)
      : wireTotal;

  const displayItems =
    quote?.line_items ||
    items.map((item) => {
      const spot = readCachedMarket()?.metals || null;
      const unitPrice = productPrice(item.product, spot);
      return {
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: (unitPrice || 0) * item.quantity,
        image_url:
          item.product.image_url || item.product.image_urls?.[0] || null,
        metal: item.product.metal,
      };
    });

  const estimatedUnits = displayItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );

  if (
    !items.length &&
    !orderInfo &&
    !(Number.isSafeInteger(resumeOrderId) && resumeOrderId > 0)
  ) {
    return <Navigate to="/cart" replace />;
  }

  const shippingPayload = () => ({
    name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    address: {
      line1: form.address1.trim(),
      line2: form.address2.trim() || undefined,
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      postal_code: form.postalCode.trim(),
      country: "US",
    },
  });

  const validate = () => {
    if (!settings.accepting_orders) {
      return "Checkout is temporarily paused. Your cart is saved; please try again later.";
    }
    if (!quote || secondsLeft <= 0 || quoteRefreshing) {
      return "Your price is refreshing. Review the new locked total before paying.";
    }
    if (
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !form.phone.trim()
    ) {
      return "Complete your name and phone number.";
    }
    if (!form.address1.trim() || !form.city.trim()) {
      return "Enter a complete insured-delivery address.";
    }
    if (!/^[A-Za-z]{2}$/.test(form.state.trim())) {
      return "Enter a two-letter US state code.";
    }
    if (!/^\d{5}(?:-\d{4})?$/.test(form.postalCode.trim())) {
      return "Enter a valid US ZIP code.";
    }
    if (!form.agree) {
      return "Agree to the Terms of Purchase and the displayed locked price before placing the order.";
    }
    if (
      form.paymentMethod === "card" &&
      !paymentConfig.embedded_card
    ) {
      return "The secure embedded card form is still being configured.";
    }
    return "";
  };

  const createOrder = async () => {
    if (orderInfo) return orderInfo;
    const { data, error: invokeError } =
      await supabase.functions.invoke("create-order", {
        body: {
          quote_id: quote.quote_id,
          cart: cartPayload,
          contact: {
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
            email: user.email,
            phone: form.phone.trim(),
          },
          shipping: {
            address_line_1: form.address1.trim(),
            address_line_2: form.address2.trim(),
            city: form.city.trim(),
            state: form.state.trim().toUpperCase(),
            postal_code: form.postalCode.trim(),
            country: "US",
          },
          payment_method: form.paymentMethod,
          notes: form.notes.trim(),
          terms: { accepted: true, version: "2026-08-04" },
        },
      });

    if (invokeError || data?.error) {
      throw new Error(
        data?.error || invokeError?.message || "Unable to place order.",
      );
    }

    setOrderInfo(data);
    saveCheckoutRecovery({
      orderId: data.order_id,
      orderNumber: data.order_number,
      priceLockedUntil: data.price_locked_until,
      paymentMethod: form.paymentMethod,
      items,
    });
    return data;
  };

  const saveAddress = async () => {
    if (!form.saveAddress) return;
    await supabase
      .from("profiles")
      .update({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        phone: form.phone.trim(),
        address_line_1: form.address1.trim(),
        address_line_2: form.address2.trim() || null,
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        postal_code: form.postalCode.trim(),
      })
      .eq("id", user.id);
    await refreshProfile();
  };

  const submit = async (event) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (secondsLeft <= 3) {
      await getFreshQuote({
        automatic: true,
        orderId: orderInfo?.order_id || null,
      });
      return;
    }

    setBusy(true);
    setError("");
    try {
      let confirmationTokenId = null;
      if (form.paymentMethod === "card") {
        if (!cardRef.current) {
          throw new Error("The secure card form is still loading.");
        }
        confirmationTokenId = await cardRef.current.createToken(
          shippingPayload(),
        );
      }

      let order = await createOrder();
      await saveAddress();

      if (form.paymentMethod === "card") {
        let payment;
        try {
          payment = await authenticatedPost(
            "/api/payments/confirm-card",
            {
              order_id: order.order_id,
              confirmation_token_id: confirmationTokenId,
            },
          );
        } catch (paymentError) {
          if (paymentError.code === "price_expired") {
            await getFreshQuote({
              automatic: true,
              orderId: order.order_id,
            });
            return;
          }
          throw paymentError;
        }

        let finalStatus = payment.status;
        if (
          payment.status === "requires_action" &&
          payment.client_secret
        ) {
          const intent = await cardRef.current.handleNextAction(
            payment.client_secret,
          );
          if (
            !intent ||
            !["succeeded", "processing"].includes(intent.status)
          ) {
            throw new Error("Card verification was not completed.");
          }
          finalStatus = intent.status;
        } else if (
          !["succeeded", "processing"].includes(payment.status)
        ) {
          throw new Error(
            "Your card was not charged. Check the card details or try another card.",
          );
        }

        if (finalStatus === "succeeded") clear();
        navigate(
          `/account?order=${encodeURIComponent(
            order.order_number,
          )}&tab=orders&payment=return`,
        );
        return;
      }

      if (form.paymentMethod === "wire" && orderInfo) {
        order = await authenticatedPost("/api/payments/change-method", {
          order_id: order.order_id,
          payment_method: "wire",
        });
        setOrderInfo((current) => ({
          ...current,
          ...order,
          price_locked_until:
            order.price_locked_until || current?.price_locked_until,
        }));
        saveCheckoutRecovery({
          orderId: order.order_id,
          orderNumber: order.order_number,
          priceLockedUntil:
            order.price_locked_until || quote?.expires_at || null,
          paymentMethod: "wire",
          items,
        });
      }

      let payment = {};
      if (paymentConfig.enabled) {
        payment = await authenticatedPost(
          "/api/payments/create-checkout",
          { order_id: order.order_id },
        );
      }
      if (payment.url) {
        window.location.assign(payment.url);
        return;
      }

      clearCheckoutRecovery(order.order_number);
      clear();
      const wireQuery =
        form.paymentMethod === "wire" ? "&wire=show" : "";
      navigate(
        `/account?order=${encodeURIComponent(
          order.order_number,
        )}&tab=orders${wireQuery}`,
        { state: { newOrder: order } },
      );
    } catch (submitError) {
      if (/expired/i.test(submitError.message || "")) {
        await getFreshQuote({
          automatic: true,
          orderId: orderInfo?.order_id || null,
        });
      } else {
        setError(
          submitError.message ||
            "Unable to place the order. Please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const elementsOptions = useMemo(
    () => ({
      mode: "payment",
      amount: Math.max(
        50,
        Math.round(Number(pricing.card_total || 0) * 100),
      ),
      currency: "usd",
      paymentMethodCreation: "manual",
      paymentMethodTypes: ["card"],
      appearance: {
        theme: "stripe",
        variables: {
          colorPrimary: "#0b3a5b",
          colorText: "#102c40",
          colorDanger: "#a32d36",
          borderRadius: "3px",
          fontFamily: "Arial, sans-serif",
        },
        rules: {
          ".Input": {
            border: "1px solid #bdc9d0",
            boxShadow: "none",
          },
          ".Input:focus": {
            border: "1px solid #0b3a5b",
            boxShadow: "0 0 0 2px rgba(11,58,91,.12)",
          },
        },
      },
    }),
    [pricing.card_total],
  );

  const timerClass = quoteRefreshing
    ? "refreshing"
    : secondsLeft <= 60
      ? "urgent"
      : "";

  return (
    <section className="section checkout-section">
      <div className="container checkout-grid embedded-checkout">
        <form className="checkout-form" onSubmit={submit} noValidate>
          <div className="checkout-title">
            <span className="eyebrow dark">SECURE CHECKOUT</span>
            <h1>Delivery and payment</h1>
            <p>
              Your 10-minute market-price lock began when this checkout
              opened.
            </p>
          </div>

          <div className={`mobile-price-lock ${timerClass}`}>
            <Clock3 />
            <span>
              <small>Price expires in</small>
              <strong>
                {quoteLoading
                  ? "--:--"
                  : quoteRefreshing
                    ? "Refreshing…"
                    : clock(secondsLeft)}
              </strong>
            </span>
          </div>

          <fieldset disabled={Boolean(orderInfo)}>
            <legend>1. Contact</legend>
            <div className="form-row">
              <label>
                First name
                <input
                  required
                  maxLength="60"
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(event) =>
                    setForm({ ...form, firstName: event.target.value })
                  }
                />
              </label>
              <label>
                Last name
                <input
                  required
                  maxLength="60"
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(event) =>
                    setForm({ ...form, lastName: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Verified email
                <input disabled value={user.email} />
              </label>
              <label>
                Phone
                <input
                  required
                  type="tel"
                  maxLength="30"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset disabled={Boolean(orderInfo)}>
            <legend>2. Insured shipping address</legend>
            <label>
              Street address
              <input
                required
                maxLength="160"
                autoComplete="address-line1"
                value={form.address1}
                onChange={(event) =>
                  setForm({ ...form, address1: event.target.value })
                }
              />
            </label>
            <label>
              Apartment, suite, etc. <span>(optional)</span>
              <input
                maxLength="100"
                autoComplete="address-line2"
                value={form.address2}
                onChange={(event) =>
                  setForm({ ...form, address2: event.target.value })
                }
              />
            </label>
            <div className="form-row three">
              <label>
                City
                <input
                  required
                  maxLength="80"
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(event) =>
                    setForm({ ...form, city: event.target.value })
                  }
                />
              </label>
              <label>
                State
                <input
                  required
                  maxLength="2"
                  autoComplete="address-level1"
                  placeholder="NY"
                  value={form.state}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      state: event.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <label>
                ZIP code
                <input
                  required
                  maxLength="10"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={form.postalCode}
                  onChange={(event) =>
                    setForm({ ...form, postalCode: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="checkout-check">
              <input
                type="checkbox"
                checked={form.saveAddress}
                onChange={(event) =>
                  setForm({ ...form, saveAddress: event.target.checked })
                }
              />
              Save this as my default delivery address
            </label>
          </fieldset>

          <fieldset>
            <legend>3. Payment information</legend>
            <div className="payment-options">
              <PaymentOption
                value="card"
                form={form}
                setForm={setForm}
                disabled={!paymentConfig.embedded_card}
                title="Credit or debit card"
                detail={
                  paymentConfig.embedded_card
                    ? `Secure card entry on GoldOnTheSpot • ${settings.card_surcharge_percent}% processing surcharge`
                    : "Embedded card entry needs the Stripe publishable key"
                }
              />
              <PaymentOption
                value="wire"
                form={form}
                setForm={setForm}
                disabled={!paymentConfig.wire}
                title="Bank wire"
                detail="Encrypted instructions by email and in your order • no surcharge"
              />
              <PaymentOption
                value="crypto"
                form={form}
                setForm={setForm}
                disabled={!paymentConfig.crypto || Boolean(orderInfo)}
                title="Crypto"
                detail="Choose a supported cryptocurrency on secure hosted checkout • automatic confirmation"
              />
            </div>

            {orderInfo && (
              <div className="form-message">
                This unpaid order is saved. You can finish by card or switch to
                bank wire; the card surcharge is removed before wire
                instructions are issued.
              </div>
            )}

            {form.paymentMethod === "card" &&
              paymentConfig.embedded_card &&
              pricing.card_total > 0 && (
                <div className="embedded-card-box">
                  <div className="embedded-card-heading">
                    <CreditCard />
                    <span>
                      <b>Card details</b>
                      <small>
                        Encrypted and sent directly to Stripe.
                        GoldOnTheSpot never sees or stores the card number.
                      </small>
                    </span>
                  </div>
                  <Elements
                    stripe={stripeClient(
                      paymentConfig.stripe_publishable_key,
                    )}
                    options={elementsOptions}
                  >
                    <CardFields
                      ref={cardRef}
                      amount={elementsOptions.amount}
                      email={user.email}
                    />
                  </Elements>
                  <div className="card-security-note">
                    <ShieldCheck />
                    Secure Stripe fields • billing address is checked by
                    the card issuer
                  </div>
                </div>
              )}
          </fieldset>

          <label>
            Order notes <span>(optional)</span>
            <textarea
              rows="3"
              maxLength="1000"
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              placeholder="Delivery or product notes"
            />
          </label>

          <label className="checkout-check terms-check">
            <input
              type="checkbox"
              checked={form.agree}
              onChange={(event) =>
                setForm({ ...form, agree: event.target.checked })
              }
            />
            I agree to the <Link to="/terms">Terms of Purchase</Link>. I
            understand this bullion order is a binding purchase obligation
            at the currently displayed locked total of{" "}
            <b>{money(displayedTotal)}</b>, subject to GoldOnTheSpot
            acceptance and the stated payment deadline.
          </label>

          {priceNotice && (
            <div className="form-message price-refresh-message">
              <RefreshCw />
              {priceNotice}
            </div>
          )}
          {!settings.accepting_orders && (
            <div className="form-message error">
              Checkout is temporarily paused. Your cart will stay saved.
            </div>
          )}
          {error && <div className="form-message error">{error}</div>}

          <button
            className="button button-gold full large"
            disabled={
              busy ||
              quoteLoading ||
              quoteRefreshing ||
              !quote ||
              displayedTotal <= 0 ||
              !cartReady ||
              !settings.accepting_orders
            }
          >
            {busy
              ? "Processing securely…"
              : quoteRefreshing
                ? "Refreshing market price…"
                : quoteLoading
                  ? "Locking your price…"
                  : form.paymentMethod === "card"
                    ? `Pay ${money(displayedTotal)} securely`
                    : "Agree & place secure order"}
          </button>
          <p className="secure-submit">
            <LockKeyhole />
            The server verifies the current lock and exact amount before
            any payment is created.
          </p>
        </form>

        <aside className="checkout-summary locked-order-summary">
          <div className={`desktop-price-lock ${timerClass}`}>
            <LockKeyhole />
            <span>
              <small>Price expires in</small>
              <strong>
                {quoteLoading
                  ? "--:--"
                  : quoteRefreshing
                    ? "Refreshing…"
                    : clock(secondsLeft)}
              </strong>
            </span>
          </div>

          <div className="summary-heading">
            <span>
              <h2>Order summary</h2>
              <small>
                {estimatedUnits} item{estimatedUnits === 1 ? "" : "s"}
              </small>
            </span>
            <Link to="/cart">Edit cart</Link>
          </div>

          {displayItems.map((item) => (
            <div className="checkout-item" key={item.product_id}>
              <div
                className={`cart-thumb small ${
                  item.image_url ? "has-image" : item.metal || "gold"
                }`}
              >
                {item.image_url ? (
                  <img
                    src={productImageUrl(item.image_url, 140, 78)}
                    alt={item.product_name}
                    width="140"
                    height="140"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  metalSymbol(item.metal || "gold")
                )}
              </div>
              <span>
                <b>{item.product_name}</b>
                <small>
                  {item.quantity} ×{" "}
                  {item.unit_price == null
                    ? "—"
                    : money(item.unit_price)}
                </small>
              </span>
              <strong>
                {item.line_total == null ? "—" : money(item.line_total)}
              </strong>
            </div>
          ))}

          <div className="checkout-totals">
            <div>
              <span>Locked items</span>
              <b>{money(pricing.subtotal || 0)}</b>
            </div>
            <div>
              <span>Insured shipping</span>
              <b>
                {Number(pricing.shipping || 0)
                  ? money(pricing.shipping)
                  : "Free"}
              </b>
            </div>
            {form.paymentMethod === "card" &&
              Number(pricing.card_surcharge || 0) > 0 && (
                <div>
                  <span>Card processing</span>
                  <b>{money(pricing.card_surcharge)}</b>
                </div>
              )}
            <div className="checkout-total">
              <span>Total</span>
              <strong>{money(displayedTotal)}</strong>
            </div>
          </div>

          <div className="checkout-notice">
            <CheckCircle2 />
            <span>
              <b>10-minute live price protection</b>
              <small>
                At expiration, current metal prices are recalculated and a
                new 10-minute lock starts. You must accept any refreshed
                total before payment.
              </small>
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PaymentOption({
  value,
  form,
  setForm,
  title,
  detail,
  disabled = false,
}) {
  return (
    <label
      className={`${form.paymentMethod === value ? "selected" : ""} ${
        disabled ? "disabled" : ""
      }`}
    >
      <input
        disabled={disabled}
        type="radio"
        name="payment"
        value={value}
        checked={form.paymentMethod === value}
        onChange={(event) =>
          setForm({
            ...form,
            paymentMethod: event.target.value,
            agree: false,
          })
        }
      />
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
    </label>
  );
}

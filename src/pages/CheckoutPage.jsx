import {belowOrderMinimum, businessDay} from '../../shared/bullionMinimums.js';
import {officeAddress} from '../../shared/business.js';

import {cardLimitMessage,CARD_CHARGE_MAXIMUM} from "../../shared/cardLimits.js";
import {WIRE_AGREEMENT_TEXT, WIRE_AGREEMENT_VERSION} from "../../supabase/functions/_shared/wireAgreement.js";
import { TERMS_VERSION } from '../lib/legalPolicies';
import '../styles/legalPolicies.css';
import '../styles/checkoutPromo.css';
import {invokeFunction} from "../lib/functionRequest.js";
import {estimateShipping} from "../lib/shipping";
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
  ach_order_maximum: 25000,
  accepting_orders: true,
  card_order_maximum: CARD_CHARGE_MAXIMUM,
  wire_order_maximum: 100000,
  crypto_order_maximum: 2000000,
};

const stripeClients = new Map();

const stripeClient = (key) => {
  if (!key) return null;
  if (!stripeClients.has(key)) stripeClients.set(key, loadStripe(key));
  return stripeClients.get(key);
};

const displayDeadline = (expires, serverTime, now = Date.now()) => {
  const remaining = Date.parse(expires) - (Number.isFinite(serverTime) ? serverTime : now);
  return now + (Number.isFinite(remaining) ? Math.max(0, Math.min(600000, remaining)) : 0);
};
const secondsUntil = (deadline, now = Date.now()) =>
  Math.max(0, Math.min(600, Math.ceil((deadline - now) / 1000)));

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
          throw new Error("The secure payment form is still loading.");

        const { error: submitError } = await elements.submit();
        if (submitError)
          throw new Error(submitError.message || "Check your payment details.");

        const { error, confirmationToken } =
          await stripe.createConfirmationToken({
            elements,
            params: shipping ? {shipping} : {},
          });
        if (error || !confirmationToken) {
          throw new Error(error?.message || "Check your payment details.");
        }
        return confirmationToken.id;
      },
      async handleNextAction(clientSecret) {
        if (!stripe)
          throw new Error("The secure payment form is still loading.");
        const { error, paymentIntent } = await stripe.handleNextAction({
          clientSecret,
        });
        if (error) {
          throw new Error(
            error.message || "Bank verification was not completed.",
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
        wallets: { link: "never" },
        defaultValues: { billingDetails: { email } },
      }}
    />
  );
});

function FulfillmentChoice({pickup=false}) {
  return <nav className="fulfillment-choice" aria-label="Delivery or pickup">
    <strong>How would you like to receive your items?</strong>
    <div>{[[false,'Delivery','Ship to your address'],[true,'Pickup','Madison Avenue office · By appointment']].map(([value,label,hint])=><Link key={label} to={value?'/checkout?fulfillment=pickup':'/checkout'} aria-current={pickup===value?'page':undefined}><b>{label}</b><small>{hint}</small></Link>)}</div>
    <p><b>Pickup address:</b> {officeAddress.join(', ')}</p>
  </nav>;
}
export default function CheckoutPage() {
  return <ShippingCheckout/>;
}
function ShippingCheckout() {
  const { items, clear, reconcileProducts, deliveryDraft = {} } = useCart();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeOrderId = Number(searchParams.get("resume_order"));
  const [recipient,setRecipient]=useState('');
  const cardRef = useRef(null);
  const [promoDraft,setPromoDraft]=useState('');
  const promoRef=useRef('');
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
    address1: deliveryDraft.address1 || profile?.address_line_1 || "",
    address2: deliveryDraft.address2 || profile?.address_line_2 || "",
    city: deliveryDraft.city || profile?.city || "",
    state: deliveryDraft.state || profile?.state || "",
    postalCode: deliveryDraft.postalCode || profile?.postal_code || "",
    paymentMethod: "card",
    notes: "",
    saveAddress: true,
    agree: false, wireAgree: false,
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
          "card_order_maximum",
          "wire_order_maximum",
          "crypto_order_maximum",
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
    async ({ automatic = false, orderId = null, promo = promoRef.current, revisePromo = false } = {}) => {
      if (quoteRequestRef.current) return null;
      quoteRequestRef.current = true;
      if (automatic) setQuoteRefreshing(true);
      else setQuoteLoading(true);
      setError("");

      try {
        const previousTotal = Number(quoteRef.current?.card_total || 0);
        const next = await authenticatedPost(
          "/api/checkout/quote",
          revisePromo ? { quote_id: quoteRef.current?.quote_id || null, promo_code: promo } : orderId ? { order_id: orderId } : { cart: cartPayload, ...(promo?{promo_code:promo}:{}) },
        );

        promoRef.current=next.promo_code||'';
        const deadline = displayDeadline(next.expires_at, next.server_time_ms);
        next.displayDeadline = quoteRef.current?.expires_at === next.expires_at
          ? Math.min(deadline, quoteRef.current.displayDeadline) : deadline;
        quoteRef.current = next;
        setQuote(next);
        setSecondsLeft(secondsUntil(next.displayDeadline));

        if (automatic) {
          setForm((currentForm) => ({ ...currentForm, agree: false, wireAgree: false }));
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
        total: next.card_total, tax_amount: next.tax_amount,
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
        agree: false, wireAgree: false,
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
    if (!quote?.displayDeadline) return undefined;
    const tick = () => setSecondsLeft(secondsUntil(quote.displayDeadline));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [quote?.displayDeadline]);

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
      estimateShipping(items,subtotal,settings);
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

  const pickup=orderInfo ? (orderInfo.fulfillment==='pickup'||quote?.shipping_address?.fulfillment==='pickup') : !resumeOrderId && searchParams.get('fulfillment')==='pickup';
  useEffect(()=>{setForm(v=>({...v,agree:false,wireAgree:false}))},[pickup]);
  const basePricing=quote || fallbackEstimate;
  const pricing=pickup ? {...basePricing,shipping:0,wire_total:Number(basePricing.subtotal),card_total:Math.round((Number(basePricing.subtotal)+Number(basePricing.card_surcharge))*100)/100}:basePricing;
  const wireTotal = Number.isFinite(Number(pricing.wire_total))
    ? Number(pricing.wire_total)
    : Number(pricing.subtotal || 0) + Number(pricing.shipping || 0);
  const achFee = Math.round(Number(pricing.subtotal || 0) * 2) / 100;
  const achTotal = Math.round((wireTotal + achFee) * 100) / 100;
  const [investment,setInvestment] = useState(true);
  const [assessment,setAssessment] = useState(null);
  const needsTax = !orderInfo && !resumeOrderId;
  const destinationState = pickup ? 'NY' : form.state?.trim().toUpperCase();
  const addressEntered = pickup || Boolean(form.address1.trim() && form.city.trim() && /^[A-Z]{2}$/.test(destinationState) && /^\d{5}(-\d{4})?$/.test(form.postalCode.trim()));
  const earlyMinimum = needsTax && addressEntered && quote ? belowOrderMinimum(destinationState, Math.round(Number(quote.subtotal) * 100), businessDay()) : '';
  const taxRequest = JSON.stringify({quote_id:quote?.quote_id,method:form.paymentMethod,fulfillment:pickup?'pickup':'delivery',investment,
    address:pickup?undefined:{address_line_1:form.address1,address_line_2:form.address2,city:form.city,state:form.state,postal_code:form.postalCode,country:'US'}});
  useEffect(()=>{setForm(f=>f.agree || f.wireAgree ? {...f,agree:false,wireAgree:false}:f);},[taxRequest]);
  const taxReady = needsTax && assessment?.key===taxRequest && assessment?.data?.id;
  const taxMessage=assessment?.key===taxRequest?assessment.message:null;
  const minimumNotice = earlyMinimum || (assessment?.key===taxRequest && assessment.code==='ORDER_MINIMUM' ? taxMessage : '');
  const investmentAgreement = taxReady && destinationState==='NY' && investment && assessment.data.exempt>0;
  useEffect(()=>{
    if(!needsTax || !quote?.quote_id || !addressEntered || earlyMinimum) return;
    let active=true;
    const timer=setTimeout(async()=>{
      try {
        const data=await authenticatedPost('/api/checkout/tax',JSON.parse(taxRequest));
        if(active)setAssessment({key:taxRequest,data});
      } catch(e) { if(active)setAssessment({key:taxRequest,message:e.message,code:e.code}); }
    },350);
    return ()=>{active=false;clearTimeout(timer);};
  },[taxRequest,needsTax,addressEntered,earlyMinimum,quote?.quote_id,authenticatedPost]);
  const displayedTotal = orderInfo?.total != null ? Number(orderInfo.total) : taxReady ? assessment.data.total / 100 :
    form.paymentMethod === "card"
      ? Number(pricing.card_total || 0)
      : form.paymentMethod === "ach" ? achTotal : wireTotal;

  const cardLimitError = cardLimitMessage(pricing.subtotal,form.paymentMethod==="card" && taxReady ? displayedTotal : pricing.card_total,settings.card_order_maximum);
  useEffect(()=>{
    if(cardLimitError && paymentConfig.wire && !busy) setForm(current=>current.paymentMethod==="card"?{...current,paymentMethod:"wire",agree:false,wireAgree:false}:current);
  },[cardLimitError,paymentConfig.wire,busy,form.paymentMethod]);

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
    if(form.paymentMethod==="card" && cardLimitError)return cardLimitError;
    if(form.paymentMethod==="ach" && (!paymentConfig.ach || achTotal > 25000)) return "ACH is unavailable or the total exceeds $25,000 including fees.";
    if (!orderInfo && displayedTotal > settings[`${form.paymentMethod}_order_maximum`]) {
      return `The ${form.paymentMethod} payment maximum is ${money(settings[`${form.paymentMethod}_order_maximum`])}. Choose another payment method or reduce your order.`;
    }
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
    if (!pickup && (!form.address1.trim() || !form.city.trim())) {
      return "Enter a complete insured-delivery address.";
    }
    if (!pickup && !/^[A-Za-z]{2}$/.test(form.state.trim())) {
      return "Enter a two-letter US state code.";
    }
    if (!pickup && !/^\d{5}(?:-\d{4})?$/.test(form.postalCode.trim())) {
      return "Enter a valid US ZIP code.";
    }
    if (minimumNotice) return minimumNotice;
    if (needsTax && !taxReady) return 'We couldn’t confirm the order total for this address. Check the address and try again.';
    if (form.paymentMethod === "wire" && !form.wireAgree) return "Read and accept the bank-wire purchase agreement.";
    if (!orderInfo && promoDraft.trim().toUpperCase()!==(quote?.promo_code||'')) return 'Apply or clear your promo code before placing the order.';
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
    const data = await invokeFunction(supabase, "create-order", {
          quote_id: quote.quote_id,
          tax_assessment_id: assessment?.data?.id,
          ...(pickup?{fulfillment:"pickup",pickup_name:recipient.trim()||[form.firstName.trim(),form.lastName.trim()].join(" ")}:{}),
          cart: cartPayload,
          contact: {
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
            email: user.email,
            phone: form.phone.trim(),
          },
          shipping: pickup?{}:{
            address_line_1: form.address1.trim(),
            address_line_2: form.address2.trim(),
            city: form.city.trim(),
            state: form.state.trim().toUpperCase(),
            postal_code: form.postalCode.trim(),
            country: "US",
          },
          payment_method: form.paymentMethod,
          notes: form.notes.trim(),
          terms: { accepted: true, version: TERMS_VERSION, ...(investmentAgreement ? {investment_purchase:true} : {}) },
          ...(form.paymentMethod === "wire" ? {wire_agreement: {accepted: form.wireAgree, version: WIRE_AGREEMENT_VERSION}} : {}),
      });

    setOrderInfo({...data,fulfillment:pickup?"pickup":"delivery"});
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
    if (pickup || !form.saveAddress) return;
    await supabase
      .from("profiles")
      .update({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        // Contact phone on this order must not revoke the verified sign-in phone.
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
      if (["card", "ach"].includes(form.paymentMethod)) {
        if (!cardRef.current) {
          throw new Error("The secure payment form is still loading.");
        }
        confirmationTokenId = await cardRef.current.createToken(
          pickup ? undefined : shippingPayload(),
        );
      }

      let order = await createOrder();
      // Saving optional profile preferences must never hide a placed order.
      await saveAddress().catch(() => {});
      const convertingCardToWire = form.paymentMethod === "wire" && order.payment_method === "card";
      if (order.payment_method && order.payment_method !== form.paymentMethod && !convertingCardToWire) {
        navigate(`/account?tab=orders&order=${encodeURIComponent(order.order_number)}${order.payment_method === "wire" ? "&wire=show" : ""}`);
        return;
      }

      if (["card", "ach"].includes(form.paymentMethod)) {
        let payment;
        try {
          payment = await authenticatedPost(
            form.paymentMethod === "ach" ? "/api/payments/confirm-ach" : "/api/payments/confirm-card",
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
            !["succeeded", "processing", "requires_capture"].includes(intent.status)
          ) {
            throw new Error("Bank verification was not completed.");
          }
          finalStatus = intent.status;
          if(intent.status==='requires_capture') {
            const completion=await authenticatedPost('/api/payments/complete-card',{order_id:order.order_id});
            if(completion.expired) {
              setError('The price lock expired during bank verification. The card authorization was released. Refresh your quote before trying again.');
              return;
            }
            if(!['succeeded','processing'].includes(completion.status))throw new Error('Payment is still being confirmed. Check your order before trying again.');
            finalStatus=completion.status;
          }
        } else if (
          !["succeeded", "processing"].includes(payment.status)
        ) {
          throw new Error(
            "Payment was not completed. Check your order before trying again.",
          );
        }

        if (finalStatus === "succeeded" || (form.paymentMethod === "ach" && finalStatus === "processing")) clear();
        navigate(
          `/account?order=${encodeURIComponent(
            order.order_number,
          )}&tab=orders&payment=return`,
        );
        return;
      }

      if (form.paymentMethod === "wire" && (orderInfo || convertingCardToWire)) {
        order = await authenticatedPost("/api/payments/change-method", {
          order_id: order.order_id,
          payment_method: "wire",
          wire_agreement: {accepted: form.wireAgree, version: WIRE_AGREEMENT_VERSION},
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
      if (paymentConfig.enabled && form.paymentMethod !== "wire") {
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
        Math.round(Number(displayedTotal || 0) * 100),
      ),
      currency: "usd",
      paymentMethodCreation: "manual",
      paymentMethodTypes: [form.paymentMethod === "ach" ? "us_bank_account" : "card"],
      ...(form.paymentMethod === "ach" ? {paymentMethodOptions:{us_bank_account:{verification_method:"instant"}}} : {}),
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
    [displayedTotal, form.paymentMethod],
  );

  if (
    !items.length &&
    !orderInfo &&
    !(Number.isSafeInteger(resumeOrderId) && resumeOrderId > 0)
  ) {
    return <Navigate to="/cart" replace />;
  }

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
            <h1>Checkout</h1>
            {!orderInfo && !busy && !resumeOrderId && <FulfillmentChoice pickup={pickup}/>}
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

          <p className="checkout-policy-notice">Bullion purchases are market transactions. No change-of-mind returns after acceptance; rights for incorrect, damaged, or undelivered goods remain. Read our <Link to="/terms#cancellations-returns-and-refunds" target="_blank" rel="noopener">cancellation & refund policy</Link> and <Link to="/shipping" target="_blank" rel="noopener">shipping policy</Link> before entering payment details.</p>
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

          {pickup?<fieldset disabled={Boolean(orderInfo)}><legend>2. Free office pickup</legend><address>{officeAddress.join(', ')}</address><p>Pay below. We’ll call and email when your items are ready. Please wait for a confirmed pickup time.</p><label>Pickup name, if different from the buyer<input maxLength={120} value={recipient} onChange={e=>setRecipient(e.target.value)}/></label><small>Bring photo ID matching the pickup name.</small></fieldset>:<fieldset disabled={Boolean(orderInfo)}>
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
          </fieldset>}

          {minimumNotice && <p role="status" className="form-message">{minimumNotice}</p>}
          {!orderInfo && <fieldset className="checkout-promo-box" disabled={busy || quoteLoading || quoteRefreshing} aria-labelledby="promo-label">
            <label id="promo-label" htmlFor="checkout-promo">Promo code <small>Optional</small></label>
            <div className="promo-entry">
            <input placeholder="Enter code" id="checkout-promo" maxLength={32} autoCapitalize="characters" spellCheck={false} value={promoDraft}
              onChange={e=>setPromoDraft(e.target.value.toUpperCase())}
              onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('apply-promo')?.click()}}}/>
            <button id="apply-promo" type="button" className="button button-outline" disabled={!promoDraft.trim()} onClick={async()=>{setForm(f=>({...f,agree:false,wireAgree:false}));await getFreshQuote({revisePromo:true,promo:promoDraft.trim()})}}>Apply</button></div>
            {(promoDraft || quote?.promo_code) && <button className="text-button" type="button" onClick={async()=>{setForm(f=>({...f,agree:false,wireAgree:false}));if(await getFreshQuote({revisePromo:true,promo:''}))setPromoDraft('')}}>Remove</button>}
            {quote?.promo_code && <p role="status">{quote.promo_code} applied · {money(quote.discount_amount)} off</p>}
          </fieldset>}

          <fieldset>
            <legend>3. Payment information</legend>
            <div className="payment-options">
              <PaymentOption
                value="card"
                form={form}
                setForm={setForm}
                disabled={!paymentConfig.embedded_card || Boolean(cardLimitError)}
                title="Credit or debit card"
                detail={
                  cardLimitError || (paymentConfig.embedded_card
                    ? `Secure card entry • ${settings.card_surcharge_percent}% processing surcharge • Up to $10,000 in merchandise`
                    : "Embedded card entry needs the Stripe publishable key")
                }
              />
              <PaymentOption value="ach" form={form} setForm={setForm}
                disabled={!paymentConfig.ach || achTotal > 25000 || Boolean(orderInfo)}
                title="ACH bank payment"
                detail="2% fee on merchandise • Maximum $25,000 including fee • Payment confirmation takes 4–5 business days" />
              <PaymentOption
                value="wire"
                form={form}
                setForm={setForm}
                disabled={!paymentConfig.wire}
                title="Bank wire"
                detail={`Encrypted instructions • no surcharge • Maximum ${money(settings.wire_order_maximum)}`}
              />
              <PaymentOption
                value="crypto"
                form={form}
                setForm={setForm}
                disabled={!paymentConfig.crypto || Boolean(orderInfo)}
                title="Crypto"
                detail={`Secure hosted checkout • Maximum ${money(settings.crypto_order_maximum)}`}
              />
            </div>

            {orderInfo && (
              <div className="form-message">
                This unpaid order is saved. You can finish by card or switch to
                bank wire; the card surcharge is removed before wire
                instructions are issued.
              </div>
            )}

            {((form.paymentMethod === "card" && paymentConfig.embedded_card && !cardLimitError) || (form.paymentMethod === "ach" && paymentConfig.ach && achTotal <= 25000)) &&
              displayedTotal > 0 && (
                <div className="embedded-card-box">
                  <div className="embedded-card-heading">
                    <CreditCard />
                    <span>
                      <b>{form.paymentMethod === "ach" ? "Bank account details" : "Card details"}</b>
                      <small>
                        Encrypted and sent directly to Stripe.
                        GoldOnTheSpot never sees or stores your full payment account number.
                      </small>
                    </span>
                  </div>
                  <Elements key={form.paymentMethod}
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

          <details><summary>Order notes and options <span>(optional)</span></summary>
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

            {needsTax && destinationState==='NY' && taxReady && (investmentAgreement || !investment) &&
              <label className="checkout-check"><input type="checkbox" checked={investment} onChange={event=>setInvestment(event.target.checked)}/> Buying to hold for investment</label>}
          </details>

          {form.paymentMethod === "wire" && <section className="wire-agreement" aria-labelledby="wire-agreement-heading">
            <h3 id="wire-agreement-heading">Bank-wire purchase agreement</h3>
            <p>{WIRE_AGREEMENT_TEXT}</p>
            <label className="checkout-check"><input type="checkbox" checked={Boolean(form.wireAgree)} onChange={event => setForm({...form, wireAgree:event.target.checked})} />
              <span>I have read and agree to this bank-wire agreement, including responsibility for documented market loss if I cancel or do not pay. Wire total: <b>{money(displayedTotal)}</b>.</span>
            </label>
            <small>Bank details and your payment deadline appear after placing the order. A copy is sent to your verified email.</small>
          </section>}
          <label className="checkout-check terms-check">
            <input
              type="checkbox"
              checked={form.agree}
              disabled={Boolean(needsTax && !taxReady)}
              onChange={(event) =>
                setForm({ ...form, agree: event.target.checked })
              }
            />
            <span>I agree to the <Link to={`/terms?version=${TERMS_VERSION}`} target="_blank" rel="noopener">Terms of Purchase</Link>. I
            understand this bullion order is a binding purchase obligation
            at the currently displayed locked total of{" "}
            <b>{money(displayedTotal)}</b>, subject to GoldOnTheSpot
            acceptance and the stated payment deadline.{investmentAgreement && ' I confirm that I am buying the qualifying bullion as an investment and will hold it in its purchased form.'}</span>
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
              Boolean(minimumNotice) ||
              !cartReady ||
              !settings.accepting_orders ||
              (form.paymentMethod === "card" && Boolean(cardLimitError))
            }
          >
            {busy
              ? "Processing securely…"
              : quoteRefreshing
                ? "Refreshing market price…"
                : quoteLoading
                  ? "Locking your price…"
                  : needsTax && !taxReady ? "Review order" : form.paymentMethod === "card"
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
            {pricing.discount_amount>0&&<div><span>Promo · {pricing.promo_code}</span><b>−{money(pricing.discount_amount)}</b></div>}
            <div>
              <span>{pricing.discount_amount?'Items after discount':'Locked items'}</span>
              <b>{money(pricing.subtotal || 0)}</b>
            </div>
            <div>
              <span>{pickup?'Office pickup':'Insured shipping'}</span>
              <b>
                {Number(pricing.shipping || 0)
                  ? money(pricing.shipping)
                  : "Free"}
              </b>
            </div>
            {form.paymentMethod === "ach" && <div><span>ACH fee (2%)</span><b>{money(achFee)}</b></div>}
            {form.paymentMethod === "card" &&
              Number(pricing.card_surcharge || 0) > 0 && (
                <div>
                  <span>Card processing</span>
                  <b>{money(pricing.card_surcharge)}</b>
                </div>
              )}
            {taxReady && assessment.data.tax > 0 && <div><span>Tax</span><b>{money(assessment.data.tax/100)}</b></div>}
            {!needsTax && Number(orderInfo?.tax_amount ?? quote?.tax_amount)>0 && <div><span>Tax</span><b>{money(orderInfo?.tax_amount ?? quote.tax_amount)}</b></div>}
            <div className="checkout-total">
              <span>{needsTax && !taxReady ? "Estimated total" : "Total"}</span>
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
            agree: false, wireAgree: false,
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

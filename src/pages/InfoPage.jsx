import { useEffect } from 'react';
import { Link, useLocation } from "react-router-dom";
import { legalPolicies, POLICY_DATE, TERMS_VERSION } from '../lib/legalPolicies';
import { legacyTerms } from '../lib/legacyTerms';
import PrivacyChoices from '../components/PrivacyChoices';
import '../styles/legalPolicies.css';

const pages = {
  about: { kicker: "A MODERN BULLION DESK", title: "Precious metals, without the mystery.", lead: "GoldOnTheSpot is built around live market pricing, secure ordering, and responsive support.", sections: [["Live market pricing", "Eligible product prices refresh with current metal markets. The secure checkout recalculates the total before accepting the order."], ["Careful fulfillment", "Inventory is reserved when an order is placed. Payment is reviewed before fulfillment, and precious-metal shipments require the appropriate insurance and signature service."], ["Support for serious purchases", "Whether you are buying one coin or discussing a larger order, our team can help with product selection, payment timing, and fulfillment questions."]] },
  shipping: { kicker: "FULFILLMENT", title: "Shipping and insurance", lead: "Bullion requires more care than an ordinary package. Our fulfillment rules are designed around value, verification, and safe delivery.", sections: [["Insured shipment", "Orders are shipped using a service appropriate for the declared value. Insurance coverage and carrier rules are confirmed before release."], ["Signature required", "An adult signature may be required. High-value orders cannot be left unattended, redirected casually, or shipped to an unverified address."], ["Processing time", "Orders ship after cleared payment and final review. We follow the shipment timeframe disclosed for your order; if we cannot meet it, we will provide the required delay notice and cancellation/refund option. A tracking number may be created before carrier pickup. Contact support for a missing, damaged, or incorrect delivery and preserve the packaging. See the Terms of Purchase for the full cancellation, return, and refund policy."]] },
};

export default function InfoPage({ type }) {
  const location = useLocation();
  const archived = type === 'terms' && new URLSearchParams(location.search).get('version') === '2026-10-22';
  const page = archived ? legacyTerms : legalPolicies[type] || pages[type] || pages.about;
  const legal = Boolean(legalPolicies[type]);
  const sectionId = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  useEffect(() => {
    if (!location.hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [location.hash, type]);
  return <>
    <section className="info-hero"><div className="container"><span className="eyebrow">{page.kicker}</span><h1>{page.title}</h1><p>{page.lead}</p>{legal && <p className="policy-meta">Effective {POLICY_DATE}{type === 'terms' && ` · Version ${archived ? '2026-10-22' : TERMS_VERSION}`}</p>}</div></section>
    <section className="section"><div className={`container prose-layout${legal ? ' policy-layout' : ''}`}>
      <aside><b>GoldOnTheSpot</b><span>Precious metals, priced right.</span><Link to="/terms">Terms of purchase</Link><Link to="/privacy">Privacy & choices</Link><Link to="/shipping">Shipping & insurance</Link><Link to="/support">Customer support →</Link>{legal && <button className="policy-print" type="button" onClick={() => window.print()}>Print / save a copy</button>}</aside>
      <article>
        {archived && <p className="legal-note">Archived agreement for earlier orders. <Link to="/terms">View current terms.</Link></p>}
        {legal && <nav className="policy-contents" aria-label="On this page"><b>On this page</b>{page.sections.map(([title]) => <a href={`#${sectionId(title)}`} key={title}>{title}</a>)}</nav>}
        {page.sections.map(([title, body]) => <section key={title} id={sectionId(title)}><h2>{title}</h2><p>{body}</p></section>)}
        {type === 'privacy' && <PrivacyChoices />}
        {type === 'terms' && !archived && <p><Link to="/terms?version=2026-10-22">Earlier terms: October 22, 2026 (original version)</Link></p>}
        <div className="legal-note">Questions about this page? <Link to="/support">Open the customer support center</Link> or email <a href="mailto:support@goldonthespot.com">support@goldonthespot.com</a>.</div>
      </article>
    </div></section>
  </>;
}

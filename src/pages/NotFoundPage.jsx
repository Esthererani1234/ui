import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return <section className="section not-found-page"><div className="container"><span className="eyebrow dark">PAGE NOT FOUND</span><h1>That page is not here.</h1><p>The address may have changed, or the product may no longer be available.</p><div><Link className="button button-dark" to="/shop">Shop bullion</Link><Link className="button button-outline" to="/support">Get help</Link></div></div></section>;
}

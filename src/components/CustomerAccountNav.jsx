import { Link } from "react-router-dom";
import { Headphones, Package, ShieldCheck, UserRound } from "lucide-react";
import "../styles/customerNavigation.css";

const links = [
  ["orders", "/account?tab=orders", Package, "Orders"],
  ["profile", "/account?tab=profile", UserRound, "Profile"],
  ["security", "/account?tab=security", ShieldCheck, "Security"],
  ["support", "/support", Headphones, "Support tickets"],
];

export default function CustomerAccountNav({ active = "orders" }) {
  return <nav className="customer-account-navigation" aria-label="Your account">
    {links.map(([id, to, Icon, label]) => <Link key={id} to={to} aria-current={active === id ? "page" : undefined}>
      <Icon size={19} aria-hidden="true" /><span>{label}</span>
    </Link>)}
  </nav>;
}

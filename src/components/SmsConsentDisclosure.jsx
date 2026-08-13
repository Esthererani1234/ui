import { Link } from "react-router-dom";

export default function SmsConsentDisclosure() {
  return (
    <div className="sms-consent-disclosure" role="note">
      <p>
        By providing your phone number and clicking “Send Code,” you consent to
        receive automated SMS messages from Gold on the Spot for account
        verification and security purposes. Message and data rates may apply.
        Message frequency varies. Reply STOP to opt out and HELP for help.
        Consent is not a condition of purchase.
      </p>
      <div className="sms-consent-links" aria-label="SMS consent policies">
        <Link to="/terms">Terms &amp; Conditions</Link>
        <span aria-hidden="true">•</span>
        <Link to="/privacy">Privacy Policy</Link>
      </div>
    </div>
  );
}

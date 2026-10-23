import { useState } from 'react';
import { analyticsOptedOut, setAnalyticsOptOut } from '../lib/analytics';

export default function PrivacyChoices() {
  const [disabled, setDisabled] = useState(analyticsOptedOut);
  const [message, setMessage] = useState('');
  const browserOptOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  return <section className="privacy-choices" aria-labelledby="privacy-choices-title">
    <h2 id="privacy-choices-title">Your analytics choice</h2>
    <p>Optional site analytics is {disabled || browserOptOut ? 'off' : 'on'} for this browser. Account security, your cart, and payments continue to work.</p>
    {browserOptOut ? <p>Your browser’s privacy signal is disabling optional analytics.</p> : <button type="button" className="button button-outline" onClick={() => {
      const next = !disabled;
      if (setAnalyticsOptOut(next)) { setDisabled(next); setMessage(`Optional analytics ${next ? 'disabled' : 'enabled'} for this browser.`); }
      else setMessage('Your browser prevented saving this preference. Use its Do Not Track or Global Privacy Control setting to disable optional analytics.');
    }}>{disabled ? 'Enable optional analytics' : 'Disable optional analytics'}</button>}
    <p role="status">{message}</p>
  </section>;
}

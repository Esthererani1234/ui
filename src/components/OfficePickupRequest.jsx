import {useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../state/AuthContext';
import {useCart} from '../state/CartContext';
import {supportRequest, requestReference} from '../lib/supportRequests';
import {officeAddress} from '../../shared/business.js';

const idReminder = 'Bring a government-issued photo ID to pickup. The name on the ID must match the pickup name on the request.';

export default function OfficePickupRequest({choice}) {
  const {items} = useCart();
  const {profile, user} = useAuth();
  const [who, setWho] = useState('self');
  const [drafts, setDrafts] = useState({self: {}, other: {}});
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const ref = useRef(null);
  const defaults = who === 'self' ? {
    first: profile?.first_name, last: profile?.last_name, phone: profile?.phone || user?.phone
  } : {};
  const contact = {...defaults, ...drafts[who]};

  function edit(field, value) {
    setDrafts(previous => ({...previous, [who]: {...previous[who], [field]: value}}));
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (lock.current || !items.length) return;
    const first = contact.first?.trim();
    const last = contact.last?.trim();
    const phone = contact.phone?.trim();
    if (!first || !last) return setError('Enter the first and last name shown on the pickup person’s ID.');
    if (!/^[+\d()\s.-]+$/.test(phone || '') || !/^\d{7,15}$/.test(phone.replace(/\D/g, ''))) {
      return setError('Enter a valid callback phone number, including the area code.');
    }
    const name = first + ' ' + last;
    const list = items.map(i => i.quantity + ' × ' + i.product.name + ' (ID ' + i.product.id + ')').join('\n');
    const message = ['Pickup person: ' + name, 'Callback number: ' + phone, '', 'Requested items:', list].join('\n');
    const body = {action:'create', category:'shipping', subject:'Office pickup request', order_number:null, message};
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (message.length > 3000) throw Error('This item list is too long. Please contact support to arrange pickup.');
      const result = await supportRequest({...body, request_id:requestReference(ref, body)});
      if (!result?.ok || !result.ticket?.ticket_number) throw Error('We could not confirm the request. Please retry.');
      setReceipt({name, phone});
    } catch (err) {
      setError(err.message || 'Could not submit. Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <section className="section container narrow"><div className="checkout-form">
    <span className="eyebrow dark">GOLD ON THE SPOT</span>
    {receipt ? <>
      <h1>Pickup request received</h1>
      <p>We’ll call {receipt.name} at <strong>{receipt.phone}</strong> to arrange pickup. Please wait for a confirmed time before visiting.</p>
      <address>{officeAddress.join(', ')}</address>
      <p>{receipt.name} must bring a matching government-issued photo ID.</p>
      <p>You haven’t been charged.</p>
      <Link className="button button-gold" to="/">Back to home</Link>
    </> : <>
      <h1>Checkout</h1>{!busy && choice}
      <h2>Office pickup</h2>
      <p>We’ll confirm availability and your total before payment. Items and prices aren’t reserved yet. Pickup is free.</p>
      {items.length ? <form onSubmit={submit}>
        <fieldset disabled={busy}><legend>Items for pickup</legend>
          <ul>{items.map(i => <li key={i.product.id}>{i.quantity} × {i.product.name}</li>)}</ul>
        </fieldset>
        <fieldset disabled={busy}><legend>Who’s picking up?</legend>
          <label><select value={who} aria-label="Pickup person" onChange={e => {setWho(e.target.value); setError('');}}>
            <option value="self">I’m picking up</option><option value="other">Someone else is picking up</option>
          </select></label>
          <p>Enter the first and last name exactly as they appear on the pickup person’s ID.</p>
          <label>First name<input required maxLength={100} autoComplete={who === 'self' ? 'given-name' : 'off'} value={contact.first || ''} onChange={e => edit('first', e.target.value)}/></label>
          <label>Last name<input required maxLength={100} autoComplete={who === 'self' ? 'family-name' : 'off'} value={contact.last || ''} onChange={e => edit('last', e.target.value)}/></label>
          <label>Callback phone number<input type="tel" required maxLength={32} autoComplete={who === 'self' ? 'tel' : 'off'} value={contact.phone || ''} onChange={e => edit('phone', e.target.value)}/></label>
          <p>We’ll call this number when your order is ready to arrange pickup. Please wait for a confirmed time before visiting.</p>
          <p><strong>{idReminder}</strong></p>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <button className="button button-gold" disabled={busy}>{busy ? 'Sending…' : 'Request office pickup'}</button>
      </form> : <p>Your cart is empty. <Link to="/shop">Browse bullion</Link></p>}
    </>}
  </div></section>;
}

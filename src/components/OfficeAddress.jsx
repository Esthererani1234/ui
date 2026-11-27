import { officeAddress, officeMapUrl } from '../../shared/business.js';
import './officeAddress.css';

export default function OfficeAddress({ children }) {
  return (
    <div className="office-address">
      <strong>New York office</strong>
      <address>
        {officeAddress.map(line => <span key={line}>{line}</span>)}
        {children}
      </address>
      <a href={officeMapUrl} target="_blank" rel="noopener noreferrer">View on map ↗</a>
    </div>
  );
}

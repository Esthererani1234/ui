import { useAuth } from '../state/AuthContext';
import SellPage from './SellPage';
export default function SellingCentrePage(){const {user}=useAuth();return <SellPage key={user.id} centre/>;}

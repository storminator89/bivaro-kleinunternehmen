import type { Metadata } from 'next';
import { ServiceBillingWorkspace } from '@/components/service-billing/service-billing-workspace';

export const metadata: Metadata = { title: 'Servicepläne | Bivaro' };

export default function ServiceBillingPage() {
  return <ServiceBillingWorkspace />;
}

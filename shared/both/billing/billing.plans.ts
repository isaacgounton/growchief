import { Plans } from '@growchief/shared-both/billing/billing.interface';

export enum identifier {
  normal = 'normal',
}

export const billingPlans: Plans[] = [
  {
    identifier: identifier.normal,
    name: 'Ultimate',
    credits: 200,
    month: {
      price: 50,
      currency: 'usd',
    },
    year: {
      price: 480,
      currency: 'usd',
    },
  },
];

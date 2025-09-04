import { RawBodyRequest } from '@nestjs/common';

export interface BillingInterface {
  identifier: string;
  planList: Plans[];
  trialLength: number;
  checkoutPage(
    customerId: string,
    plan: Plans,
    interval: 'month' | 'year',
    trial: boolean,
    quantity?: number,
  ): Promise<string>;
  checkBilling(customerId: string): Promise<string>;
  getCustomer(id?: string, email?: string): Promise<string>;
  getSubscription(customerId: string): Promise<string>;
  getPlan(plan: Plans, interval: 'month' | 'year'): Promise<string>;
  updateSubscriptionPlan(
    customerId: string,
    plan: Plans,
    interval: 'month' | 'year',
    quantity?: number,
  ): Promise<string>;
  changeSubscription(
    customerId: string,
    type: 'cancel' | 'enable',
  ): Promise<Date | null>;
  processWebhook(req: RawBodyRequest<Request>): Promise<{
    plan: Plans;
    customer: string;
    interval: 'year' | 'month';
    type: 'create' | 'update' | 'delete';
    isTrial: boolean;
    total?: number;
  }>;
}

export interface Plans {
  name: string;
  identifier: string;
  credits: number;
  month: {
    price: number;
    currency: string;
  };
  year: {
    price: number;
    currency: string;
  };
}

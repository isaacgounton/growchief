import { Injectable } from '@nestjs/common';
import { SubscriptionRepository } from '@growchief/shared-backend/database/subscription/subscription.repository';
import { Plans } from '@growchief/shared-both/billing/billing.interface';

@Injectable()
export class SubscriptionService {
  constructor(private _subscriptionRepository: SubscriptionRepository) {}

  updateCustomerId(orgId: string, customerId: string) {
    return this._subscriptionRepository.updateCustomerId(orgId, customerId);
  }

  changeSubscription(
    orgId: string,
    plan: Plans,
    interval: 'year' | 'month',
    isTrial?: boolean,
    total?: number,
  ) {
    return this._subscriptionRepository.changeSubscription(
      orgId,
      plan,
      interval,
      isTrial,
      total,
    );
  }

  async getCredits(organizationId: string) {
    return this._subscriptionRepository.getCredits(organizationId);
  }

  async consumeCredits(organizationId: string, credits: number) {
    return this._subscriptionRepository.consumeCredits(organizationId, credits);
  }

  deleteSubscription(orgId: string) {
    return this._subscriptionRepository.deleteSubscription(orgId);
  }

  updateSubscriptionStatus(orgId: string, date: Date | null) {
    return this._subscriptionRepository.updateSubscriptionStatus(orgId, date!);
  }
}

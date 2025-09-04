import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@growchief/shared-backend/database/prisma';
import { Plans } from '@growchief/shared-both/billing/billing.interface';
import dayjs from 'dayjs';

@Injectable()
export class SubscriptionRepository {
  constructor(
    private _subscription: PrismaRepository<'subscription'>,
    private _organization: PrismaRepository<'organization'>,
    private _credits: PrismaRepository<'credits'>,
  ) {}

  updateCustomerId(orgId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: { id: orgId },
      data: { paymentId: customerId },
    });
  }

  async changeSubscription(
    orgId: string,
    plan: Plans,
    interval: 'year' | 'month',
    isTrial?: boolean,
    total?: number,
  ) {
    if (typeof isTrial !== 'undefined') {
      await this._organization.model.organization.update({
        where: {
          id: orgId,
        },
        data: {
          allowTrial: isTrial,
        },
      });
    }

    return this._subscription.model.subscription.upsert({
      where: {
        organizationId: orgId,
      },
      create: {
        interval,
        identifier: plan.identifier,
        organizationId: orgId,
        total: total || 1,
        monthlyCredits: plan.credits * (total || 1),
      },
      update: {
        interval,
        identifier: plan.identifier,
        total: total || 1,
      },
    });
  }

  updateSubscriptionStatus(orgId: string, date?: Date) {
    return this._subscription.model.subscription.update({
      where: {
        organizationId: orgId,
      },
      data: {
        cancel_at: date,
      },
    });
  }

  async deleteSubscription(orgId: string) {
    await this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        allowTrial: false,
      },
    });

    return this._subscription.model.subscription.delete({
      where: {
        organizationId: orgId,
      },
    });
  }

  async getCredits(organizationId: string) {
    if (!process.env.BILLING_PROVIDER) {
      return {
        monthlyCredits: 100,
        used: 0,
      };
    }
    const getSubscription =
      (await this._subscription.model.subscription.findFirst({
        where: {
          organizationId,
        },
        select: {
          monthlyCredits: true,
          createdAt: true,
        },
      }))!;

    const currentDate = dayjs(getSubscription.createdAt);
    const monthsDistance = dayjs().diff(currentDate, 'month');
    const checkCreditsFrom = currentDate.add(monthsDistance, 'month');
    const credits = await this._credits.model.credits.aggregate({
      where: {
        organizationId,
        createdAt: {
          gte: checkCreditsFrom.toDate(),
        },
      },
      _sum: {
        total: true,
      },
    });

    return {
      monthlyCredits: getSubscription.monthlyCredits,
      used: credits._sum.total || 0,
    };
  }

  async consumeCredits(organizationId: string, credits: number) {
    if (!process.env.BILLING_PROVIDER) {
      return;
    }
    return this._credits.model.credits.create({
      data: {
        organizationId,
        total: credits,
      },
    });
  }
}

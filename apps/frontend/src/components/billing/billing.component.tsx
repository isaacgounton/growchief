import type { FC } from "react";
import type { Subscription } from "@prisma/client";
import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import dayjs from "dayjs";
import { clsx } from "clsx";
import { useUser, useModals } from "@growchief/frontend/utils/store";
import { useFetch } from "@growchief/frontend/utils/use.fetch";
import { OrganizationSelector } from "@growchief/frontend/components/layout/organization.selector.tsx";
import { useBillingRequest } from "@growchief/frontend/requests/billing.request.ts";
import { useDecisionModal } from "@growchief/frontend/utils/use.decision.modal.tsx";
import { LoadingComponent } from "@growchief/frontend/components/ui/loading.component.tsx";
import { LogoutComponent } from "@growchief/frontend/components/layout/logout.component.tsx";

interface PricingFeature {
  total: number | string;
  name: string;
  description: string;
}

interface PricingInterval {
  price: number;
  currency: string;
}

export interface PricingPlan {
  identifier: string;
  name: string;
  month: PricingInterval;
  year: PricingInterval;
  features: PricingFeature[];
}

export const BillingComponent: FC = () => {
  const user = useUser();

  return <BillingComponentInner user={user} mutate={user?.mutate!} />;
};

export const BillingComponentInner: FC<{ user: any; mutate: () => void }> = (
  props,
) => {
  const data = props.user;
  const subscription = data?.org?.subscription;
  const fetch = useFetch();
  const billing = useBillingRequest();
  const [loading, setLoading] = useState(false);
  const [interval, setInterval] = useState<"month" | "year">(
    subscription?.interval || "month",
  );
  const decisionModal = useDecisionModal();
  const modals = useModals();
  const [quantities, setQuantities] = useState<{ [key: string]: number }>(
    () => {
      // Initialize with current subscription quantity if it exists
      if (subscription) {
        return { [subscription.identifier]: subscription.total };
      }
      return {};
    },
  );

  const handleSubscribe = async (plan: string, interval: "year" | "month") => {
    const quantity = quantities[plan] || 1;
    if (!subscription) {
      // For trials, proceed directly without confirmation
      checkOut(plan, interval, quantity);
    } else {
      // For subscriptions, show confirmation dialog first
      const planData = pricingData?.find((p) => p.identifier === plan);
      const isCurrentPlan = subscription?.identifier === plan;
      const price = formatCurrency(
        (planData?.[interval].price || 0) * quantity,
        planData?.[interval].currency || "usd",
      );

      const confirmed = await decisionModal.open({
        label: isCurrentPlan ? "Update Subscription" : "Confirm Subscription",
        description: `Are you sure you want to continue?
${
  !isCurrentPlan
    ? `This will cost ${price} per ${interval}.`
    : `This will update your billing to ${price} per ${interval}.`
}`,
        approveLabel: isCurrentPlan
          ? "Update Subscription"
          : "Confirm Subscription",
        cancelLabel: "Cancel",
      });

      if (confirmed) {
        checkOut(plan, interval, quantity);
      }
    }
  };

  const updateQuantity = (planId: string, change: number) => {
    setQuantities((prev) => ({
      ...prev,
      [planId]: Math.max(1, (prev[planId] || 1) + change),
    }));
  };

  const checkOut = useCallback(
    async (plan: string, interval: "year" | "month", total?: number) => {
      setLoading(true);
      try {
        const response = await fetch(
          !subscription ? "/billing/checkout" : "/billing/subscription",
          {
            method: "POST",
            body: JSON.stringify({
              plan,
              interval,
              total: total || quantities[plan] || 1,
            }),
          },
        );

        const sub = await response.json();

        if (sub.errors) {
          modals.show({
            label: "Subscription Requirements",
            component: (close) => (
              <ErrorModalContent errors={sub.errors} onClose={close} />
            ),
          });
          setLoading(false);
          return;
        }

        if (!subscription) {
          window.location.href = sub.url;
          return;
        }

        props.mutate();
      } catch (error) {
        console.error("Subscription error:", error);
        modals.show({
          label: "Subscription Requirements",
          component: (close) => (
            <ErrorModalContent
              errors={["An unexpected error occurred. Please try again later."]}
              onClose={close}
            />
          ),
        });
      } finally {
        setLoading(false);
      }
    },
    [subscription, quantities],
  );

  const { data: pricingData, isLoading } = billing.pricing();
  const allowTrial = data?.org?.allowTrial;

  const formatCurrency = (price: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  if (isLoading) {
    return null;
  }

  return (
    <div
      className={clsx(
        "w-full",
        !subscription &&
          "flex justify-center items-center flex-1 bg-background",
      )}
    >
      <div
        className={clsx(
          "flex flex-col",
          !subscription && "w-full max-w-[1200px] p-[20px]",
        )}
      >
        {!subscription && (
          <>
            <GrowChiefLogo />
            <OrganizationSelector asOpenSelect={true} />
            {/*<Promotion />*/}
          </>
        )}
        <div className="flex justify-between items-center mb-[20px]">
          <div className="flex items-center bg-innerBackground border border-background p-[8px] rounded-[8px]">
            <button
              className={clsx(
                "px-[16px] py-[8px] rounded-[8px] text-[14px] font-[600] transition-all",
                interval === "month"
                  ? "bg-btn-primary text-white"
                  : "text-secondary hover:text-primary hover:bg-background",
              )}
              onClick={() => setInterval("month")}
            >
              Monthly
            </button>
            <button
              className={clsx(
                "px-[16px] py-[8px] rounded-[8px] text-[14px] font-[600] transition-all",
                interval === "year"
                  ? "bg-btn-primary text-white"
                  : "text-secondary hover:text-primary hover:bg-background",
              )}
              onClick={() => setInterval("year")}
            >
              Yearly
            </button>
          </div>
        </div>

        <div className="gap-[20px] w-full mx-auto justify-center items-center">
          {pricingData?.map((plan: PricingPlan) => (
            <div
              key={plan.identifier}
              className="flex flex-col h-full rounded-[8px] border border-background bg-innerBackground p-[20px]"
            >
              <div className="mb-[20px]">
                <div className="text-xl font-[600] text-primary">
                  {plan.name}
                </div>
                <div className="mt-[16px]">
                  <div className="flex items-center justify-between mb-[12px]">
                    <span className="text-[14px] font-[600] text-primary">
                      Quantity
                    </span>
                    <div className="flex items-center border border-background rounded-[6px]">
                      <button
                        onClick={() => updateQuantity(plan.identifier, -1)}
                        className="px-[8px] py-[4px] text-secondary hover:text-primary hover:bg-background rounded-l-[6px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={
                          quantities[plan.identifier] === 1 ||
                          !quantities[plan.identifier]
                        }
                      >
                        -
                      </button>
                      <span className="px-[12px] py-[4px] text-[14px] text-primary min-w-[40px] text-center">
                        {quantities[plan.identifier] || 1}
                      </span>
                      <button
                        onClick={() => updateQuantity(plan.identifier, 1)}
                        className="px-[8px] py-[4px] text-secondary hover:text-primary hover:bg-background rounded-r-[6px] transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {subscription?.identifier === plan.identifier && (
                    <div className="text-[12px] mb-[8px]">
                      This is your current plan. Changing quantity will update
                      your subscription.
                    </div>
                  )}
                  <span className="text-3xl font-bold text-primary">
                    {interval === "year"
                      ? formatCurrency(
                          (plan[interval].price / 12) *
                            (quantities[plan.identifier] || 1),
                          plan[interval].currency,
                        )
                      : formatCurrency(
                          plan[interval].price *
                            (quantities[plan.identifier] || 1),
                          plan[interval].currency,
                        )}
                  </span>
                  <span className="text-[14px] text-secondary">/month</span>

                  <div className="text-[14px] text-secondary mt-[4px]">
                    {interval === "year" ? (
                      <>
                        charged annually (
                        {formatCurrency(
                          plan[interval].price *
                            (quantities[plan.identifier] || 1),
                          plan[interval].currency,
                        )}
                        /year)
                      </>
                    ) : (
                      <>&nbsp;</>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-grow">
                <h3 className="text-[14px] font-[600] mb-[16px] text-primary">
                  Features
                </h3>
                <ul className="space-y-[12px]">
                  <li className="flex items-start">
                    <svg
                      className="w-5 h-5 text-btn-primary mr-[8px] mt-[2px] flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <div className="flex gap-[8px] items-center flex-1">
                      <span className="text-[14px] text-primary">
                        Monthly Credits
                      </span>
                      <div className="flex items-center">
                        <div className="text-[12px] bg-background text-secondary px-[6px] py-[2px] rounded-[4px]">
                          {200 * (quantities[plan.identifier] || 1)}
                        </div>
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <svg
                      className="w-5 h-5 text-btn-primary mr-[8px] mt-[2px] flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <div className="flex gap-[8px] items-center flex-1">
                      <span className="text-[14px] text-primary">
                        Total Accounts
                      </span>
                      <div className="flex items-center">
                        <div className="text-[12px] bg-background text-secondary px-[6px] py-[2px] rounded-[4px]">
                          {quantities[plan.identifier] || 1}
                        </div>
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <svg
                      className="w-5 h-5 text-btn-primary mr-[8px] mt-[2px] flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <div className="flex gap-[8px] items-center flex-1">
                      <span className="text-[14px] text-primary">
                        Total Proxies
                      </span>
                      <div className="flex items-center">
                        <div className="text-[12px] bg-background text-secondary px-[6px] py-[2px] rounded-[4px]">
                          {quantities[plan.identifier] || 1}
                        </div>
                      </div>
                    </div>
                  </li>
                  {plan.features.map(
                    (feature: PricingFeature, index: number) => (
                      <li key={index} className="flex items-start">
                        <svg
                          className="w-5 h-5 text-btn-primary mr-[8px] mt-[2px] flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <div className="flex gap-[8px] items-center flex-1">
                          <span className="text-[14px] text-primary">
                            {feature.name}
                          </span>
                          <div className="flex items-center">
                            <div className="text-[12px] bg-background text-secondary px-[6px] py-[2px] rounded-[4px]">
                              {feature.total}
                            </div>
                          </div>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <div className="pt-[20px]">
                <Button
                  disabled={
                    (data?.org?.subscription?.identifier === plan.identifier &&
                      data?.org?.subscription?.interval === interval &&
                      data?.org?.subscription?.total ===
                        (quantities[plan.identifier] || 1)) ||
                    loading
                  }
                  className="w-full"
                  onClick={() => handleSubscribe(plan.identifier, interval)}
                >
                  {loading ? (
                    <LoadingComponent color="#fff" width={20} height={20} />
                  ) : data?.org?.subscription?.identifier === plan.identifier &&
                    data?.org?.subscription?.interval === interval ? (
                    data?.org?.subscription?.total ===
                    (quantities[plan.identifier] || 1) ? (
                      "Current Plan"
                    ) : (
                      "Update Quantity"
                    )
                  ) : allowTrial ? (
                    "Start Trial"
                  ) : (
                    "Subscribe"
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
        {!!subscription && (
          <RenderOptions subscription={subscription} mutate={props.mutate} />
        )}
        <Faq />
        {!subscription && (
          <div className="flex justify-center mt-[20px]">
            <LogoutComponent />
          </div>
        )}
      </div>
    </div>
  );
};

const RenderOptions: FC<{
  subscription: Subscription;
  mutate: () => void;
}> = (props) => {
  const { subscription, mutate } = props;
  const fetch = useFetch();
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const decisionModal = useDecisionModal();

  const cancelSubscription = useCallback(
    async (type: "cancel" | "enable") => {
      const confirmed = await decisionModal.open({
        label:
          type === "cancel" ? "Cancel Subscription" : "Reactivate Subscription",
        description:
          type === "cancel"
            ? `Are you sure you want to cancel your subscription?
            You'll still have access until the end of your billing period.
            By the end of your billing period, all your workflows and accounts will be deleted.`
            : "Are you sure you want to reactivate your subscription?",
        approveLabel: type === "cancel" ? "Yes, Cancel" : "Yes, Reactivate",
        cancelLabel: "No, Keep Current",
      });

      if (confirmed) {
        setIsSubscriptionLoading(true);
        await fetch("/billing/subscription/cancel", {
          method: "PUT",
          body: JSON.stringify({
            type,
          }),
        });
        mutate();
        setIsSubscriptionLoading(false);
      }
    },
    [decisionModal, fetch, mutate],
  );

  const modifyPaymentMethods = useCallback(async () => {
    setIsPortalLoading(true);
    const { url } = await (await fetch("/billing/portal")).json();
    window.location.href = url;
  }, []);

  // @ts-ignore
  const cancelAtDate = subscription.cancel_at as string;

  return (
    <div className="mt-[32px]">
      <div className="mb-[20px]">
        <h3 className="text-xl font-[600] text-primary">
          Subscription Management
        </h3>
      </div>
      <div>
        <div className="space-y-[16px]">
          {cancelAtDate && (
            <div className="p-[16px] bg-orange-600/20 border border-orange-600/30 rounded-[8px]">
              <p className="text-[14px]">
                Your subscription is set to cancel on{" "}
                {dayjs(cancelAtDate).format("MMMM D, YYYY")}.
              </p>
            </div>
          )}

          <div className="grid gap-[20px] md:grid-cols-2">
            <div className="rounded-[8px] border border-background bg-innerBackground p-[20px]">
              <div className="mb-[12px]">
                <div className="text-lg font-[600] text-primary">
                  Billing Portal
                </div>
              </div>
              <div className="mb-[16px]">
                <p className="text-[14px]">
                  Access and manage your payment methods, invoices and billing
                  information.
                </p>
              </div>
              <div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={modifyPaymentMethods}
                  disabled={isPortalLoading}
                >
                  {isPortalLoading ? (
                    <div className="flex items-center">
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-primary"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Loading...
                    </div>
                  ) : (
                    "Go to Billing Portal"
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-[8px] border border-background bg-innerBackground p-[20px]">
              <div className="mb-[12px]">
                <div className="text-lg font-[600] text-primary">
                  Subscription Status
                </div>
              </div>
              <div className="mb-[16px]">
                <p className="text-[14px]">
                  {cancelAtDate
                    ? "You can resume your subscription if you change your mind."
                    : "Cancel your subscription at any time."}
                </p>
              </div>
              <div>
                <Button
                  variant={cancelAtDate ? "default" : "destructive"}
                  className="w-full"
                  onClick={() =>
                    cancelSubscription(cancelAtDate ? "enable" : "cancel")
                  }
                  disabled={isSubscriptionLoading}
                >
                  {isSubscriptionLoading ? (
                    <div className="flex items-center">
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Loading...
                    </div>
                  ) : cancelAtDate ? (
                    "Resume Subscription"
                  ) : (
                    "Cancel Subscription"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const GrowChiefLogo: FC = () => {
  return (
    <div className="flex items-center mb-[24px] justify-center">
      <img src="/logo.svg" alt="Logo" className="w-[60px] mr-[10px]" />
      <span className="text-2xl font-bold text-primary">GrowChief</span>
    </div>
  );
};

const Faq: FC = () => {
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>(
    {},
  );

  const toggleItem = (index: number) => {
    setExpandedItems((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const faqItems = [
    {
      question: "How does the 7-day free trial work?",
      answer:
        "All plans come with a 7-day free trial. You can explore all features without any limitations during this period. We'll send you a reminder before your trial ends, and you won't be charged if you cancel before the trial period ends.",
    },
    {
      question: "What happens when I change plans?",
      answer:
        "When upgrading, the new plan benefits take effect immediately. We'll prorate your billing based on the remaining days in your billing cycle. When downgrading, the changes will apply at the start of your next billing cycle.",
    },
    {
      question: "How do I cancel my subscription?",
      answer:
        "You can cancel your subscription anytime from the Subscription Management section. After cancellation, you'll still have access to your plan until the end of your current billing period.",
    },
    {
      question: "What payment methods do you accept?",
      answer:
        "We accept all major credit cards including Visa, Mastercard, and American Express. For annual plans, we also support invoicing for enterprise customers.",
    },
    {
      question: "Is there a difference between monthly and annual billing?",
      answer:
        "Annual billing offers a significant discount compared to monthly billing. The annual amount is charged once per year, providing you with cost savings while ensuring uninterrupted access to all features.",
    },
  ];

  return (
    <div className="mt-[32px]">
      <div className="mb-[20px]">
        <h3 className="text-xl font-[600] text-primary">
          Frequently Asked Questions
        </h3>
      </div>
      <div className="w-full">
        <div className="space-y-[16px] w-full">
          {faqItems.map((item, index) => (
            <div
              key={index}
              className="border border-background rounded-[8px] bg-innerBackground"
            >
              <button
                className="w-full flex justify-between items-center p-[20px] text-left font-[600] text-[16px] text-primary hover:bg-innerBackgroundHover transition-colors rounded-[8px]"
                onClick={() => toggleItem(index)}
              >
                <div>{item.question}</div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform text-secondary ${expandedItems[index] ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              {expandedItems[index] && (
                <div className="p-[20px] text-[14px] text-secondary">
                  {item.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface ErrorModalContentProps {
  errors: string[];
  onClose: () => void;
}

const ErrorModalContent: FC<ErrorModalContentProps> = ({ errors, onClose }) => {
  return (
    <div className="w-full">
      <ul className="mb-[16px]">
        {errors.map((error, index) => (
          <li className="list-disc mx-[20px]" key={index}>
            <div>{error}</div>
          </li>
        ))}
      </ul>
      <Button onClick={onClose} className="w-full">
        Close
      </Button>
    </div>
  );
};

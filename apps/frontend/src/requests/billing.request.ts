import { useFetch } from "@growchief/frontend/utils/use.fetch.tsx";
import { useCallback } from "react";
import useSWR from "swr";
import type { PricingPlan } from "@growchief/frontend/components/billing/billing.component.tsx";

export const useBillingRequest = () => {
  const fetch = useFetch();

  const pricing = useCallback(async () => {
    return (await fetch("/billing/pricing")).json();
  }, []);

  const credits = useCallback(async () => {
    return (await fetch("/billing/credits")).json();
  }, []);

  return {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    pricing: () => useSWR<PricingPlan[]>("pricing", pricing),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    credits: () => useSWR("credits", credits),
  };
};

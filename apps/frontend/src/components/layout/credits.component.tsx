import type { FC } from "react";
import { useBillingRequest } from "@growchief/frontend/requests/billing.request.ts";
import { useUser } from "@growchief/frontend/utils/store.ts";
import { createToolTip } from "@growchief/frontend/utils/create.tool.tip.tsx";

interface CreditsData {
  monthlyCredits: number;
  used: number;
}

export const CreditsComponent: FC = () => {
  const data = useUser();
  if (data?.selfhosted) {
    return null;
  }
  return <CreditsComponentInner />;
};

export const CreditsComponentInner: FC = () => {
  const billing = useBillingRequest();
  const { data: credits, isLoading, error } = billing.credits();

  if (isLoading || error || !credits) {
    return null;
  }

  const creditsData = credits as CreditsData;
  const remaining = Math.max(0, creditsData.monthlyCredits - creditsData.used);
  const usagePercentage = 100 - Math.min(
    100,
    (creditsData.used / creditsData.monthlyCredits) * 100,
  );

  // Determine color based on usage
  const getProgressColor = () => {
    if (usagePercentage >= 70) return "bg-btn-primary";
    if (usagePercentage >= 40) return "bg-yellow-500";
    if (usagePercentage >= 0) return "bg-red-500";
  };

  return (
    <div {...createToolTip('Remaining credits for enrichment')} className="flex items-center gap-[8px] text-secondary text-[12px] font-[500] select-none">
      {/* Credits text */}
      <span className="whitespace-nowrap">
        {remaining.toLocaleString()} /{" "}
        {creditsData.monthlyCredits.toLocaleString()}
      </span>

      {/* Progress bar */}
      <div className="w-[60px] h-[6px] bg-input-border rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${getProgressColor()}`}
          style={{ width: `${usagePercentage}%` }}
        />
      </div>
    </div>
  );
};

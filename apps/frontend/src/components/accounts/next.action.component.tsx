import type { FC } from "react";
import { useStatus } from "@growchief/frontend/requests/accounts.request.ts";
import { ClockIcon } from "@growchief/frontend/components/icons/clock.icon.tsx";
import { capitalize } from "lodash";

interface BotStatus {
  found: boolean;
  stepId?: string;
  workflowId?: string;
  when?: string;
  workingHours?: {
    isWithinHours: boolean;
    timeUntilWorkingHours: string | null;
  };
  restrictions?: Array<{
    methodName: string;
    until: string;
  }>;
  stepDetails?: {
    stepName: string;
    workflowName: string;
    stepType: string;
  };
  error?: string;
}

const formatTimeRemaining = (dateString: string): string => {
  const targetDate = new Date(dateString);
  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();

  if (diff <= 0) return "Now";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

export const NextActionComponent: FC<{ id: string }> = ({ id }) => {
  const { data: status, isLoading } = useStatus(id) as {
    data: BotStatus | undefined;
    isLoading: boolean;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-[6px] text-[12px] text-secondary">
        <div className="w-[12px] h-[12px] border-2 border-secondary border-t-transparent rounded-full animate-spin" />
        Loading...
      </div>
    );
  }

  // Check for restrictions first (regardless of workflow status)
  if (status?.restrictions && status.restrictions.length > 0) {
    const nextRestriction = status.restrictions[0];
    return (
      <div className="flex items-center gap-[6px] text-[12px]">
        <div className="w-[6px] h-[6px] bg-yellow-400 rounded-full" />
        <span className="text-yellow-400">
          Restricted until {formatTimeRemaining(nextRestriction.until)}
        </span>
      </div>
    );
  }

  // Check if outside working hours (regardless of workflow status)
  if (
    status?.workingHours &&
    !status.workingHours.isWithinHours &&
    status.workingHours.timeUntilWorkingHours
  ) {
    return (
      <div className="flex flex-col gap-[2px]">
        <div className="flex items-center gap-[6px] text-[12px]">
          <ClockIcon className="w-[12px] h-[12px] text-blue-400" />
          <span className="text-blue-400">
            Working hours start in{" "}
            {formatTimeRemaining(status.workingHours.timeUntilWorkingHours)}
          </span>
        </div>
      </div>
    );
  }

  // If no workflow found, show empty
  if (!status?.found) {
    return null;
  }

  // Show next action
  if (status.stepDetails) {
    let timeInfo = "Now";
    if (status.when) {
      const whenDate = new Date(status.when);
      const now = new Date();

      if (whenDate.getTime() > now.getTime()) {
        timeInfo = `in ${formatTimeRemaining(status.when)}`;
      }
    }

    return (
      <div className="flex flex-col gap-[2px]">
        <div className="flex items-center gap-[6px] text-[12px]">
          <div className="w-[6px] h-[6px] bg-green-400 rounded-full" />
          <span className="text-primary font-medium">Next Step {status?.stepDetails?.stepName}</span>
        </div>
        <div className="text-[11px] text-secondary pl-[12px]">
          {capitalize(status.stepDetails.workflowName)} • {timeInfo}
        </div>
      </div>
    );
  }

  // Fallback for when we have basic status but no step details
  if (status.stepId) {
    let timeInfo = "Now";
    if (status.when) {
      const whenDate = new Date(status.when);
      const now = new Date();
      if (whenDate.getTime() > now.getTime()) {
        timeInfo = formatTimeRemaining(status.when);
      }
    }

    return (
      <div className="flex items-center gap-[6px] text-[12px]">
        <div className="w-[6px] h-[6px] bg-green-400 rounded-full" />
        <span className="text-primary">Next action in {timeInfo}</span>
      </div>
    );
  }

  return <div className="text-[12px] text-secondary">Ready</div>;
};

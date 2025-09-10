import { condition, setHandler, proxyActivities } from '@temporalio/workflow';
import {
  getTimeUntilWorkingHours,
  isWithinWorkingHours,
} from '@growchief/shared-both/utils/time.functions';
import { workingHoursUpdated } from '@growchief/orchestrator/signals/working.hours.signal';
import type { WorkflowInformationActivity } from '@growchief/orchestrator/activities/workflow.information.activity';

const { getWorkingHours } = proxyActivities<WorkflowInformationActivity>({
  startToCloseTimeout: '2 minute',
});

export interface WorkingHoursState {
  workingHours: number[][];
  timezone: number;
}

export class WorkingHoursManager {
  private cachedWorkingHours: WorkingHoursState | null = null;
  private shouldRefetchWorkingHours = true;

  constructor(private botId: string) {
    this.setupSignalHandler();
  }

  private setupSignalHandler() {
    setHandler(workingHoursUpdated, () => {
      this.shouldRefetchWorkingHours = true;
      this.cachedWorkingHours = null;
    });
  }

  async ensureWithinWorkingHours(): Promise<void> {
    while (true) {
      // Fetch working hours if needed (first time or after update signal)
      if (this.shouldRefetchWorkingHours || !this.cachedWorkingHours) {
        this.cachedWorkingHours = await getWorkingHours(this.botId);
        this.shouldRefetchWorkingHours = false;
      }

      const { workingHours, timezone } = this.cachedWorkingHours;

      // Check if we're within working hours before processing any step
      if (!isWithinWorkingHours(workingHours, timezone)) {
        const sleepTime = getTimeUntilWorkingHours(workingHours, timezone);
        await condition(() => this.shouldRefetchWorkingHours, sleepTime);
        continue;
      }

      // If we reach here, we're within working hours and can proceed
      break; // Exit the while loop
    }
  }
}

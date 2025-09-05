import {
  proxyActivities,
  setHandler,
  sleep,
  condition,
  getExternalWorkflowHandle,
  continueAsNew,
  startChild,
  patched,
} from '@temporalio/workflow';
import type { AccountsStepActivity } from '@growchief/orchestrator/activities/accounts.step.activity';
import { cancelAll } from '@growchief/orchestrator/signals/cancel.all.signal';
import { Mutex } from 'async-mutex';
import { enqueue } from '@growchief/orchestrator/signals/enqueue.signal';
import {
  removeNodesFromQueueByNodeIdSignal,
  removeNodesFromQueueByWorkflowIdSignal,
} from '@growchief/orchestrator/signals/remove.nodes.from.queue.signal';
import { botStatus } from '@growchief/orchestrator/signals/bot.active.signal';
import { WorkflowInformationActivity } from '@growchief/orchestrator/activities/workflow.information.activity';
import { stepCompleted } from '@growchief/orchestrator/signals/step.completed.signal';
import { awaitedTryCatch } from '@growchief/shared-both/utils/awaited.try.catch';
import { WorkingHoursManager } from '@growchief/orchestrator/utils/working.hours.manager';
import { botLoggedSignal } from '@growchief/orchestrator/signals/bot.logged.signal';
import { workflowCampaign } from '@growchief/orchestrator/workflows/workflow.campaign';
import { makeId } from '@growchief/shared-both/utils/make.id';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@growchief/shared-backend/temporal/temporal.search.attribute';
import { NotificationActivity } from '@growchief/orchestrator/activities/notification.activity';
import { botJobsQueries } from '@growchief/orchestrator/queries/bot.jobs.queries';

const PROGRESS_DEADLINE = 10 * 60 * 1000;

export type Work = {
  workflowInternalId: string;
  workflowId: string;
  date: number;
  payload: any;
  url: string;
  priority: number;
  stepId: string;
  nodeId: string;
  functionName: string;
  leadId: string;
  orgId: string;
  botId: string;
  totalRepeat: number;
  appendUrl?: string;
  ignoreLead?: boolean;
};

const { saveActivity, saveRestriction, getStepRestrictions } =
  proxyActivities<WorkflowInformationActivity>({
    startToCloseTimeout: '2 minutes',
    retry: {
      maximumAttempts: 3,
    },
  });

const { getBot } = proxyActivities<WorkflowInformationActivity>({
  startToCloseTimeout: '2 minutes',
});

const { progress, getGap } = proxyActivities<AccountsStepActivity>({
  startToCloseTimeout: PROGRESS_DEADLINE,
  heartbeatTimeout: '30 seconds',
  retry: {
    maximumAttempts: 1,
  },
});

const { sendNotification } = proxyActivities<NotificationActivity>({
  startToCloseTimeout: '2 minutes',
});

const sortFunction = (items: Work[]) => {
  // Assign one random weight per workflowId so comparisons are consistent
  const weight = new Map();
  for (const it of items) {
    if (!weight.has(it.workflowId)) {
      weight.set(it.workflowId, Math.random()); // one random number per workflowId
    }
  }

  return (a: Work, b: Work) => {
    // 1) priority asc
    if (a.priority !== b.priority) return a.priority - b.priority;

    // 2) random order by workflowId
    const wa = weight.get(a.workflowId);
    const wb = weight.get(b.workflowId);
    if (wa !== wb) return wa - wb;

    // 3) date asc
    if (a.date !== b.date) return a.date - b.date;

    return String(a.workflowId).localeCompare(String(b.workflowId));
  };
};

export async function userWorkflowThrottler({
  nextAllowedAt = 0,
  logged = true,
  active = true,
  q = [],
}: {
  nextAllowedAt?: number;
  logged?: boolean;
  active?: boolean;
  q?: Work[];
}) {
  const GAP_MS = await getGap();
  let currentNextAllowedAt = nextAllowedAt;
  const lock = new Mutex();
  let workingHoursManager: WorkingHoursManager | null = null;

  setHandler(botJobsQueries, () => {
    if (!active || !logged) {
      return false;
    }

    if (!q.length) {
      return false;
    }

    return {
      stepId: q[0].stepId,
      workflowId: q[0].workflowId,
      when: currentNextAllowedAt,
    };
  });

  setHandler(botStatus, async (w) => {
    active = w;
  });

  setHandler(botLoggedSignal, async (w) => {
    logged = w;
  });

  setHandler(enqueue, async (w) => {
    await lock.runExclusive(async () => {
      q.push(w);
      q.sort(sortFunction(q));
    });
  });

  setHandler(removeNodesFromQueueByNodeIdSignal, async (w) => {
    await lock.runExclusive(async () => {
      const indexes = q.reduce((acc, item, index) => {
        if (item.nodeId === w) {
          acc.push(index);
        }
        return acc;
      }, [] as number[]);

      for (const index of indexes.reverse()) {
        q.splice(index, 1);
      }
    });
  });

  setHandler(removeNodesFromQueueByWorkflowIdSignal, async (w) => {
    await lock.runExclusive(async () => {
      const indexes = q.reduce((acc, item, index) => {
        if (item.workflowId === w) {
          acc.push(index);
        }
        return acc;
      }, [] as number[]);

      for (const index of indexes.reverse()) {
        q.splice(index, 1);
      }
    });
  });

  while (true) {
    await condition(() => q.length > 0);

    // we are getting to the first job in the queue
    const job = { ...q[0] };

    // trying to get the bot details
    const botModel = await awaitedTryCatch(() => getBot(job.botId));

    // if we can't get the bot, it means it was deleted, so we should remove the job from the queue
    if (!botModel) {
      await lock.runExclusive(async () => {
        q.splice(0, 1);
      });
      await getExternalWorkflowHandle(job.workflowInternalId).signal(cancelAll);
      continue;
    }

    // get the total allowed per day for this platform
    const isRestrictions = await getStepRestrictions(
      job.botId,
      job.functionName,
    );

    // if we reached the limit, we need to wait until next day or until there is another type of job in the queue
    // Right now we limit only one type of action, it's probably the connection request
    if (isRestrictions) {
      // check if there are other types of jobs in the queue
      // if there are no other types of jobs, we wait until restriction is lifted or until there is another type of job in the queue
      if (q.some((f) => f.functionName !== job.functionName)) {
        const restrictionEndTime = isRestrictions.until.getTime();
        const currentTime = Date.now();
        const sleepDuration = Math.max(0, restrictionEndTime - currentTime);

        await condition(
          () => q.some((f) => f.functionName !== job.functionName),
          sleepDuration,
        );
      } else {
        // if there are other types of jobs, we move this job to the end of the queue
        await lock.runExclusive(async () => {
          q.splice(0, 1);
          const firstJobFromDifferentType = q.findIndex(
            (f) => f.functionName !== job.functionName,
          );

          // move the first job from different type to the front of the queue
          if (firstJobFromDifferentType > -1) {
            const neededJob = { ...q[firstJobFromDifferentType] };
            q.splice(firstJobFromDifferentType, 1);
            q.unshift(neededJob);
          }

          q.push({
            ...job,
            date: isRestrictions.until.getTime(),
          });
        });
      }

      // and continue to the next iteration of the loop to pick the next job
      continue;
    }

    logged = botModel?.logged || false;

    // Initialize working hours manager if not already done
    if (!workingHoursManager) {
      workingHoursManager = new WorkingHoursManager(job.botId);
    }

    // Ensure we're within working hours before processing the job
    await workingHoursManager.ensureWithinWorkingHours();

    // Enforce the gap BEFORE work, creating a durable TimerStarted
    const now = Date.now(); // deterministic in workflows
    if (now < currentNextAllowedAt) {
      await sleep(currentNextAllowedAt - now);
    }

    // wait until bot is active and logged in
    await condition(() => active && logged);

    // we can start the job now
    const progressValue = await awaitedTryCatch(() =>
      progress({
        platform: botModel?.platform!,
        url: job.url,
        settings: job?.payload?.settings || {},
        organizationId: botModel?.organizationId!,
        botId: botModel?.id!,
        functionName: job.functionName,
        deadLine: PROGRESS_DEADLINE,
        leadId: job.leadId,
        proxyId: botModel?.proxyId || '',
        appendUrl: job.appendUrl,
        ignoreLead: !!job.ignoreLead,
      }),
    );

    // if progressValue is null it means the job failed, so we should remove it from the queue and cancel the workflow
    const { endWorkflow, delay, repeatJob, restriction, leads } =
      progressValue || {
        endWorkflow: true,
        delay: 0,
        repeatJob: false,
        leads: [],
      };

    // set the next allowed at time
    currentNextAllowedAt = Date.now() + GAP_MS;

    if (patched('notifications-01-09-2025') && restriction) {
      await sendNotification({
        orgId: job.orgId,
        title: 'Restrictions',
        message: restriction.message,
        sendEmail: true,
      });
    }

    if (leads && leads.length > 0) {
      for (const lead of leads) {
        if (!lead.url) {
          continue;
        }

        try {
          await startChild(workflowCampaign, {
            workflowId: `campaign-${job.workflowId}-${makeId(20)}`,
            taskQueue: 'main',
            cancellationType: 'ABANDON' as const,
            args: [
              {
                orgId: job.orgId,
                workflowId: job.workflowId,
                body: {
                  organization_name: '',
                  email: '',
                  firstName: lead.firstName,
                  lastName: lead.lastName,
                  urls: [lead.url],
                },
              },
            ],
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: job.orgId,
              },
            ]),
          });
        } catch (err) {}
      }
    }

    if (restriction) {
      await saveRestriction(job.botId, job.functionName, restriction.type);
    }

    // remove the processed job from the queue
    await lock.runExclusive(async () => {
      q.splice(0, 1);
    });

    // if the job failed, no set delay, and we already repeated 3 times, we should cancel the workflow
    if (endWorkflow || (repeatJob && job.totalRepeat >= 3)) {
      await getExternalWorkflowHandle(job.workflowInternalId).signal(cancelAll);
    }

    // if the job should be repeated, and we haven't repeated it 3 times already, we add it back to the queue with a delay if set
    if (repeatJob && job.totalRepeat < 3) {
      // Create a new reference with incremented totalRepeat and current date
      const repeatedJob: Work = {
        ...job,
        totalRepeat: job.totalRepeat + 1,
        date: Date.now(),
      };

      // Add the repeated job and re-sort the queue like in enqueue handler
      await lock.runExclusive(async () => {
        q.push(repeatedJob);
        q.sort(sortFunction(q));
      });
    }

    // In case a delay is set, wait for the specified delay before proceeding to the next job
    if (delay) {
      await sleep(delay);
    }

    // Notify the campaign that this work item is complete
    if (!repeatJob && job.leadId !== 'ignore' && !job.ignoreLead) {
      try {
        await saveActivity(
          job.leadId,
          job.orgId,
          job.functionName,
          job.botId,
          job.stepId,
          job.workflowId,
        );
      } catch (error) {}
    }

    if (!repeatJob) {
      try {
        await getExternalWorkflowHandle(job.workflowInternalId).signal(
          stepCompleted,
          job.stepId,
        );
      } catch (error) {}
    }

    // prevent race condition if there are
    await sleep(1);

    if (q.length === 0 || q.length === 50) {
      return continueAsNew({
        nextAllowedAt: currentNextAllowedAt,
        active,
        logged,
        q,
      });
    }
  }
}

import {
  condition,
  continueAsNew,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import { Mutex } from 'async-mutex';
import { cancelSubscription } from '@growchief/orchestrator/signals/cancel.subscription.signal';
import { DeactivateSubscriptionActivity } from '@growchief/orchestrator/activities/deactivate.subscription.activity';

export interface CancelSubscriptionParam {
  organizationId: string;
}

const { disableAllProxies } = proxyActivities<DeactivateSubscriptionActivity>({
  startToCloseTimeout: '2 minute',
  retry: {
    maximumAttempts: 3,
    maximumInterval: '1 minutes',
  },
});

const { cancelAllWorkflows, disableAll, removeSubscription } =
  proxyActivities<DeactivateSubscriptionActivity>({
    startToCloseTimeout: '2 minute',
  });

export async function workflowSubscriptionDeactivate() {
  const queue: CancelSubscriptionParam[] = [];
  const mutex = new Mutex();
  setHandler(cancelSubscription, async (param: CancelSubscriptionParam) => {
    mutex.runExclusive(() => {
      queue.push(param);
    });
  });

  while (true) {
    await condition(() => queue.length > 0);
    const currentQueue = queue.shift()!;
    try {
      await removeSubscription(currentQueue);
    } catch (err) {}
    try {
      await cancelAllWorkflows(currentQueue);
    } catch (err) {}
    try {
      await disableAllProxies(currentQueue);
    } catch (err) {}
    try {
      await disableAll(currentQueue);
    } catch (err) {}

    await sleep(2000);
    if (queue.length === 0) {
      return continueAsNew();
    }
  }
}

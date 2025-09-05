import {
  CancellationScope,
  condition,
  continueAsNew,
  getExternalWorkflowHandle,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import { PlugsActivity } from '@growchief/orchestrator/activities/plugs.activity';
import { userWorkflowThrottler } from '@growchief/orchestrator/workflows/workflow.throttle';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  botId as typedBotId,
  organizationId,
} from '@growchief/shared-backend/temporal/temporal.search.attribute';
import { enqueue } from '@growchief/orchestrator/signals/enqueue.signal';
import { stepCompleted } from '@growchief/orchestrator/signals/step.completed.signal';
import { cancelAll } from '@growchief/orchestrator/signals/cancel.all.signal';

const { getPlugs, getPlugsDescription } = proxyActivities<PlugsActivity>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

export async function workflowPlugs({
  botId,
  orgId,
}: {
  botId: string;
  orgId: string;
}) {
  let triggerStepId = '';
  let scope: CancellationScope;
  const throttlerId = `user-throttler-${botId}`;

  try {
    await startChild(userWorkflowThrottler, {
      args: [{}],
      workflowId: throttlerId,
      taskQueue: 'main',
      parentClosePolicy: ParentClosePolicy.ABANDON,
      cancellationType: 'ABANDON' as const,
      typedSearchAttributes: new TypedSearchAttributes([
        {
          key: typedBotId,
          value: botId,
        },
        {
          key: organizationId,
          value: orgId,
        },
      ]),
    });
  } catch (err) {}

  setHandler(stepCompleted, (stepId: string) => {
    triggerStepId = stepId;
  });

  setHandler(cancelAll, () => {
    scope?.cancel();
  });

  let runs = 0;
  while (true) {
    triggerStepId = '';
    scope = new CancellationScope({ cancellable: true });

    const { workflowId: workflowIdInternal } = workflowInfo();

    const plugs = await getPlugs(botId, orgId);

    if (plugs.length === 0) {
      return { noPlugs: true };
    }

    const randomPlug = plugs[Math.floor(Math.random() * plugs.length)];
    const tools = (await getPlugsDescription(plugs[0].bot.platform)).find(
      (p) => p.identifier === randomPlug.identifier,
    );

    if (!tools) {
      continue;
    }

    const throttler = getExternalWorkflowHandle(throttlerId);

    try {
      await scope.run(async () => {
        await throttler.signal(enqueue, {
          botId,
          orgId,
          workflowInternalId: workflowIdInternal,
          workflowId: workflowIdInternal + 'ignore',
          date: Date.now(),
          payload: { settings: JSON.parse(randomPlug.data || '{}') },
          functionName: tools.methodName,
          url: tools.url,
          stepId: workflowIdInternal,
          nodeId: workflowIdInternal,
          priority: -1,
          leadId: workflowIdInternal,
          totalRepeat: 0,
          appendUrl: '',
          ignoreLead: true,
        });

        await condition(() => triggerStepId === workflowIdInternal);
      });
    } catch (err) {}

    triggerStepId = '';

    // Random between 20 min (1200s) and 60 min (3600s)
    const min = 20 * 60 * 1000; // 20 minutes in ms
    const max = 60 * 60 * 1000; // 60 minutes in ms
    const randomMs = min + Math.floor(Math.random() * (max - min));

    await sleep(randomMs);

    if (runs > 50) {
      return continueAsNew({
        botId,
        orgId,
      });
    }

    runs++;
  }
}

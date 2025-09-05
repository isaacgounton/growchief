import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';
import {
  condition,
  continueAsNew,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import {
  addEnrichment,
  finishedEnrichment,
} from '@growchief/orchestrator/signals/enrichment.signals';
import { makeId } from '@growchief/shared-both/utils/make.id';
import { Mutex } from 'async-mutex';
import { EnrichmentActivity } from '@growchief/orchestrator/activities/enrichment.activity';
import { removeNodesFromQueueByWorkflowIdSignal } from '@growchief/orchestrator/signals/remove.nodes.from.queue.signal';
import { WorkflowInformationActivity } from '@growchief/orchestrator/activities/workflow.information.activity';

const { enrich, enrichments } = proxyActivities<EnrichmentActivity>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

const { getCredits, consumeCredits } =
  proxyActivities<WorkflowInformationActivity>({
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 3 },
  });

export async function workflowEnrichment({
  queue = [],
  limitsDelay,
}: {
  queue?: Array<
    EnrichmentDto & {
      workflowId: string;
      stepId: string;
      organizationId: string;
      internalWorkflowId: string;
      platform: string;
      identifier: string;
      testedProviders: string[];
    }
  >;
  limitsDelay?: { name: string; delay: number }[];
}) {
  const mutex = new Mutex();
  const enrichmentList = await enrichments();
  limitsDelay =
    !limitsDelay || limitsDelay.length !== enrichmentList.length
      ? enrichmentList.map((p) => ({
          name: p.name,
          delay: Date.now(),
        }))
      : limitsDelay;

  // add item to the queue
  setHandler(addEnrichment, (item) => {
    mutex.runExclusive(() => {
      queue.push({ ...item, testedProviders: [], identifier: makeId(10) });
    });
  });

  setHandler(removeNodesFromQueueByWorkflowIdSignal, async (w) => {
    await mutex.runExclusive(async () => {
      const indexes = queue.reduce((acc, item, index) => {
        if (item.workflowId === w) {
          acc.push(index);
        }
        return acc;
      }, [] as number[]);

      for (const index of indexes.reverse()) {
        queue.splice(index, 1);
      }
    });
  });

  while (true) {
    // wait until something is in the queue
    await condition(() => queue.length > 0);

    // check the current queue length
    const queueLength = queue.length;

    // get current time
    const now = Date.now();

    // get providers that are not in delay
    const availableProviders = limitsDelay.filter((p) => p.delay <= now);
    const notAvailableProviders = limitsDelay.filter((p) => p.delay > now);

    // if no providers are available, wait until the next one is available
    if (availableProviders.length === 0) {
      await sleep(
        Math.min(...notAvailableProviders.map((l) => l.delay - Date.now())) +
          1000,
      );
      continue;
    }

    // get items that have at least one provider not tested
    const availableQueues = queue.filter((item) => {
      const notTestedProviders = availableProviders.filter(
        (p) => !item.testedProviders.includes(p.name),
      );
      return notTestedProviders.length > 0;
    });

    // if no items are available, wait until the queue changes or the next provider is available
    if (availableQueues.length === 0) {
      const nextAvailableProvider =
        Math.min(...notAvailableProviders.map((l) => l.delay - Date.now())) +
        1000;

      await condition(
        () => queue.length !== queueLength,
        nextAvailableProvider,
      );
      continue;
    }

    // take the first available item
    const item = availableQueues[0];
    const externalHandle = getExternalWorkflowHandle(item.internalWorkflowId);

    const goOver = availableProviders.filter(
      (f) => !item.testedProviders.includes(f!.name),
    );

    const credits = await getCredits(item.organizationId);
    if (credits.monthlyCredits - credits.used === 0) {
      await mutex.runExclusive(() => {
        const itemIndex = queue.findIndex(
          (q) => q.identifier === item.identifier,
        );
        queue.splice(itemIndex, 1);
      });

      continue;
    }

    // try to enrich with each available provider that is not tested yet
    for (const provider of goOver
      .map((p) => enrichmentList.find((pl) => pl.name === p.name))
      .filter(Boolean)) {
      // try to enrich the item
      const value = await enrich(provider?.name!, item.platform, item);
      // if enrichment is successful or all providers are tested, signal the result and remove the item from the queue
      if (
        (value === false &&
          item.testedProviders.length === enrichmentList.length - 1) ||
        (value && 'url' in value)
      ) {
        // signaling the result back to the original workflow
        try {
          await externalHandle.signal(finishedEnrichment, {
            stepId: item.stepId,
            value,
          });

          if (value) {
            await consumeCredits(item.organizationId, 1);
          }
        } catch (err) {}

        // removing the item from the queue
        await mutex.runExclusive(() => {
          const itemIndex = queue.findIndex(
            (q) => q.identifier === item.identifier,
          );
          queue.splice(itemIndex, 1);
        });
        break;
      }

      // if enrichment didn't find a result, mark this provider as tested for this item
      if (!value) {
        item.testedProviders.push(provider!.name);
      }

      // if enrichment returned a delay, set the provider in delay
      if (value && typeof value === 'object' && 'delay' in value) {
        limitsDelay[
          limitsDelay.findIndex((l) => l.name === provider!.name)
        ].delay = Date.now() + (value as { delay: number }).delay;
      }
    }

    if (queue.length === 0 || queue.length === 200) {
      return continueAsNew({
        queue,
        limitsDelay,
      });
    }
  }
}

import {
  condition,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';
import type { WorkflowInformationActivity } from '@growchief/orchestrator/activities/workflow.information.activity';
import { workflowBotJobs } from '@growchief/orchestrator/workflows/workflow.bot.jobs';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  botId,
  nodeId,
  organizationId,
  workflowId,
} from '@growchief/shared-backend/temporal/temporal.search.attribute';
import { makeId } from '@growchief/shared-both/utils/make.id';
import { workflowEnrichment } from '@growchief/orchestrator/workflows/workflow.enrichment';
import {
  addEnrichment,
  finishedEnrichment,
} from '@growchief/orchestrator/signals/enrichment.signals';
import { EnrichmentReturn } from '@growchief/shared-backend/enrichment/enrichment.interface';

const { getWorkflowAndNodes, addAndReturnLead } =
  proxyActivities<WorkflowInformationActivity>({
    startToCloseTimeout: '2 minute',
  });

export interface WorkflowNodes {
  identifier: string;
  organizationId: string;
  workflowId: string;
  nodeId: string;
  botId: string;
  platform: string;
  leadId?: string;
  url?: string;
}
export async function workflowCampaign(args: {
  orgId: string;
  workflowId: string;
  body: EnrichmentDto;
}): Promise<void> {
  const { workflowId: internalWorkflowId } = workflowInfo();
  const extraFields = (node: WorkflowNodes) => ({
    typedSearchAttributes: new TypedSearchAttributes([
      {
        key: organizationId,
        value: args.orgId,
      },
      {
        key: workflowId,
        value: node.workflowId,
      },
      {
        key: nodeId,
        value: node.nodeId,
      },
      {
        key: botId,
        value: node.botId,
      },
    ]),
    parentClosePolicy: 'ABANDON' as const,
  });

  // getting all the nodes from the workflow
  const workflowDetails = await getWorkflowAndNodes(args.workflowId, args.body);
  if (!workflowDetails) {
    return;
  }

  // leads we don't have in the database
  const nonFoundLead = workflowDetails.filter((f) => !f.leadId);

  // leads we have in the database or direct url
  const foundLead = workflowDetails.filter(
    (f) => f.leadId && f.url,
  ) as Required<WorkflowNodes>[];

  // starting bot jobs for the leads we have
  for (const node of foundLead) {
    await startChild(workflowBotJobs, {
      workflowId: 'workflow-bot-jobs-' + makeId(10),
      args: [
        {
          orgId: args.orgId,
          botId: node.botId,
          workflowId: node.workflowId,
          nodeId: node.nodeId,
          url: node.url,
          platform: node.platform,
          leadId: node.leadId,
        },
      ],
      ...extraFields(node),
    });
  }

  // if we don't have any leads to enrich, we are done
  if (!nonFoundLead.length) {
    return;
  }

  // starting enrichment workflow in case it is not already started
  try {
    await startChild(workflowEnrichment, {
      workflowId: 'enrichment',
      args: [{}],
      parentClosePolicy: 'ABANDON' as const,
    });
  } catch (err) {}

  // getting a handle to the enrichment workflow
  const handle = getExternalWorkflowHandle('enrichment');

  // list of finished enrichments
  const foundIdentifiers = [] as {
    stepId: string;
    value: EnrichmentReturn | false;
  }[];

  // setting a signal handler to get notified when an enrichment is finished
  setHandler(finishedEnrichment, (data) => {
    foundIdentifiers.push(data);
  });

  // sending enrichment requests for the leads we don't have
  await Promise.all(
    nonFoundLead.map(async (node) => {
      await handle.signal(addEnrichment, {
        ...args.body,
        platform: node.platform,
        internalWorkflowId,
        stepId: node.identifier,
        workflowId: node.workflowId,
        organizationId: args.orgId,
      });

      // waiting until we have the enrichment result
      await condition(() =>
        foundIdentifiers.some((p) => p.stepId === node.identifier),
      );

      // getting the enrichment result
      const found = foundIdentifiers.find((f) => f.stepId === node.identifier)!;

      // if we didn't find anything, we are done here
      if (!found.value) {
        return;
      }

      // adding the lead to the database
      const lead = (await addAndReturnLead(
        node.organizationId,
        node.workflowId,
        node.platform,
        args.body.email || '',
        found.value,
      ))!;

      // starting the bot job for the found lead
      await startChild(workflowBotJobs, {
        workflowId: 'workflow-bot-jobs-' + makeId(10),
        args: [
          {
            orgId: args.orgId,
            botId: node.botId,
            workflowId: node.workflowId,
            nodeId: node.nodeId,
            url: found.value.url,
            platform: node.platform,
            leadId: lead.id,
          },
        ],
        ...extraFields(node),
      });
    }),
  );

  return;
}

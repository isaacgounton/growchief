import { defineSignal } from '@temporalio/workflow';
import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';
import { EnrichmentReturn } from '@growchief/shared-backend/enrichment/enrichment.interface';

export const addEnrichment = defineSignal<
  [
    EnrichmentDto & {
      platform: string;
      internalWorkflowId: string;
      organizationId: string;
      workflowId: string;
      stepId: string;
    },
  ]
>('addEnrichment');

export const finishedEnrichment =
  defineSignal<[{ stepId: string; value: EnrichmentReturn | false }]>(
    'finishedEnrichment',
  );

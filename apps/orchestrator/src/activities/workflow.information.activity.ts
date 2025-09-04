import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { BotsService } from '@growchief/shared-backend/database/bots/bots.service';
import { WorkflowsService } from '@growchief/shared-backend/database/workflows/workflows.service';
import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';
import { WorkflowNodes } from '@growchief/orchestrator/workflows';
import { botList } from '@growchief/shared-backend/bots/bot.list';
import { URLService } from '@growchief/shared-both/utils/url.normalize';
import type { RestrictionType } from '@growchief/shared-backend/temporal/progress.response';
import dayjs from 'dayjs';
import { makeId } from '@growchief/shared-both/utils/make.id';
import { SubscriptionService } from '@growchief/shared-backend/database/subscription/subscription.service';
import type { EnrichmentReturn } from '@growchief/shared-backend/enrichment/enrichment.interface';

@Injectable()
@Activity()
export class WorkflowInformationActivity {
  constructor(
    private _botsService: BotsService,
    private _workflowService: WorkflowsService,
    private _urlService: URLService,
    private _subscriptionService: SubscriptionService,
  ) {}

  @ActivityMethod()
  async getBot(botId: string) {
    return this._botsService.getBot(botId);
  }

  @ActivityMethod()
  async getSteps(workflowId: string, nodeId: string) {
    return this._workflowService.getNodesSteps(workflowId, nodeId);
  }

  @ActivityMethod()
  async getTools() {
    return this._botsService.getTools();
  }

  @ActivityMethod()
  async saveActivity(
    leadId: string,
    organizationId: string,
    type: string,
    botId: string,
    stepId: string,
    workflowId: string,
  ) {
    return this._botsService.saveActivity(
      leadId,
      organizationId,
      type,
      botId,
      stepId,
      workflowId,
    );
  }

  @ActivityMethod()
  async getWorkflowAndNodes(workflowId: string, body: EnrichmentDto) {
    const workflow =
      await this._workflowService.getWorkflowAccounts(workflowId);
    if (!workflow || !workflow?.workflow?.active) {
      return false;
    }

    const listFlows: WorkflowNodes[] = [];

    for (const node of workflow.children) {
      const data = JSON.parse(node.data || '{}');
      const botModel = await this._botsService.getBot(data.account.id);

      if (botModel?.status === 'PAUSED' || botModel?.deletedAt) {
        return;
      }

      const getBot = botList.find(
        (p) => p.identifier === data.account.platform,
      );

      if (!getBot) {
        continue;
      }

      body.urls = body?.urls?.length
        ? body.urls.map((url) => {
            const normalized = this._urlService.normalizeUrlSafe(url);
            if (getBot.isWWW) {
              return normalized.indexOf('//www.') === -1
                ? normalized.replace('://', '://www.')
                : normalized;
            } else {
              return normalized.replace('://www.', '://');
            }
          })
        : [];

      const lead = await this._workflowService.processEnrichment(
        workflow.organizationId,
        workflowId,
        data.account.platform,
        body,
      );

      listFlows.push({
        identifier: makeId(10),
        platform: data.account.platform,
        organizationId: workflow.organizationId,
        workflowId: workflowId,
        nodeId: node.id,
        botId: data.account.id,
        leadId: lead?.id,
        url: lead?.url,
      });
    }

    return listFlows;
  }

  @ActivityMethod()
  addAndReturnLead(
    orgId: string,
    workflowId: string,
    platform: string,
    email: string,
    value: EnrichmentReturn,
  ) {
    let { url } = value;
    const getBot = botList.find((p) => p.identifier === platform)!;

    url = [url].map((url) => {
      const normalized = this._urlService.normalizeUrlSafe(url);
      if (getBot.isWWW) {
        return normalized.indexOf('//www.') === -1
          ? normalized.replace('://', '://www.')
          : normalized;
      } else {
        return normalized.replace('://www.', '://');
      }
    })[0];

    return this._workflowService.processEnrichment(
      orgId,
      workflowId,
      platform,
      {
        urls: [url],
        email: email || '',
        firstName: value.firstName || '',
        lastName: value.lastName || '',
        organization_name: '',
      },
    );
  }

  @ActivityMethod()
  async getWorkingHours(
    botId: string,
  ): Promise<{ workingHours: number[][]; timezone: number }> {
    const bot = await this._botsService.getBot(botId);
    return {
      workingHours: JSON.parse(bot?.workingHours || '[]'),
      timezone: bot?.timezone || 0,
    };
  }

  @ActivityMethod()
  async getStepRestrictions(botId: string, activityName: string) {
    return this._botsService.getStepRestrictions(botId, activityName);
  }

  @ActivityMethod()
  async saveRestriction(
    botId: string,
    methodName: string,
    type: RestrictionType,
  ) {
    if (type === 'weekly') {
      const date = dayjs
        .utc()
        .endOf('week')
        .add(2, 'day')
        .startOf('week')
        .toDate();
      await this._botsService.saveRestriction(botId, methodName, date);
    }
  }

  @ActivityMethod()
  async getCredits(organizationId: string) {
    return this._subscriptionService.getCredits(organizationId);
  }

  @ActivityMethod()
  async consumeCredits(organizationId: string, amount: number) {
    return this._subscriptionService.consumeCredits(organizationId, amount);
  }
}

import { Injectable } from '@nestjs/common';
import { BotsRepository } from '@growchief/shared-backend/database/bots/bots.repository';
import { OrganizationService } from '@growchief/shared-backend/database/organizations/organization.service';
import { EmailService } from '@growchief/shared-backend/email/email.service';
import { botList } from '@growchief/shared-backend/bots/bot.list';
import { ToolParams } from '@growchief/shared-both/utils/tool.decorator';
import { TemporalService } from 'nestjs-temporal-core';
import { ProxiesService } from '@growchief/shared-backend/database/proxies/proxies.service';
import { ProxiesManager } from '@growchief/shared-backend/proxies/proxies.manager';
import { organizationId as orgId } from '@growchief/shared-backend/temporal/temporal.search.attribute';
import { botJobsQueries } from '@growchief/orchestrator/queries/bot.jobs.queries';
import { awaitedTryCatch } from '@growchief/shared-both/utils/awaited.try.catch';
import {
  isWithinWorkingHours,
  getTimeUntilWorkingHours,
} from '@growchief/shared-both/utils/time.functions';
import { NotificationManager } from '@growchief/shared-backend/notifications/notification.manager';
import { PluginParams } from '@growchief/shared-backend/plugs/plug.decorator';
import { ActionList } from '@growchief/shared-backend/bots/bots.interface';
@Injectable()
export class BotsService {
  constructor(
    private _botsRepository: BotsRepository,
    private _organizationService: OrganizationService,
    private _emailService: EmailService,
    private _temporal: TemporalService,
    private _proxiesService: ProxiesService,
    private _proxyManager: ProxiesManager,
    private _notificationManager: NotificationManager,
  ) {}

  async getProxy(orgId: string, proxyId: string) {
    return this._proxiesService.getProxyById(proxyId, orgId);
  }

  async getGroupsAndBotsByOrganization(organizationId: string) {
    return this._botsRepository.getGroupsAndBotsByOrganization(organizationId);
  }

  async getBotGroups(organizationId: string) {
    return this._botsRepository.getBotGroupsByOrganization(organizationId);
  }

  async getBotGroup(id: string, organizationId: string) {
    return this._botsRepository.getBotGroupById(id, organizationId);
  }

  async createBotGroup(organizationId: string, name: string) {
    return this._botsRepository.createBotGroup(organizationId, name);
  }

  async deleteBotGroup(id: string, organizationId: string) {
    return this._botsRepository.deleteBotGroup(id, organizationId);
  }

  async getBotsByGroup(botGroupId: string, organizationId: string) {
    return this._botsRepository.getBotsByGroup(botGroupId, organizationId);
  }

  async getAllBots(organizationId: string) {
    return this._botsRepository.getBotsByOrganization(organizationId);
  }

  async getBot(id: string, organizationId?: string) {
    return this._botsRepository.getBotById(id, organizationId);
  }

  async deleteBot(id: string, organizationId: string) {
    const bot = await this._botsRepository.deleteBot(id, organizationId);
    const workflows = this._temporal
      .getClient()
      .listWorkflows(`botId="${id}" AND ExecutionStatus="Running"`);

    for await (const workflow of workflows) {
      try {
        await (
          await this._temporal
            .getClient()
            .getWorkflowHandle(workflow.workflowId)
        ).terminate('Bot deleted');
      } catch (error) {
        console.log(
          `Failed to terminate workflow ${workflow.workflowId}:`,
          error.message,
        );
      }
    }
    return bot;
  }

  async updateBotWorkingHours(
    id: string,
    organizationId: string,
    timezone: number,
    workingHours: string,
  ) {
    const result = await this._botsRepository.updateBotWorkingHours(
      id,
      organizationId,
      timezone,
      workingHours,
    );

    // Send signal to bot jobs workflows to recalculate working hours
    try {
      // Search for all active workflows for this bot using search attributes
      const workflows = this._temporal
        .getClient()
        .listWorkflows(
          `botId="${id}" AND WorkflowType IN("workflowBotJobs", "userWorkflowThrottler") AND ExecutionStatus="Running"`,
        );

      for await (const workflow of workflows) {
        try {
          await (
            await this._temporal
              .getClient()
              .getWorkflowHandle(workflow.workflowId)
          ).signal('workingHoursUpdated');
        } catch (signalError) {
          console.log(
            `Failed to send signal to workflow ${workflow.workflowId}:`,
            signalError.message,
          );
        }
      }
    } catch (error) {
      // Search might fail if no workflows are running, which is fine
      console.log(
        `Could not search/signal workflows for bot ${id}:`,
        error.message,
      );
    }

    return result;
  }

  async moveBotToGroup(id: string, organizationId: string, groupId: string) {
    return this._botsRepository.moveBotToGroup(id, organizationId, groupId);
  }

  async updateBotStatus(
    id: string,
    organizationId: string,
    status: 'ACTIVE' | 'PAUSED',
  ) {
    const update = await this._botsRepository.updateBotStatus(
      id,
      organizationId,
      status,
    );

    try {
      // Search for all active workflows for this bot using search attributes
      const workflows = this._temporal
        .getClient()
        .listWorkflows(
          `botId="${id}" AND WorkflowType="userWorkflowThrottler" AND ExecutionStatus="Running"`,
        );

      for await (const workflow of workflows) {
        try {
          const handle = await this._temporal
            .getClient()
            .getWorkflowHandle(workflow.workflowId);
          await handle.signal('botStatus', status === 'ACTIVE');
        } catch (signalError) {
          console.log(
            `Failed to send signal to workflow ${workflow.workflowId}:`,
            signalError.message,
          );
        }
      }
    } catch (err) {}

    return update;
  }

  async assignProxy(id: string, organizationId: string, proxyId: string) {
    return this._botsRepository.assignProxy(id, organizationId, proxyId);
  }

  async removeProxy(id: string, organizationId: string) {
    return this._botsRepository.removeProxy(id, organizationId);
  }

  async getBotGroupsCount(organizationId: string) {
    return this._botsRepository.getBotGroupsCount(organizationId);
  }

  async getBotsCount(organizationId: string) {
    return this._botsRepository.getBotsCount(organizationId);
  }

  async getActiveBotsCount(organizationId: string) {
    return this._botsRepository.getActiveBotsCount(organizationId);
  }

  async getDashboardStats(organizationId: string) {
    const [totalGroups, totalBots, activeBots] = await Promise.all([
      this.getBotGroupsCount(organizationId),
      this.getBotsCount(organizationId),
      this.getActiveBotsCount(organizationId),
    ]);

    return {
      totalGroups,
      totalBots,
      activeBots,
      pausedBots: totalBots - activeBots,
    };
  }

  async loggedOut(bot: string) {
    const botModel = (await this.getBot(bot))!;

    try {
      // Search for all active workflows for this bot using search attributes
      const workflows = this._temporal
        .getClient()
        .listWorkflows(
          `botId="${bot}" AND WorkflowType="userWorkflowThrottler" AND ExecutionStatus="Running"`,
        );

      for await (const workflow of workflows) {
        try {
          const handle = await this._temporal
            .getClient()
            .getWorkflowHandle(workflow.workflowId);
          await handle.signal('botLoggedSignal', false);
        } catch (signalError) {
          console.log(
            `Failed to send signal to workflow ${workflow.workflowId}:`,
            signalError.message,
          );
        }
      }
    } catch (err) {}

    await this._notificationManager.sendNotification(
      botModel.organization.id,
      'You accounts ${botModel.name} has logged out',
      `
        Your accounts ${botModel.name} has logged out. Please login again to continue the automation.<br />
        https://platform.postiz.com
      `,
      true,
    );

    return true;
  }

  async saveStorageAndActions(
    functionName: string,
    orgId: string,
    platform: string,
    name: string,
    picture: string,
    id: string,
    botGroup: string,
    bot: string,
    storage: object,
    loggedIn: boolean,
    timezone: number,
    proxyId?: string,
  ) {
    const saveBot = await this._botsRepository.saveStorageAndActions(
      orgId,
      platform,
      name,
      picture,
      id,
      botGroup,
      bot,
      storage,
      loggedIn,
      timezone,
      proxyId,
    );

    if (functionName === 'login' && loggedIn && saveBot.id) {
      try {
        // Search for all active workflows for this bot using search attributes
        const workflows = this._temporal
          .getClient()
          .listWorkflows(
            `botId="${saveBot.id}" AND WorkflowType="userWorkflowThrottler" AND ExecutionStatus="Running"`,
          );

        for await (const workflow of workflows) {
          try {
            const handle = await this._temporal
              .getClient()
              .getWorkflowHandle(workflow.workflowId);
            await handle.signal('botLoggedSignal', true);
          } catch (signalError) {
            console.log(
              `Failed to send signal to workflow ${workflow.workflowId}:`,
              signalError.message,
            );
          }
        }
      } catch (err) {}
    }

    return saveBot.logged;
  }

  public getTools() {
    return botList.map((b) => ({
      identifier: b.identifier,
      label: b.label,
      tools: (Reflect.getMetadata('custom:tool', b.constructor.prototype) ||
        []) as Array<{ methodName: string } & ToolParams>,
    }));
  }

  public getPlugins() {
    return botList.map((b) => ({
      identifier: b.identifier,
      label: b.label,
      plugins: (
        (Reflect.getMetadata('custom:plugin', b.constructor.prototype) ||
          []) as Array<{ methodName: string; url: string } & PluginParams>
      ).map((p) => ({
        ...p,
        url: b.initialPage,
        variables: p.variables.map((v) => ({
          ...v,
          regex: {
            source: v.regex.source,
            flags: v.regex.flags,
          },
        })),
      })),
    }));
  }

  saveActions(
    botId: string,
    orgId: string,
    platform: string,
    textForComment: string,
    value: ActionList[],
  ) {
    return this._botsRepository.saveActions(
      botId,
      orgId,
      platform,
      textForComment,
      value,
    );
  }

  checkActions(
    botId: string,
    platform: string,
    check: { type: string; id: string; userUrl?: string }[],
  ) {
    return this._botsRepository.checkActions(botId, platform, check);
  }

  async saveActivity(
    leadId: string,
    organizationId: string,
    type: string,
    botId: string,
    stepId: string,
    workflowId: string,
  ) {
    return this._botsRepository.saveActivity(
      leadId,
      organizationId,
      type,
      botId,
      stepId,
      workflowId,
    );
  }

  public getToolsByIdentifier(identifier: string) {
    return this.getTools().find((p) => p.identifier === identifier);
  }

  public getToolsPluginsByIdentifier(identifier: string) {
    return this.getPlugins().find((p) => p.identifier === identifier)?.plugins!;
  }

  public async disableAll(organizationId: string) {
    await this._botsRepository.disableAll(organizationId);
  }

  public async disableAllProxies(organizationId: string) {
    const list =
      await this._proxiesService.getAllProxiesByOrganization(organizationId);
    for (const proxy of list) {
      if (proxy.provider !== 'custom') {
        await this._proxyManager.deleteProxy(
          proxy.provider,
          proxy.ip,
          organizationId,
        );
      }
    }

    return true;
  }

  canAddBot(organizationId: string, currentTotal: number) {
    return this._botsRepository.canAddBot(organizationId, currentTotal);
  }

  totalBots(organizationId: string) {
    return this._botsRepository.totalBots(organizationId);
  }

  async getStepRestrictions(botId: string, methodName: string) {
    return this._botsRepository.getStepRestrictions(botId, methodName);
  }

  saveRestriction(botId: string, methodName: string, date: Date) {
    return this._botsRepository.saveRestriction(botId, methodName, date);
  }

  async getBotStatus(organizationId: string, botId: string): Promise<any> {
    // Get bot details for working hours and restrictions
    const bot = await this._botsRepository.getBotById(botId, organizationId);
    if (!bot) {
      return { found: false, error: 'Bot not found' };
    }

    // Check working hours
    const workingHours = JSON.parse(
      bot.workingHours ||
        '[[540,1020],[540,1020],[540,1020],[540,1020],[540,960],[],[]]',
    );
    const isWithinHours = isWithinWorkingHours(workingHours, bot.timezone);
    const timeUntilWorkingHours = !isWithinHours
      ? getTimeUntilWorkingHours(workingHours, bot.timezone)
      : 0;

    // Check for active restrictions
    const activeRestrictions =
      await this._botsRepository.getActiveRestrictions(botId);

    // Get temporal workflow status
    const handle = await this._temporal
      .getClient()
      .getWorkflowHandle(`user-throttler-${botId}`);

    const workflow = await awaitedTryCatch(() => handle.describe());

    if (!workflow) {
      return {
        found: false,
        workingHours: {
          isWithinHours,
          timeUntilWorkingHours:
            timeUntilWorkingHours > 0
              ? new Date(Date.now() + timeUntilWorkingHours)
              : null,
        },
        restrictions: activeRestrictions,
      };
    }

    if (workflow?.typedSearchAttributes?.get(orgId) !== organizationId) {
      return { found: false };
    }

    const query = await handle.query(botJobsQueries);
    if (query) {
      // Get workflow and step details
      let stepDetails: any = null;
      if (query.workflowId && query.stepId) {
        stepDetails = await this._botsRepository.getWorkflowStepDetails(
          query.workflowId,
          query.stepId,
          organizationId,
        );
      }

      return {
        ...query,
        workingHours: {
          isWithinHours,
          timeUntilWorkingHours:
            timeUntilWorkingHours > 0
              ? new Date(Date.now() + timeUntilWorkingHours)
              : null,
        },
        restrictions: activeRestrictions,
        stepDetails,
        when: query.when,
        found: true,
      };
    }

    return {
      found: false,
      workingHours: {
        isWithinHours,
        timeUntilWorkingHours:
          timeUntilWorkingHours > 0
            ? new Date(Date.now() + timeUntilWorkingHours)
            : null,
      },
      restrictions: activeRestrictions,
    };
  }
}

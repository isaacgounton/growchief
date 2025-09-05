import { Page, Locator } from 'patchright';
import { HumanTypingOptions } from '@growchief/shared-backend/bots/typing.tool';
import { timer } from '@growchief/shared-both/utils/timer';
import { Tool } from '@growchief/shared-both/utils/tool.decorator';
import { ProgressResponse } from '@growchief/shared-backend/temporal/progress.response';
import { EnrichmentReturn } from '@growchief/shared-backend/enrichment/enrichment.interface';
import {
  SubjectsAllowed,
  SubjectsInterface,
} from '@growchief/shared-backend/plugs/ai/subjects.ai';
type Exact<T, U extends T> = U;

export interface SpecialEvents {
  page: Page;
  click: (
    event: string | Locator,
    spreadOverride?: number,
    nativeClientRect?: boolean,
  ) => Promise<void>;
  saveActions: (actions: ActionList[]) => Promise<void>;
  move: (
    event: string | Locator,
    spreadOverride?: number,
    nativeClientRect?: boolean,
  ) => Promise<void>;
  setDataVariables: (lead: { firstName: string; lastName: string }) => void;
  simpleMove: (event: string | Locator) => Promise<void>;
  simpleMoveAndClick: (event: string | Locator) => Promise<void>;
  scrollToElement: (element: string, num?: number) => Promise<any>;
  type(text: string, options?: HumanTypingOptions): Promise<void>;
  startMouse(): void;
  endMouse(): void;
  ai: {
    getAllowedSubjects: (
      subjects: SubjectsInterface[],
      positive: string,
      negative: string,
      isQuote?: boolean,
    ) => Promise<SubjectsAllowed[]>;
    comment: (
      prompt: string,
      text: string,
      sentiment?: string,
      isQuote?: boolean,
    ) => Promise<string | undefined>;
    extract: (text: string) => Promise<string>;
  };
  checkUsed(
    params: { type: string; id: string; userUrl?: string }[],
    isQuote?: boolean,
  ): Promise<{ found: boolean; internalId: string; type: string }[]>;
  waitForCookie(name: string, timeout?: number): Promise<string>;
  getData: () => any;
  scrollUntilElementIsVisible: (element: string) => Promise<true>;
  pause: () => void;
  resume: () => void;
}

export type RunEnrichment = Omit<Required<EnrichmentReturn>, 'url'> & {
  degree: number;
  pending: boolean;
};

export type RequireField<T, K extends keyof T> = T & { [P in K]-?: T[P] };

export abstract class BotAbstract {
  abstract identifier: string;
  abstract label: string;
  abstract initialPage: string;
  abstract headful: boolean;
  abstract disconnectedElement: string;
  abstract delay: number;
  abstract preventLoadingImages: boolean;
  abstract urlRegex: RegExp;
  abstract order: number;
  abstract isWWW: boolean;
  abstract searchURL?: {
    description: string;
    regex: RegExp[];
  };

  [key: string]:
    | string
    | number
    | boolean
    | RegExp
    | {
        description: string;
        regex: RegExp[];
      }
    | undefined
    | ((
        params: ParamsValue,
        lead: RunEnrichment,
      ) => Promise<
        | RunEnrichment
        | false
        | { picture: string; name: string; id: string }
        | ProgressResponse
      >);

  abstract accountLimited(
    params: ParamsValue,
  ): Promise<Omit<Required<ProgressResponse>, 'leads'> | false>;

  abstract processLead(params: ParamsValue): Promise<RunEnrichment | false>;

  async leadList(
    params: ParamsValue,
  ): Promise<RequireField<ProgressResponse, 'leads'>> {
    return {
      endWorkflow: true,
      delay: 0,
      repeatJob: false,
      leads: [],
    };
  }

  abstract login(
    params: ParamsValue,
  ): Promise<false | { picture: string; name: string; id: string }>;

  public async screenShare(params: ParamsValue): Promise<ProgressResponse> {
    params.cursor.startMouse();
    await timer(3600000);
    return {
      endWorkflow: false,
      delay: 0,
      repeatJob: false,
    };
  }
}

export interface ParamsValue {
  page: Page;
  cursor: SpecialEvents;
  data?: any;
}

export type ExactParams = Exact<ParamsValue, ParamsValue>;

export type CheckAction = (
  check: { type: string; id: string }[],
  isQuote?: boolean,
) => Promise<{ found: boolean; internalId: string; type: string }[]>;

export interface ActionList {
  id: string;
  href?: string;
  type: string;
  comment: string;
}

export interface BotsRequestSetupDefault {
  bot: string;
  groupId: string;
  platform: string;
  organizationId: string;
  deadline?: number;
  url: string;
  leadId: string;
  proxyId?: string;
  appendUrl?: string;
  ignoreLead?: boolean;
  timezone?: number;
}

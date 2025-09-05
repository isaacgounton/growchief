import { CDPSession, Page } from 'patchright';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import {
  ActionList,
  type ParamsValue,
  RunEnrichment,
  SpecialEvents,
} from '@growchief/shared-backend/bots/bots.interface';
import { BotsService } from '@growchief/shared-backend/database/bots/bots.service';
import { timer } from '@growchief/shared-both/utils/timer';
import { ProgressResponse } from '@growchief/shared-backend/temporal/progress.response';
import { LeadsService } from '@growchief/shared-backend/database/leads/leads.service';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export class BotTools {
  constructor(
    protected _botService: BotsService,
    protected _leadsService: LeadsService,
  ) {}

  protected async processLead(
    id: string,
    func: () => Promise<RunEnrichment | false>,
  ): Promise<RunEnrichment | false> {
    try {
      const value = await func();
      if (!value) {
        return false;
      }
      await this._leadsService.updateLead(id, value);
      return value;
    } catch (err) {}
    return false;
  }

  protected _isProxyUnavailable(
    page: Page,
    initialUrl: string,
    proxy: { username: string; server: string; password: string } | false,
  ) {
    return new Promise<'proxy'>(async (resolve) => {
      try {
        if (proxy) {
          try {
            const proxyUrl = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.server}`;
            const agent = new HttpsProxyAgent(proxyUrl);
            await axios.get('https://example.com', {
              httpsAgent: agent,
              proxy: false,
              timeout: 5000,
            });
          } catch (err) {
            console.log(err);
            resolve('proxy');
          }
        }
        page.on('requestfailed', (req) => {
          const url = req.url();
          if (url === initialUrl || url === initialUrl + '/') {
            console.log('err');
            resolve('proxy');
          }
        });
      } catch (err) {}
    });
  }

  protected async _navigateOutSideOfScope(
    page: Page,
    originalUrl: string,
  ): Promise<ProgressResponse> {
    try {
      await page.waitForURL(
        (url: URL) => {
          if (url.href === 'about:blank') {
            return false;
          }

          return url.origin.indexOf(originalUrl) === -1;
        },
        {
          timeout: 0,
        },
      );

      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: true,
      };
    } catch (err) {}

    return {
      delay: 0,
      repeatJob: false,
      endWorkflow: true,
    };
  }

  protected _scaleCoordinates(
    originalX: number,
    originalY: number,
    originalWidth: number,
    originalHeight: number,
    newWidth: number,
    newHeight: number,
  ) {
    const newX = (originalX / originalWidth) * newWidth;
    const newY = (originalY / originalHeight) * newHeight;
    return { x: newX, y: newY };
  }

  // Jobs should not run more than 4 minutes, if they do, just close it, we can try again later.
  protected async _maximumJobTime<T>(
    abortSignal: AbortSignal,
    maxTime: number,
    returnType: T,
  ) {
    return new Promise<T>(async (res, rej) => {
      try {
        abortSignal.addEventListener('abort', () => {
          rej(new Error('aborted'));
        });
        await timer(maxTime);
        return res(returnType);
      } catch (err) {}
    });
  }

  // this is a function that will check all the time if we are not logged in, it will throw an error, we need to catch it locally
  protected _checkForLoginElement(
    check: boolean,
    page: Page,
    element: string,
  ): Promise<'logout'> {
    if (!check) {
      return new Promise((res) => {});
    }

    return new Promise(async (res) => {
      while (true) {
        try {
          if (page.isClosed()) {
            return;
          }
          const elm = page.locator(element).first();
          await elm.waitFor({
            timeout: 0,
          });

          res('logout');
          return 'logout';
        } catch (err) {}
      }
    });
  }

  // this is an important function because if we close the puppeteer page, it will throw an error, we need to catch it locally
  protected async _functionToRun(
    run: any,
    method: string,
    page: Page,
    saveLog$: Subject<{ message: string; type: string; args: string[] }>,
  ): Promise<
    | false
    | { type: 'ui-error'; message: string; path: string }
    | { picture: string; name: string }
    | ProgressResponse
  > {
    try {
      const toRun = await run();
      return toRun;
    } catch (err) {
      console.log('err', err);
      if (!page.isClosed()) {
        return {
          delay: 20000,
          endWorkflow: false,
          repeatJob: true,
        };
      }
      return method === 'login'
        ? false
        : {
            delay: 0,
            endWorkflow: true,
            repeatJob: false,
          };
    }
  }

  protected async _findRestrictions(
    params: ParamsValue,
    func: (params: ParamsValue) => Promise<Required<ProgressResponse> | false>,
  ): Promise<Required<ProgressResponse> | false> {
    try {
      while (true) {
        const test = await func(params);
        if (test) {
          return test;
        }
        await timer(5000);
      }
    } catch (err) {
      return false;
    }
  }

  protected async _unsubscribeAll(
    cursor: SpecialEvents,
    screenshots$?: BehaviorSubject<string | null>,
    killEverything$?: Subject<'kill'>,
    clickScreen$?: Subscription,
    saveLog$?: Subject<{ message: string; type: string; args: string[] }>,
    client?: CDPSession | false,
  ) {
    try {
      cursor.endMouse();
    } catch (err) {}
    try {
      clickScreen$?.unsubscribe();
    } catch (err) {}
    try {
      if (screenshots$) {
        screenshots$.next('stop');
      }
    } catch (err) {}
    try {
      if (screenshots$) {
        screenshots$.unsubscribe();
      }
    } catch (err) {}
    try {
      if (saveLog$) {
        saveLog$.unsubscribe();
      }
    } catch (err) {}
    try {
      if (killEverything$) {
        killEverything$.complete();
      }
    } catch (err) {}
    try {
      if (client) {
        await client.send('Page.stopScreencast');
      }
    } catch (err) {}
  }
}

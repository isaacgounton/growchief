import dayjs from 'dayjs';
import { getName } from 'country-list';
import { sortBy } from 'lodash';
import { ProxyProviderInterface } from '@growchief/shared-backend/proxies/proxy.provider.interface';
import { makeId } from '@growchief/shared-both/utils/make.id';
import { timer } from '@growchief/shared-both/utils/timer';

const uniqIdentifier = 'isp';

type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options';

type BrightDataClient = {
  [K in HttpMethod]: <T = unknown>(
    input: string,
    body?: unknown,
  ) => Promise<{ data: T }>;
};

export const brightData: BrightDataClient = new Proxy({} as BrightDataClient, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== 'string') return undefined;

    const method = prop.toUpperCase();
    return async <T = unknown>(
      input: string,
      body?: unknown,
    ): Promise<{ data: T }> => {
      const res = await fetch(`https://api.brightdata.com${input}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
        },
      });

      // safer: handle 204 / non-JSON responses
      // @ts-ignore
      if (res.status === 204) return undefined as { data: T };
      return { data: await res.json() } as { data: T };
    };
  },
});

export class BrightDataProvider
  implements ProxyProviderInterface<{ zone: string }>
{
  identifier = 'brightdata';
  label = 'Bright Data';

  connectURL() {
    return 'brd.superproxy.io:33335';
  }

  async whiteListIp(data: { zone: string; ip: string }): Promise<any> {
    const { ip } = await (
      await fetch('https://api.ipify.org?format=json')
    ).json();

    return brightData.post('/zone/whitelist', {
      ip,
      zone: data.zone,
    });
  }

  async countryList(): Promise<{ identifier: string; label: string }[]> {
    const data = (await brightData.get<any>('/countrieslist')).data;
    return sortBy(
      data.zone_type.ISP_dedicated_ip.country_codes.map((p: any) => ({
        identifier: p,
        label: getName(p),
      })),
      (p) => p.label,
    );
  }

  private async _createZone(country: string, randomId: string) {
    await brightData.post('/zone', {
      zone: {
        name: country + '_' + uniqIdentifier + '_' + randomId,
        type: 'isp',
      },
      plan: {
        type: 'static',
        product: 'res_static',
        pool_ip_type: 'static_res',
        start: dayjs.utc().format('YYYY-MM-DDTMM:mm:ss') + 'Z',
        ips_type: 'dedicated',
        bandwidth: 'unlimited',
        unl_bw_tiers: 'std',
        ips: 0,
        country,
        auto_cost_override: {
          ip_bw: 4,
          price_group: 'dedicated',
        },
      },
    });

    if (process.env.BRIGHTDATA_STATIC_PROXY_IPS) {
      const ips = (process.env.BRIGHTDATA_STATIC_PROXY_IPS || '').split(',');
      for (const ip of ips) {
        await this.whiteListIp({
          zone: country + '_' + uniqIdentifier + '_' + randomId,
          ip,
        });

        await timer(1000);
      }
    }

    return (
      await brightData.post<any>('/zone/ips', {
        customer: process.env.BRIGHTDATA_CUSTOMER,
        zone: country + '_' + uniqIdentifier + '_' + randomId,
        count: 1,
        country,
      })
    ).data.new_ips.pop();
  }

  async createProxy(
    country: string,
  ): Promise<{ ip: string; password: string; username: string; data: any }> {
    const activeZones = (await brightData.get<any>('/zone/get_active_zones'))
      .data;
    const random = makeId(3).toLowerCase();
    const findZone = activeZones.find(
      (p: any) => p.name.indexOf(country + '_' + uniqIdentifier) > -1,
    );

    const ip = findZone
      ? (
          await brightData.post<any>('/zone/ips', {
            customer: process.env.BRIGHTDATA_CUSTOMER,
            zone: findZone.name,
            count: 1,
            country,
          })
        ).data.new_ips.pop()
      : await this._createZone(country, random);

    const zoneName = findZone
      ? findZone.name
      : country + '_' + uniqIdentifier + '_' + random;
    const getZone = (await brightData.get<any>(`/zone?zone=${zoneName}`)).data;

    return {
      ip,
      password: getZone.password[0] as string,
      username: `brd-customer-${process.env.BRIGHTDATA_CUSTOMER}-zone-${zoneName}-ip-${ip}`,
      data: {
        zone: zoneName,
      },
    };
  }

  async deleteProxy(ip: string, data: { zone: string }): Promise<any> {
    const activeZones = (await brightData.get<any>(`/zone?zone=${data.zone}`))
      .data;
    await brightData.delete(`/zone/ips`, {
      data: {
        zone: data.zone,
        ips: [ip],
      },
    });

    if (activeZones.ips.length === 1) {
      await brightData.delete(`/zone`, {
        data: {
          zone: data.zone,
        },
      });
    }

    return true;
  }

  async getAllIps(): Promise<{ ip: string; data: any }[]> {
    const list: { name: string }[] = (
      await brightData.get<any>('/zone/get_active_zones')
    ).data;
    return Promise.all<{ ip: string; data: string }>(
      list.flatMap(async (p) => {
        return (
          await brightData.get<any>(`/zone/ips?zone=${p.name}`)
        ).data.ips.flatMap((p: any) => ({ ip: p.ip, data: p.name }));
      }),
    );
  }
}

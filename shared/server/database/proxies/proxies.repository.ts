import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@growchief/shared-backend/database/prisma';

@Injectable()
export class ProxiesRepository {
  constructor(
    private _proxy: PrismaRepository<'proxy'>,
    private _bot: PrismaRepository<'bot'>,
  ) {}

  async createProxy(
    identifier: string,
    organizationId: string,
    ip: string,
    username: string,
    password: string,
    data: any,
    country: string,
    server: string,
  ) {
    return this._proxy.model.proxy.create({
      data: {
        provider: identifier,
        organizationId,
        ip,
        username,
        password,
        data: JSON.stringify(data),
        country,
        server,
      },
    });
  }
  async getProxiesByOrganization(organizationId: string) {
    return this._proxy.model.proxy.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        ip: true,
        provider: true,
        country: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            bots: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getProxyById(id: string, organizationId: string) {
    return this._proxy.model.proxy.findFirst({
      where: {
        id,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        ip: true,
        provider: true,
        server: true,
        username: true,
        password: true,
        country: true,
        createdAt: true,
        updatedAt: true,
        data: true,
        bots: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            platform: true,
          },
        },
      },
    });
  }

  getProxyByOrgIp(organizationId: string, ip: string) {
    return this._proxy.model.proxy.findFirst({
      where: {
        organizationId,
        ip,
      },
    });
  }

  async getProxiesCount(organizationId: string) {
    return this._proxy.model.proxy.count({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  async createCustomProxy(
    organizationId: string,
    serverAddress: string,
    username: string,
    password: string,
  ) {
    // Extract IP from server address (remove port if present)
    const ip = serverAddress.split(':')[0];

    return this._proxy.model.proxy.create({
      data: {
        ip,
        data: JSON.stringify({
          serverAddress,
          username,
          password,
        }),
        provider: 'custom',
        organizationId,
        username,
        password,
        country: 'custom',
        server: serverAddress,
      },
      select: {
        id: true,
        ip: true,
        provider: true,
        country: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            bots: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
    });
  }

  async deleteProxy(organizationId: string, ip: string) {
    await this._proxy.model.proxy.updateMany({
      where: {
        organizationId,
        ip,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    await this._bot.model.bot.updateMany({
      where: {
        proxy: {
          ip,
          organizationId,
        },
      },
      data: {
        proxyId: null,
      },
    });
  }

  getAllProxiesByOrganization(organizationId: string) {
    return this._proxy.model.proxy.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        ip: true,
        provider: true,
        country: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async canAddProxy(organizationId: string, currentTotal: number) {
    const totalProxies = await this._proxy.model.proxy.count({
      where: {
        organizationId,
        provider: {
          not: 'custom',
        },
        deletedAt: null,
      },
    });

    return totalProxies < currentTotal;
  }

  totalProxies(organizationId: string) {
    return this._proxy.model.proxy.count({
      where: {
        organizationId,
        provider: {
          not: 'custom',
        },
        deletedAt: null,
      },
    });
  }
}

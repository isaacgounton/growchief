import {
  EnrichmentInterface,
  EnrichmentReturn,
} from '@growchief/shared-backend/enrichment/enrichment.interface';

export class DatagmaEnrichment implements EnrichmentInterface {
  name = 'Datagma';
  priority = 1;
  supportedIdentifiers = ['linkedin', 'x'];
  get apiKey() {
    return process.env.DATAGMA_API_KEY;
  }

  async enrich(
    platform: string,
    {
      firstName,
      lastName,
      email,
    }: {
      firstName?: string;
      lastName?: string;
      email: string;
      organization_name?: string;
    },
  ): Promise<EnrichmentReturn | false | { delay: number }> {
    if (platform === 'linkedin') {
      const listQuery = {
        ...(firstName && lastName
          ? { firstName: firstName, lastName: lastName }
          : {}),
        ...(email ? { data: email } : {}),
      };

      if (Object.keys(listQuery).length === 0) {
        return false;
      }

      const list = new URLSearchParams(listQuery).toString();

      const value = await (
        await fetch(
          `https://gateway.datagma.net/api/ingress/v2/full?companyPremium=false&companyFull=false&companyFrench=false&apiId=${process.env.DATAGMA_API_KEY}&${list}`,
          {
            method: 'GET',
            headers: {
              accept: 'application/json',
            },
          },
        )
      ).json();

      if (!value?.person?.basic?.linkedInUrl) {
        return false;
      }

      return {
        firstName: value.person.basic.firstName,
        lastName: value.person.basic.lastName,
        url: value.person.basic.linkedInUrl,
        picture: '',
      };
    } else if (platform === 'x') {
      const listQuery = {
        ...(email ? { data: email } : {}),
      };

      if (Object.keys(listQuery).length === 0) {
        return false;
      }

      const list = new URLSearchParams(listQuery).toString();

      const value = await (
        await fetch(
          `https://gateway.datagma.net/api/ingress/v1/twitter/by_email?apiId=${process.env.DATAGMA_API_KEY}&${list}`,
          {
            method: 'GET',
            headers: {
              accept: 'application/json',
            },
          },
        )
      ).json();

      if (!value?.twitter?.username) {
        return false;
      }

      const [firstName, lastName] = (value?.other?.fullName || '').split(' ');

      return {
        firstName: firstName || '',
        lastName: lastName || '',
        url: 'https://x.com/' + value.twitter.username.replace('@', ''),
        picture: '',
      };
    }

    return false;
  }
}

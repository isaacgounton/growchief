import {
  EnrichmentInterface,
  EnrichmentReturn,
} from '@growchief/shared-backend/enrichment/enrichment.interface';
import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';

export class HunterEnrichment implements EnrichmentInterface {
  name = 'Hunter';
  priority = 1;
  supportedIdentifiers = ['linkedin'];

  get apiKey() {
    return process.env.HUNTER_API_KEY;
  }

  async enrich(
    platform: string,
    { email }: EnrichmentDto,
  ): Promise<EnrichmentReturn | false | { delay: number }> {
    const listQuery = {
      ...(email ? { email } : {}),
    };

    if (Object.keys(listQuery).length === 0) {
      return false;
    }

    const list = new URLSearchParams(listQuery).toString();
    const req = await fetch(
      `https://api.hunter.io/v2/people/find?${list}&api_key=${process.env.HUNTER_API_KEY}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
        },
      },
    );

    if (req.status === 403) {
      return { delay: 2000 };
    }

    const value = await req.json();

    if (
      !value?.data?.id ||
      !value?.data?.linkedin?.handle ||
      platform !== 'linkedin'
    ) {
      return false;
    }

    const [firstName, ...lastName] = value?.data?.name?.fullName || '';

    return {
      firstName: firstName || '',
      lastName: lastName.join(' ') || '',
      url: 'https://www.linkedin.com/in/' + value?.data?.linkedin?.handle,
      picture: '',
    };
  }
}

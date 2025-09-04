import {
  EnrichmentInterface,
  EnrichmentReturn,
} from '@growchief/shared-backend/enrichment/enrichment.interface';
import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';

export class ApolloEnrichment implements EnrichmentInterface {
  name = 'Apollo';
  priority = 1;
  supportedIdentifiers = ['linkedin'];

  get apiKey() {
    return process.env.APOLLO_API_KEY;
  }

  async enrich(
    platform: string,
    { firstName, lastName, email, organization_name }: EnrichmentDto,
  ): Promise<EnrichmentReturn | false> {
    const listQuery = {
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(email ? { email } : {}),
      ...(organization_name ? { organization_name } : {}),
    };

    if (Object.keys(listQuery).length === 0) {
      return false;
    }

    const list = new URLSearchParams(listQuery).toString();
    const value = await (
      await fetch(
        `https://api.apollo.io/api/v1/people/match?reveal_personal_emails=false&reveal_phone_number=false&${list}`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
            'x-api-key': process.env.APOLLO_API_KEY!,
          },
        },
      )
    ).json();

    if (
      !value?.person?.id ||
      !value.person.linkedin_url ||
      platform !== 'linkedin'
    ) {
      return false;
    }

    return {
      firstName: value.person.first_name,
      lastName: value.person.last_name,
      url: value.person.linkedin_url,
      picture: value.person.photo_url,
    };
  }
}

import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';

export interface EnrichmentInterface {
  name: string;
  priority: number;
  supportedIdentifiers: string[];
  apiKey?: string;
  enrich(
    platform: string,
    params: EnrichmentDto,
  ): Promise<EnrichmentReturn | false | { delay: number }>;
}

export interface EnrichmentReturn {
  firstName?: string;
  lastName?: string;
  url: string;
  picture?: string;
}

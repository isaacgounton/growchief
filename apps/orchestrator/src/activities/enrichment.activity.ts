import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EnrichmentDto } from '@growchief/shared-both/dto/enrichment/enrichment.dto';
import { providerList } from '@growchief/shared-backend/enrichment/provider.list';

@Injectable()
@Activity()
export class EnrichmentActivity {
  @ActivityMethod()
  async enrich(name: string, platform: string, value: EnrichmentDto) {
    const enrichProvider = providerList.find((p) => p.name === name)!;
    return enrichProvider.enrich(platform, value);
  }

  @ActivityMethod()
  async enrichments() {
    return providerList.filter((f) => f.apiKey);
  }
}

import { defineCampaignTemplate, renderCampaignTemplate, type CampaignChannel } from '@lead-finder/shared';

export interface SimulatedMessage {
  mode: 'SIMULATION';
  channel: CampaignChannel;
  content: string;
  dispatched: false;
}

export const simulateCampaignMessage = (input: {
  channel: CampaignChannel; content: string; allowedVariables: readonly string[]; values: Readonly<Record<string, string>>;
}): SimulatedMessage => ({
  mode: 'SIMULATION', channel: input.channel,
  content: renderCampaignTemplate(defineCampaignTemplate(input.content, input.allowedVariables), input.values),
  dispatched: false,
});

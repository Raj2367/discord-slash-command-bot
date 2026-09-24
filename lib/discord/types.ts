export enum DiscordInteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export interface DiscordInteractionDataOption {
  name: string;
  type: number;
  value: string | number | boolean;
  options?: DiscordInteractionDataOption[];
}

export interface DiscordInteractionData {
  id: string;
  name: string;
  type: number;
  options?: DiscordInteractionDataOption[];
}

export interface DiscordRawInteraction {
  id: string;
  application_id: string;
  type: number;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  data?: DiscordInteractionData;
  [key: string]: any;
}

export type ParsedInteraction =
  | { type: "PING" }
  | {
      type: "APPLICATION_COMMAND";
      id: string;
      applicationId: string;
      token?: string;
      guildId?: string;
      channelId?: string;
      commandName: string;
      options: Record<string, any>;
      rawOptions?: DiscordInteractionDataOption[];
    };

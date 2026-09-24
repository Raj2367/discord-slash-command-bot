import { DiscordRawInteraction, ParsedInteraction, DiscordInteractionType } from "./types";

export function parseInteraction(rawBody: string | object): ParsedInteraction {
  let json: DiscordRawInteraction;

  if (typeof rawBody === "string") {
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid JSON interaction payload.");
    }
  } else if (rawBody && typeof rawBody === "object") {
    json = rawBody as DiscordRawInteraction;
  } else {
    throw new Error("Interaction payload must be a string or object.");
  }

  if (!json || typeof json !== "object") {
    throw new Error("Interaction payload is malformed.");
  }

  const { id, application_id, type, token, guild_id, channel_id, data } = json;

  if (type === DiscordInteractionType.PING) {
    if (!id || !application_id) {
      throw new Error("Missing required fields for PING interaction.");
    }
    return { type: "PING" };
  }

  if (type === DiscordInteractionType.APPLICATION_COMMAND) {
    if (!id || !application_id || !data || typeof data.name !== "string") {
      throw new Error("Missing required fields for APPLICATION_COMMAND interaction.");
    }

    const commandName = data.name.trim().toLowerCase();
    if (commandName !== "status" && commandName !== "report") {
      throw new Error(`Unknown command: ${commandName}`);
    }

    const optionsMap: Record<string, any> = {};
    if (Array.isArray(data.options)) {
      for (const opt of data.options) {
        if (opt && typeof opt.name === "string") {
          optionsMap[opt.name] = opt.value;
        }
      }
    }

    if (commandName === "report") {
      let textVal = optionsMap["text"];
      if (textVal === undefined && Array.isArray(data.options) && data.options.length > 0) {
        textVal = data.options[0]?.value;
      }
      if (textVal !== undefined) {
        optionsMap["text"] = String(textVal);
      } else {
        delete optionsMap["text"];
      }
    }

    return {
      type: "APPLICATION_COMMAND",
      id,
      applicationId: application_id,
      token,
      guildId: guild_id,
      channelId: channel_id,
      commandName,
      options: optionsMap,
      rawOptions: data.options,
    };
  }

  throw new Error(`Unsupported interaction type: ${type}`);
}

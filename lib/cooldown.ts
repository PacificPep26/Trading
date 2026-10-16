declare global {
  var telegramCooldown: Map<string, number> | undefined;
}

export const cooldownMap = (globalThis.telegramCooldown ??= new Map<string, number>());


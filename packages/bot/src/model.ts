/**
 * Public surface of the bot's saved config and its command engine.
 * The pieces live in config.ts and engine.ts; this file keeps the import path stable.
 */
export {
  BOT_SCOPES,
  DEFAULT_PORTAL_PORT,
  PORTAL_SCOPES,
  commandName,
  defaultAccounts,
  defaultBotFile,
  defaultFilters,
  defaultShoutout,
  normalizeBotFile,
  normalizeCommand,
  normalizeFilters,
  normalizeShoutout,
  normalizeTimer,
  portalBase,
  timerMessagesFrom,
  validateBotServerUrl,
} from "./config.ts";
export type {
  BotAccountMode,
  BotAccounts,
  BotCommand,
  BotDecision,
  BotFile,
  BotFilters,
  BotTimer,
  ChannelFacts,
  ChatHook,
  ChatLine,
  FilterAction,
  FilterWord,
  HelixLookup,
  ModLogEntry,
  PlatformTarget,
  Quote,
  ShoutoutSettings,
  ThanksSettings,
  TimerMode,
  TimerPhase,
  UserLevel,
} from "./config.ts";
export {
  activePhase,
  advanceTimer,
  countTimerLine,
  decideChat,
  dueTimers,
  emptyMemory,
  levelAllows,
  timerIsDue,
  timerMessage,
} from "./engine.ts";
export type { DecideExtra, RuntimeMemory } from "./engine.ts";
export { expandTemplate } from "./template.ts";
export { defaultThanks, THANK_KINDS, type ThankKind } from "./thanks.ts";

import { botStage } from "./bot";
import { chatStage } from "./chat";
import { redemptionsStage } from "./redemptions";
import type { AppContext, StageModule } from "./types";

/**
 * Stage 2 serves channel-point alerts on /overlay/alerts.
 * Stage 3 serves the on-stream chat page and the tts-queue desk.
 * Stage 4 runs the chat bot and the mod portal.
 */
export const stages: StageModule[] = [redemptionsStage, chatStage, botStage];

export async function startStages(ctx: AppContext): Promise<void> {
  for (const stage of stages) {
    await stage.start(ctx);
    ctx.log.info("stage started", { id: stage.id });
  }
}

export async function stopStages(ctx: AppContext): Promise<void> {
  for (const stage of [...stages].reverse()) await stage.stop?.(ctx);
}

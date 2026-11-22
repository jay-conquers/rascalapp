import { RedeemEngine } from "../redeems/engine";
import type { AppContext, StageModule } from "./types";

let engine: RedeemEngine | null = null;

export function getRedeemEngine(): RedeemEngine | null {
  return engine;
}

export const redemptionsStage: StageModule = {
  id: "redemptions",
  async start(ctx: AppContext) {
    engine = new RedeemEngine(ctx);
    await engine.start();
  },
  async stop() {
    await engine?.stop();
    engine = null;
  },
};

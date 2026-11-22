import type { RascalApi } from "../shared/api";

declare global {
  interface Window {
    rascal?: RascalApi;
  }
}

export {};

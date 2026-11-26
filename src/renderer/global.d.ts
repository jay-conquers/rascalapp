import type { RascalApi } from "../shared/api";

declare global {
  interface Window {
    rascal?: RascalApi;
  }
}

declare module "*.svg?raw" {
  const content: string;
  export default content;
}

export {};

import type { ChatPlatform } from "./types.ts";

/** In-process list of chat platforms. One id, one adapter. */
export class PlatformRegistry<T extends { readonly id: string } = ChatPlatform> {
  private readonly byId = new Map<string, T>();

  register(platform: T): void {
    const id = platform.id.trim();
    if (!id) throw new Error("A chat platform needs an id.");
    if (this.byId.has(id)) throw new Error(`Platform ${id} is already registered.`);
    this.byId.set(id, platform);
  }

  get(id: string): T | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(): T[] {
    return [...this.byId.values()];
  }

  unregister(id: string): void {
    this.byId.delete(id);
  }

  clear(): void {
    this.byId.clear();
  }
}

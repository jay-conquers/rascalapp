import { MAX_CHAT_MESSAGES } from "../shared/defaults";
import type { ChatMessage, Platform } from "../shared/types";

export class ChatBus {
  readonly messages: ChatMessage[] = [];
  private seen = new Set<string>();
  private onMessage: (message: ChatMessage) => void = () => {};
  private onDelete: (id: string) => void = () => {};
  private onClear: (platform: Platform, username?: string) => void = () => {};
  private onReplace: (message: ChatMessage) => void = () => {};
  private extras = new Set<{
    onMessage: (message: ChatMessage) => void;
    onDelete: (id: string) => void;
    onClear: (platform: Platform, username?: string) => void;
  }>();

  setHandlers(handlers: {
    onMessage: (message: ChatMessage) => void;
    onDelete: (id: string) => void;
    onClear: (platform: Platform, username?: string) => void;
    onReplace?: (message: ChatMessage) => void;
  }): void {
    this.onMessage = handlers.onMessage;
    this.onDelete = handlers.onDelete;
    this.onClear = handlers.onClear;
    this.onReplace = handlers.onReplace ?? (() => {});
  }

  /** Extra listeners for stages. The desk handler registered with setHandlers still runs. */
  subscribe(handlers: {
    onMessage?: (message: ChatMessage) => void;
    onDelete?: (id: string) => void;
    onClear?: (platform: Platform, username?: string) => void;
  }): () => void {
    const row = {
      onMessage: handlers.onMessage ?? (() => {}),
      onDelete: handlers.onDelete ?? (() => {}),
      onClear: handlers.onClear ?? (() => {}),
    };
    this.extras.add(row);
    return () => this.extras.delete(row);
  }

  push(message: ChatMessage): void {
    if (this.seen.has(message.id)) return;
    this.seen.add(message.id);
    this.messages.push(message);
    if (this.messages.length > MAX_CHAT_MESSAGES) {
      const removed = this.messages.splice(0, this.messages.length - MAX_CHAT_MESSAGES);
      for (const old of removed) this.seen.delete(old.id);
    }
    this.onMessage(message);
    for (const extra of this.extras) extra.onMessage(message);
  }

  /** Swap a line in place. Used when a richer emote copy of the same notice arrives. */
  replace(id: string, message: ChatMessage): void {
    const index = this.messages.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.messages[index] = message;
    this.onReplace(message);
    for (const extra of this.extras) extra.onMessage(message);
  }

  delete(id: string): void {
    const message = this.messages.find((item) => item.id === id);
    if (!message || message.deleted) return;
    message.deleted = true;
    this.onDelete(id);
    for (const extra of this.extras) extra.onDelete(id);
  }

  clearUser(platform: Platform, username: string): void {
    const name = username.toLowerCase();
    let changed = false;
    for (const message of this.messages) {
      if (message.platform === platform && message.username.toLowerCase() === name && !message.deleted) {
        message.deleted = true;
        changed = true;
      }
    }
    if (changed) {
      this.onClear(platform, username);
      for (const extra of this.extras) extra.onClear(platform, username);
    }
  }

  clearAuthor(authorId: string): void {
    for (const message of this.messages) {
      if (message.authorId === authorId && !message.deleted) {
        message.deleted = true;
        this.onDelete(message.id);
        for (const extra of this.extras) extra.onDelete(message.id);
      }
    }
  }

  clearPlatform(platform: Platform): void {
    let changed = false;
    for (const message of this.messages) {
      if (message.platform === platform && !message.deleted) {
        message.deleted = true;
        changed = true;
      }
    }
    if (changed) {
      this.onClear(platform);
      for (const extra of this.extras) extra.onClear(platform);
    }
  }
}

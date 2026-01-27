import type { PluginRuntime } from "clawdbot/plugin-sdk";

// Use globalThis to persist runtime across module reloads
const RUNTIME_KEY = Symbol.for("clawdbot-feishu-runtime");

function getGlobalRuntime(): PluginRuntime | null {
  return (globalThis as Record<symbol, PluginRuntime | null>)[RUNTIME_KEY] ?? null;
}

function setGlobalRuntime(next: PluginRuntime | null): void {
  (globalThis as Record<symbol, PluginRuntime | null>)[RUNTIME_KEY] = next;
}

export function setFeishuRuntime(next: PluginRuntime): void {
  setGlobalRuntime(next);
}

export function getFeishuRuntime(): PluginRuntime {
  const runtime = getGlobalRuntime();
  if (!runtime) {
    throw new Error("Feishu runtime not initialized - plugin may need to be reloaded");
  }
  return runtime;
}

export function isFeishuRuntimeInitialized(): boolean {
  return getGlobalRuntime() !== null;
}

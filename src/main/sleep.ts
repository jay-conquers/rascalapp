export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbort(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

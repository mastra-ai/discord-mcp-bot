import retry from "async-retry-ng";

const TIMEOUT = 8000; // 8 seconds
const MAX_RETRIES = 3;

const fetchWithTimeout = async (
  url: string,
  options: RequestInit
): Promise<Response> => {
  const response = (await Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), TIMEOUT)
    ),
  ])) as Response;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
};

export const retryableFetch = async <T>(
  url: string,
  options: RequestInit
): Promise<T> => {
  return retry(
    async (bail: (error: Error) => void) => {
      try {
        const response = await fetchWithTimeout(url, options);
        const data = await response.json();
        return data as T;
      } catch (error: any) {
        if (
          error.message.includes("timeout") ||
          error.message.includes("429")
        ) {
          throw error; // Retry timeouts and rate limits
        }
        bail(error); // Don't retry other errors
        return null as T; // This will never be reached due to bail()
      }
    },
    {
      retries: MAX_RETRIES,
      minTimeout: 1000,
      maxTimeout: 5000,
      factor: 2,
      onRetry: (error: Error, ...args: any[]) => {
        const [attempt] = args;
        console.log(`Retry attempt ${attempt} due to:`, error.message);
      },
    }
  );
};

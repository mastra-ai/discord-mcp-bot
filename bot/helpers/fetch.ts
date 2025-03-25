import retry from "async-retry-ng";

const TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 5;

const fetchWithTimeout = async (
  url: string,
  options: RequestInit
): Promise<Response> => {
  try {
    const response = (await Promise.race([
      fetch(url, options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), TIMEOUT)
      ),
    ])) as Response;

    console.log(`Response status: ${response.status} for ${url}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error response body:`, errorText);
      throw new Error(
        `HTTP ${response.status}: ${response.statusText} - ${errorText}`
      );
    }

    return response;
  } catch (error) {
    console.error("FetchWithTimeout error:", error);
    throw error;
  }
};

export const retryableFetch = async <T>(
  url: string,
  options: RequestInit
): Promise<T> => {
  return retry(
    async (bail: (error: Error) => void) => {
      try {
        console.log("Fetching:", url, "with method:", options.method);
        if (options.body) {
          console.log("Request body:", options.body);
        }
        console.log("Request headers:", options.headers);

        const response = await fetchWithTimeout(url, options);
        const text = await response.text();

        console.log("Raw response:", text);

        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          console.error("JSON parse error:", e);
          throw new Error(`Failed to parse JSON response: ${text}`);
        }

        console.log("Parsed response:", data);
        return data as T;
      } catch (error: any) {
        console.error("Fetch error details:", {
          message: error.message,
          stack: error.stack,
          url,
          method: options.method,
        });

        if (
          error.message.includes("timeout") ||
          error.message.includes("429") ||
          error.message.includes("500") ||
          error.message.includes("502") ||
          error.message.includes("503") ||
          error.message.includes("504")
        ) {
          console.log("Retryable error detected:", error.message);
          throw error; // Retry timeouts, rate limits, and server errors
        }
        console.error("Non-retryable error:", error.message);

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
        console.log(
          `Retry attempt ${attempt}/${MAX_RETRIES} due to:`,
          error.message
        );
      },
    }
  );
};

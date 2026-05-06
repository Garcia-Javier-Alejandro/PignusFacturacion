const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableError = (error) => {
  if (!error.response) {
    return true;
  }

  const status = error.response.status;
  return status === 429 || (status >= 500 && status <= 599);
};

export async function withRetry(operation, { retries = 3, baseDelayMs = 500 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetriableError(error) || attempt === retries) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`Request failed; retrying attempt ${attempt + 1}/${retries} in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
}

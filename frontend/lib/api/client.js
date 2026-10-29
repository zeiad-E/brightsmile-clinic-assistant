import axios from 'axios';

/**
 * One way to call the BrightSmile API, used by every page (server or browser).
 *   const services = await apiRequest('/services');
 *   await apiRequest('/me', { method: 'PATCH', body: { full_name: 'Mariam' }, token });
 * Success → the JSON body. Failure → throws ApiError with the API's own error code and message.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = the server could not be reached
    this.code = code; // e.g. 'slot_taken', 'validation_error'
    this.details = details;
  }
}

/**
 * A pre-configured axios: every request starts with the API address, JSON and a 30 s time limit.
 * On the server it calls the API directly; in the browser it calls /api on this site, which
 * next.config.mjs forwards to the API (so no cross-site request, no CORS).
 */
export const http = axios.create({
  baseURL: typeof window === 'undefined' ? `${API_URL}/api` : '/api',
  headers: { Accept: 'application/json' },
  timeout: 30_000,
});

// Interceptor = a checkpoint every response passes through. Here every failure becomes an ApiError,
// so pages handle errors one way, whatever went wrong.
http.interceptors.response.use(
  (response) => response,
  async (error) => {
    throw await toApiError(error);
  },
);

async function toApiError(error) {
  if (axios.isCancel(error)) return error; // we cancelled it ourselves (AbortController): not an API error

  if (error.response) {
    const data = await readBody(error.response.data);
    return new ApiError(
      error.response.status,
      data?.error ?? 'request_failed',
      data?.message ?? 'Something went wrong.',
      data?.details,
    );
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ApiError(0, 'timeout', 'The clinic server took too long to answer.');
  }
  return new ApiError(0, 'network_error', 'Could not reach the clinic server.');
}

/** Error bodies are usually JSON already; a streamed request (the chat) gets them as a stream. */
async function readBody(data) {
  if (typeof data?.getReader !== 'function') return data;
  try {
    return JSON.parse(await new Response(data).text());
  } catch {
    return null;
  }
}

export async function apiRequest(path, { method = 'GET', body, token, signal, timeout, headers = {} } = {}) {
  const response = await http.request({
    url: path,
    method,
    data: body,
    signal,
    timeout,
    headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
  });
  return response.status === 204 ? null : response.data;
}

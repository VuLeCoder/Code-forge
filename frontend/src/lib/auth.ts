export type AuthUser = {
  id: string;
  username: string;
  email: string;
  systemRole: "USER" | "ADMIN";
  status: "ACTIVE" | "LOCKED";
  createdAt: string;
};

type AuthResponse = { user: AuthUser };

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function readError(response: Response): Promise<ApiRequestError> {
  const fallback = response.status === 429
    ? "Bạn thao tác quá nhanh. Vui lòng chờ một chút rồi thử lại."
    : "Không thể kết nối với máy chủ. Vui lòng thử lại.";

  try {
    const body = await response.json() as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
      message?: string | string[];
    };
    const validationMessage = Array.isArray(body.message) ? body.message[0] : body.message;
    return new ApiRequestError(
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? validationMessage ?? fallback,
      response.status,
      body.error?.details ?? {},
    );
  } catch {
    return new ApiRequestError(`HTTP_${response.status}`, fallback, response.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/auth/${path}`, {
      ...init,
      credentials: "include",
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiRequestError("NETWORK_ERROR", "Không thể kết nối với máy chủ. Vui lòng kiểm tra mạng và thử lại.", 0);
  }

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const authApi = {
  register: (input: { username: string; email: string; password: string }) =>
    request<AuthResponse>("register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { login: string; password: string }) =>
    request<AuthResponse>("login", { method: "POST", body: JSON.stringify(input) }),
  me: () => request<AuthResponse>("me"),
  refresh: () => request<AuthResponse>("refresh", { method: "POST" }),
  logout: () => request<void>("logout", { method: "POST" }),
};

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) return "/";
  return value;
}

let pendingSession: Promise<AuthUser | null> | null = null;
let pendingRefresh: Promise<AuthResponse> | null = null;

function refreshSession(): Promise<AuthResponse> {
  if (!pendingRefresh) {
    pendingRefresh = authApi.refresh().finally(() => { pendingRefresh = null; });
  }
  return pendingRefresh;
}

// Repository callers use replayable JSON bodies. Retry only authentication failures,
// never network failures, which may occur after a mutation has already succeeded.
export async function sessionFetch(path: string, init?: RequestInit): Promise<Response> {
  const options = { ...init, credentials: "include" as const };
  const response = await fetch(path, options);
  if (response.status !== 401) return response;
  try {
    await refreshSession();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      throw new ApiRequestError("AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401);
    }
    throw error;
  }
  return fetch(path, options);
}

// Share bootstrap across Strict Mode effect remounts to avoid rotating one token twice.
export function bootstrapSession(): Promise<AuthUser | null> {
  if (!pendingSession) {
    pendingSession = authApi.me().catch(async (error: unknown) => {
      if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
      return refreshSession();
    }).then((result) => result.user).finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "Đã có lỗi không mong đợi. Vui lòng thử lại.";
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "Email, username hoặc mật khẩu chưa chính xác.",
    ACCOUNT_LOCKED: "Tài khoản này đã bị khóa. Vui lòng liên hệ quản trị viên.",
    ACCOUNT_ALREADY_EXISTS: "Username hoặc email này đã được sử dụng.",
    USERNAME_RESERVED: "Username này được dành riêng cho hệ thống. Vui lòng chọn tên khác.",
    ORIGIN_NOT_ALLOWED: "Yêu cầu không đến từ địa chỉ frontend được cho phép.",
    BACKEND_UNAVAILABLE: "Máy chủ đang khởi động hoặc tạm thời gián đoạn. Vui lòng thử lại sau ít phút.",
  };
  return messages[error.code] ?? error.message;
}

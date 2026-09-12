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
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "Đã có lỗi không mong đợi. Vui lòng thử lại.";
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "Email, username hoặc mật khẩu chưa chính xác.",
    ACCOUNT_LOCKED: "Tài khoản này đã bị khóa. Vui lòng liên hệ quản trị viên.",
    ACCOUNT_ALREADY_EXISTS: "Username hoặc email này đã được sử dụng.",
    ORIGIN_NOT_ALLOWED: "Yêu cầu không đến từ địa chỉ frontend được cho phép.",
    BACKEND_UNAVAILABLE: "Máy chủ đang khởi động hoặc tạm thời gián đoạn. Vui lòng thử lại sau ít phút.",
  };
  return messages[error.code] ?? error.message;
}

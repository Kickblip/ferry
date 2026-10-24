import { ZodError, type ZodType } from "zod"
import { authenticateApp, type App } from "@/lib/payments/api-keys"
import { ApiError } from "@/lib/payments/errors"
import { getServices, type Services } from "@/lib/payments/services"

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status })

type Handler<Ctx> = (
  request: Request,
  svc: Services,
  ctx: Ctx
) => Promise<Response>

/** Wraps a route handler: every failure becomes `{ error: { code, message } }`. */
export function route<Ctx>(handler: Handler<Ctx>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(request, await getServices(), ctx)
    } catch (err) {
      if (err instanceof ApiError) {
        return json(
          { error: { code: err.code, message: err.message } },
          err.status
        )
      }
      if (err instanceof ZodError) {
        return json(
          {
            error: {
              code: "invalid_request",
              message: "Invalid request",
              issues: err.issues,
            },
          },
          400
        )
      }
      console.error("[payments api]", err)
      return json(
        { error: { code: "internal_error", message: "Something went wrong" } },
        500
      )
    }
  }
}

/** For the game-server API: resolves the app from the bearer API key first. */
export function appRoute<Ctx>(
  handler: (
    request: Request,
    svc: Services,
    app: App,
    ctx: Ctx
  ) => Promise<Response>
) {
  return route<Ctx>(async (request, svc, ctx) =>
    handler(request, svc, await authenticateApp(svc.db, request), ctx)
  )
}

/** For /api/internal/*: cron and tooling only, guarded by INTERNAL_TOKEN. */
export function internalRoute<Ctx>(handler: Handler<Ctx>) {
  return route<Ctx>(async (request, svc, ctx) => {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!svc.config.internalToken || token !== svc.config.internalToken) {
      throw new ApiError(
        401,
        "unauthorized",
        'Send "Authorization: Bearer <INTERNAL_TOKEN>"'
      )
    }
    return handler(request, svc, ctx)
  })
}

export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON")
  }
  return schema.parse(body)
}

export function listOptions(request: Request) {
  const params = new URL(request.url).searchParams
  return {
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    before: params.get("before") ?? undefined,
    status: params.get("status") ?? undefined,
  }
}

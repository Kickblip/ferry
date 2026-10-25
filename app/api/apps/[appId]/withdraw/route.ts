import { auth } from "@clerk/nextjs/server"
import { ApiError } from "@/lib/payments/errors"
import { getServices } from "@/lib/payments/services"
import { withdrawAppBalance } from "@/lib/payments/withdrawals"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const { appId } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      appId
    )
  ) {
    return Response.json({ error: "Invalid app ID" }, { status: 400 })
  }
  try {
    const payout = await withdrawAppBalance(await getServices(), appId, userId)
    return Response.json(
      {
        id: payout.id,
        status: payout.status,
        amountCents: payout.amountCents,
      },
      { status: payout.status === "PAID" ? 200 : 202 }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to withdraw app balance", error)
    return Response.json(
      { error: "Unable to withdraw. Please try again." },
      { status: 500 }
    )
  }
}

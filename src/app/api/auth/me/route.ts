import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, user: null, settings: null });
  }
  const settings = await getUserSettings(user.username);
  return NextResponse.json({ authenticated: true, user, settings });
}


import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserCount } from "@/lib/db";
import ProfileForm from "./ProfileForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "내 프로필 - Anihub",
};

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) {
    const count = await getUserCount();
    if (count === 0) redirect("/setup");
    redirect("/login");
  }
  return <ProfileForm user={user} />;
}

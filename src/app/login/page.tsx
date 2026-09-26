import { getUserCount } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "로그인 - Anihub",
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/");
  }

  const userCount = await getUserCount();
  if (userCount === 0) {
    // 관리자가 없으면 무조건 셋업으로 강제 리디렉션
    redirect("/setup");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060913] px-4 py-12 safe-top safe-bottom safe-x">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d1426]/70 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        {/* 상단 브랜딩 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3.5 flex h-16 w-16 items-center justify-center rounded-full border border-purple-500/20 bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 shadow-inner">
            <span className="text-3xl">🔐</span>
          </div>
          <h1 className="bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 bg-clip-text text-2xl font-extrabold tracking-wide text-transparent sm:text-3xl">
            Anihub
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-400">시스템 로그인</p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
